// One-command launcher for all three services (ML service, API server, React client).
//
//   start.bat                 (double-click, or run from a terminal)
//   npm start                 (same thing)
//   npm start -- --restart    (stop an already-running Agri-DSS first, then start fresh)
//
// Before starting it checks that dependencies, the Python venv and the .env files exist, and that
// each port is free. A port held by ANOTHER app (e.g. something else on 8000) is never touched: the
// service moves to the next free port and the others are pointed at it. A port held by an old
// Agri-DSS process is only stopped with --restart. Then it waits until every service is healthy and
// prints the URL to open. Ctrl+C stops everything.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const RESTART = args.has('--restart');
const isWin = process.platform === 'win32';

const c = { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
const log = (s = '') => console.log(`[start] ${s}`);
const fail = (s) => { console.error(c.red(`[start] ${s}`)); process.exit(1); };

function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
}

// --- 1. preflight ----------------------------------------------------------------------------------

const problems = [];
for (const dir of ['.', 'server', 'client']) {
  if (!existsSync(path.join(root, dir, 'node_modules'))) problems.push(`Missing ${dir === '.' ? 'root' : dir} node_modules. Run: ${isWin ? 'setup.bat' : 'node scripts/setup.js'}`);
}
const python = isWin ? path.join(root, 'ml-service', '.venv', 'Scripts', 'python.exe') : path.join(root, 'ml-service', '.venv', 'bin', 'python');
if (!existsSync(python)) problems.push(`Missing ml-service/.venv. Run: ${isWin ? 'setup.bat' : 'node scripts/setup.js'}`);
else {
  // A venv copied from another PC still has python.exe but points at that PC's Python install.
  const cfg = path.join(root, 'ml-service', '.venv', 'pyvenv.cfg');
  const home = existsSync(cfg) ? (readFileSync(cfg, 'utf8').match(/^home\s*=\s*(.+)$/m) || [])[1]?.trim() : null;
  if (home && !existsSync(home)) problems.push(`ml-service/.venv was made on another PC (its Python "${home}" does not exist here). Run: ${isWin ? 'setup.bat' : 'node scripts/setup.js'}`);
}
for (const f of ['server/.env', 'ml-service/.env']) {
  if (!existsSync(path.join(root, f))) problems.push(`Missing ${f}. Run: ${isWin ? 'setup.bat' : 'node scripts/setup.js'} (or copy ${f}.example to ${f} and fill it in).`);
}
if (problems.length) fail(`Cannot start:\n  - ${problems.join('\n  - ')}`);
// Imported only after the checks, so a fresh unzip without node_modules gets the message above, not a crash.
const { concurrently } = await import('concurrently');

const serverEnv = readEnv(path.join(root, 'server', '.env'));
const mlEnv = readEnv(path.join(root, 'ml-service', '.env'));
if (serverEnv.ML_INTERNAL_KEY && mlEnv.INTERNAL_API_KEY && serverEnv.ML_INTERNAL_KEY !== mlEnv.INTERNAL_API_KEY) {
  fail('server/.env ML_INTERNAL_KEY does not match ml-service/.env INTERNAL_API_KEY. Make them the same.');
}

// --- 2. ports --------------------------------------------------------------------------------------

/** true if something accepts connections on the port (IPv4 or IPv6 loopback). */
function portInUse(port) {
  const probe = (host) => new Promise((resolve) => {
    const s = net.connect({ host, port });
    s.setTimeout(700);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((r) => r.some(Boolean));
}

async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
  } catch {
    return null;
  }
}

// Is the thing on this port one of OUR services?
const IDENTIFY = {
  ml: async (p) => { const r = await getJson(`http://127.0.0.1:${p}/health`); try { return JSON.parse(r?.body).service === 'ml-service'; } catch { return false; } },
  server: async (p) => { const r = await getJson(`http://127.0.0.1:${p}/api/health`); try { return JSON.parse(r?.body).service === 'server'; } catch { return false; } },
  client: async (p) => { const r = await getJson(`http://localhost:${p}/`); return Boolean(r?.body?.includes('<title>Agri-DSS</title>')); },
};

/** Windows: stop the process listening on `port` plus its Agri-DSS launcher parents (watchers, reloaders, npm). */
function stopOurProcessOnPort(port) {
  if (!isWin) fail(`--restart is only automated on Windows. Stop the process on port ${port} yourself.`);
  const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });
  const pids = ps(`(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique`)
    .split(/\s+/).filter(Boolean).map(Number);
  if (!pids.length) return;
  const procs = JSON.parse(ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'));
  const byId = new Map(procs.map((p) => [p.ProcessId, p]));
  const LAUNCHER = /uvicorn|run-ml\.js|--watch-path|vite|concurrently|start-all\.js|npm-cli\.js|npm(\.cmd)?"? (run|start)/i;
  const SHELL = /^(bash|sh|cmd|powershell|pwsh|explorer|WindowsTerminal|conhost|Code)\.exe$/i; // never close a terminal
  for (const pid of pids) {
    // Walk up while the parent is still part of the Agri-DSS launch chain; never past a shell.
    let top = byId.get(pid);
    while (top) {
      const parent = byId.get(top.ParentProcessId);
      if (!parent || SHELL.test(parent.Name || '') || !LAUNCHER.test(parent.CommandLine || '') || process.pid === parent.ProcessId) break;
      top = parent;
    }
    if (!top) continue;
    log(`stopping old Agri-DSS process tree ${top.ProcessId} (${top.Name}) on port ${port}`);
    try { execFileSync('taskkill', ['/PID', String(top.ProcessId), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
  }
}

async function nextFreePort(start) {
  for (let p = start; p < start + 50; p += 1) if (!(await portInUse(p))) return p;
  fail(`No free port found near ${start}.`);
}

async function resolvePort(key, label, wanted) {
  if (!(await portInUse(wanted))) return wanted;
  if (await IDENTIFY[key](wanted)) {
    if (!RESTART) {
      fail(`Agri-DSS ${label} is already running on port ${wanted}.\n` +
        '        Use it as is, or restart everything with:  start.bat --restart   (or: npm start -- --restart)');
    }
    stopOurProcessOnPort(wanted);
    for (let i = 0; i < 20 && (await portInUse(wanted)); i += 1) await new Promise((r) => setTimeout(r, 250));
    if (!(await portInUse(wanted))) return wanted;
    fail(`Could not free port ${wanted}. Close the old ${label} window and try again.`);
  }
  const alt = await nextFreePort(wanted + 1);
  log(c.yellow(`port ${wanted} is used by another app (not Agri-DSS), so the ${label} will use port ${alt}. That app is left alone.`));
  return alt;
}

const ports = {};
ports.ml = await resolvePort('ml', 'ML service', Number(mlEnv.ML_PORT || 8000));
ports.server = await resolvePort('server', 'API server', Number(serverEnv.PORT || 5000));
ports.client = await resolvePort('client', 'web client', Number(readEnv(path.join(root, 'client', '.env')).VITE_DEV_PORT || 5173));

// --- 3. launch -------------------------------------------------------------------------------------

// The server and the Vite proxy read these from the process env (dotenv / loadEnv never override them).
const shared = {
  ML_PORT: String(ports.ml),
  ML_SERVICE_URL: `http://127.0.0.1:${ports.ml}`,
  PORT: String(ports.server),
  VITE_DEV_PORT: String(ports.client),
  VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${ports.server}`,
  CLIENT_ORIGIN: serverEnv.CLIENT_ORIGIN?.includes(`:${ports.client}`) ? serverEnv.CLIENT_ORIGIN : `http://localhost:${ports.client}`,
  FORCE_COLOR: '1',
};

log(`starting ML service :${ports.ml}, API server :${ports.server}, web client :${ports.client} ...`);
const { commands, result } = concurrently(
  [
    { command: 'node scripts/run-ml.js', name: 'ML', prefixColor: 'magenta', cwd: root, env: shared },
    { command: 'npm --prefix server run dev', name: 'API', prefixColor: 'blue', cwd: root, env: shared },
    { command: 'npm --prefix client run dev', name: 'WEB', prefixColor: 'green', cwd: root, env: shared },
  ],
  { killOthersOn: ['failure'], restartTries: 0, handleInput: false },
);

// --- 4. wait until healthy -------------------------------------------------------------------------

const checks = [
  ['ML service', () => getJson(`http://127.0.0.1:${ports.ml}/health`)],
  ['API server', () => getJson(`http://127.0.0.1:${ports.server}/api/health`)],
  ['Web client', () => getJson(`http://localhost:${ports.client}/`)],
];
const deadline = Date.now() + 120_000; // the ML service loads the models first (a few seconds)
let stopped = false;
result.catch(() => { stopped = true; }).then(() => { stopped = true; });

const status = new Map();
while (!stopped && Date.now() < deadline && status.size < checks.length) {
  for (const [name, check] of checks) {
    if (status.has(name)) continue;
    const r = await check();
    if (r && r.status < 500) status.set(name, r);
  }
  if (status.size < checks.length) await new Promise((res) => setTimeout(res, 1000));
}

if (stopped) {
  console.error(c.red('\n[start] A service exited during start-up; see its log lines above (ML / API / WEB).'));
} else if (status.size < checks.length) {
  const missing = checks.map(([n]) => n).filter((n) => !status.has(n));
  console.log(c.yellow(`\n[start] Still not responding after 2 minutes: ${missing.join(', ')}. Check the log lines above.`));
} else {
  const api = JSON.parse(status.get('API server').body);
  const ml = JSON.parse(status.get('ML service').body);
  const off = Object.entries(ml.models ?? {}).filter(([, m]) => !m.loaded).map(([k]) => k);
  console.log('');
  console.log(c.green(c.bold('  Agri-DSS is running')));
  console.log(`  Open:        ${c.bold(`http://localhost:${ports.client}`)}`);
  console.log(`  API:         http://127.0.0.1:${ports.server}/api/health   (database: ${api.db?.state ?? api.db}, Gemini: ${api.gemini})`);
  console.log(`  ML service:  http://127.0.0.1:${ports.ml}/docs   (${ml.status}${off.length ? `; not loaded: ${off.join(', ')}` : ''})`);
  console.log('  Stop:        Ctrl+C in this window');
  console.log('');
}

// Ctrl+C: concurrently forwards it to the children; make sure nothing is left behind.
process.on('SIGINT', () => { for (const cmd of commands) cmd.kill(); });
await result.catch(() => {});
