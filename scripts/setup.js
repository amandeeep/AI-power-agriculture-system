// One-time setup on a new PC (after unzipping or cloning). Safe to run again at any time.
//
//   setup.bat                 (double-click, or run from a terminal)
//   node scripts/setup.js     (same thing; add --no-tf to skip TensorFlow / disease detection)
//
// What it does:
//   1. Finds a compatible Python (3.11 preferred, 3.12 / 3.13 also work) via the py launcher or PATH.
//   2. (Re)creates ml-service/.venv on THIS machine. A venv copied from another PC is broken
//      (it points at that PC's Python path), so a foreign or broken venv is deleted and rebuilt.
//   3. Installs the Python packages, pinned to the exact versions in ml-service/constraints.txt
//      (the trained model files need the same scikit-learn version they were saved with).
//   4. Installs the Node packages (root, server, client).
//   5. Creates any missing .env from its .env.example, with matching random internal keys.
// It never installs anything system-wide; if Python or Node is missing it says what to install.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mlDir = path.join(root, 'ml-service');
const venvDir = path.join(mlDir, '.venv');
const isWin = process.platform === 'win32';
const venvPython = isWin ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
const NO_TF = process.argv.includes('--no-tf');
const OK_MINORS = [11, 12, 13]; // pandas 3 needs >= 3.11; numpy 2.1 / TensorFlow 2.20 stop at 3.13

const c = { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
const log = (s = '') => console.log(`[setup] ${s}`);
const fail = (s) => { console.error(c.red(`\n[setup] ${s}\n`)); process.exit(1); };

/** Runs a program (no shell, so paths with spaces are safe) with live output; exits on failure. */
function run(cmd, args, opts = {}) {
  log(c.bold(`> ${cmd} ${args.join(' ')}`));
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(opts.failMsg || `Command failed: ${cmd} ${args.join(' ')}`);
}

/** npm is a .cmd on Windows, which needs a shell; the command line here has no user paths in it. */
function npm(line, cwd, failMsg) {
  log(c.bold(`> npm ${line}   (in ${path.relative(root, cwd) || '.'})`));
  const r = spawnSync(`npm ${line}`, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) fail(failMsg);
}

/** Returns "3.x.y" if the command runs Python, else null. */
function pyVersion(cmd, args = []) {
  try {
    return execFileSync(cmd, [...args, '-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3])'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim();
  } catch { return null; }
}

// --- 1. Node --------------------------------------------------------------------------------------
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) fail(`Node.js ${process.versions.node} is too old. Install Node.js 20 or newer (LTS) from https://nodejs.org`);
log(`Node.js ${process.versions.node} OK`);

// --- 2. Python ------------------------------------------------------------------------------------
const candidates = [
  ...(isWin ? OK_MINORS.map((m) => ['py', [`-3.${m}`]]) : []),
  ...(isWin ? [['python', []], ['python3', []]] : [...OK_MINORS.map((m) => [`python3.${m}`, []]), ['python3', []], ['python', []]]),
];
let basePy = null;
const seen = [];
for (const [cmd, args] of candidates) {
  const v = pyVersion(cmd, args);
  if (!v) continue;
  seen.push(`${cmd} ${args.join(' ')} -> ${v}`.replace('  ', ' '));
  const [maj, min] = v.split('.').map(Number);
  if (maj === 3 && OK_MINORS.includes(min)) { basePy = { cmd, args, v }; break; }
}
if (!basePy) {
  fail([
    'No compatible Python found. This project needs Python 3.11 (3.12 or 3.13 also work; 3.14 does NOT yet).',
    seen.length ? `Found: ${seen.join(', ')}` : 'Found: none',
    'Install Python 3.11 (it can sit next to any other version):',
    isWin ? '  winget install Python.Python.3.11      or download it from https://www.python.org/downloads/release/python-3119/'
          : '  use your package manager or https://www.python.org/downloads/',
    'Then run setup again.',
  ].join('\n'));
}
log(`Python ${basePy.v} OK (${basePy.cmd} ${basePy.args.join(' ')})`);

// --- 3. venv --------------------------------------------------------------------------------------
function venvIsHealthy() {
  if (!existsSync(venvPython)) return false;
  const cfg = path.join(venvDir, 'pyvenv.cfg');
  if (existsSync(cfg)) {
    const home = (readFileSync(cfg, 'utf8').match(/^home\s*=\s*(.+)$/m) || [])[1]?.trim();
    if (home && !existsSync(home)) return false; // copied from another PC
  }
  const v = pyVersion(venvPython);
  return !!v && OK_MINORS.includes(Number(v.split('.')[1]));
}
if (existsSync(venvDir) && !venvIsHealthy()) {
  log(c.yellow('ml-service/.venv was made on another PC or is broken. Deleting it and creating a fresh one.'));
  rmSync(venvDir, { recursive: true, force: true });
}
if (!existsSync(venvDir)) run(basePy.cmd, [...basePy.args, '-m', 'venv', venvDir], { failMsg: 'Could not create the virtualenv.' });
else log('ml-service/.venv already exists and works. Reusing it.');

// --- 4. Python packages ---------------------------------------------------------------------------
const pip = ['-m', 'pip', 'install', '--default-timeout=60', '--retries', '10', '--disable-pip-version-check'];
run(venvPython, [...pip, '--upgrade', 'pip']);
const reqs = ['-r', 'requirements.txt', ...(NO_TF ? [] : ['-r', 'requirements-tf.txt'])];
log(NO_TF ? 'Skipping TensorFlow (--no-tf): disease detection will be off, everything else works.'
          : 'Installing Python packages incl. TensorFlow (~400 MB download, can take 5-15 min).');
const pinned = spawnSync(venvPython, [...pip, ...reqs, '-c', 'constraints.txt'], { cwd: mlDir, stdio: 'inherit' });
if (pinned.status !== 0) {
  // Usually means a pinned version has no wheel for this Python version. Fall back to the ranges.
  log(c.yellow('Pinned install failed. Retrying with the version ranges from requirements.txt...'));
  run(venvPython, [...pip, ...reqs], { cwd: mlDir, failMsg: 'Python package install failed. Check your internet connection and run setup again (it resumes).' });
  log(c.yellow('Installed without exact pins. If crop predictions fail to load, use Python 3.11.'));
}

// --- 5. Node packages -----------------------------------------------------------------------------
for (const dir of ['.', 'server', 'client']) {
  const cwd = path.join(root, dir);
  npm('install --no-audit --no-fund', cwd, `npm install failed in ${dir === '.' ? 'the root folder' : dir + '/'}. Check your internet connection and run setup again.`);
}

// --- 6. .env files --------------------------------------------------------------------------------
const setKey = (text, key, value) => text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
const created = [];
const mlEnvPath = path.join(mlDir, '.env');
const serverEnvPath = path.join(root, 'server', '.env');
const clientEnvPath = path.join(root, 'client', '.env');
const readKey = (file, key) => (existsSync(file) ? (readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1]?.trim() : undefined);
let internalKey = readKey(mlEnvPath, 'INTERNAL_API_KEY') || readKey(serverEnvPath, 'ML_INTERNAL_KEY');
if (!internalKey || internalKey.startsWith('change-me')) internalKey = randomBytes(32).toString('hex');

if (!existsSync(mlEnvPath)) {
  writeFileSync(mlEnvPath, setKey(readFileSync(`${mlEnvPath}.example`, 'utf8'), 'INTERNAL_API_KEY', internalKey));
  created.push('ml-service/.env');
}
if (!existsSync(serverEnvPath)) {
  let t = readFileSync(`${serverEnvPath}.example`, 'utf8');
  t = setKey(t, 'ML_INTERNAL_KEY', internalKey);
  t = setKey(t, 'JWT_SECRET', randomBytes(32).toString('hex'));
  writeFileSync(serverEnvPath, t);
  created.push('server/.env');
}
if (!existsSync(clientEnvPath)) { copyFileSync(`${clientEnvPath}.example`, clientEnvPath); created.push('client/.env'); }
if (created.length) log(`Created ${created.join(', ')} (internal keys generated and matched).`);

// --- 7. Summary -----------------------------------------------------------------------------------
const warnings = [];
for (const f of ['crop_stack.joblib', 'scaler.joblib', 'label_encoder.joblib']) {
  if (!existsSync(path.join(mlDir, 'models', f))) warnings.push(`ml-service/models/${f} is missing: crop prediction will be off. Copy the models folder from the original PC.`);
}
if (!NO_TF && !existsSync(path.join(mlDir, 'models', 'disease_mnv2.keras'))) warnings.push('ml-service/models/disease_mnv2.keras is missing: disease detection will be off.');
if (!existsSync(path.join(mlDir, 'knowledge', 'district_soil.json'))) warnings.push('ml-service/knowledge/district_soil.json is missing: district soil estimates will be off.');
const mongo = readKey(serverEnvPath, 'MONGODB_URI');
const gemini = readKey(serverEnvPath, 'GEMINI_API_KEY');
if (!mongo) warnings.push('server/.env: MONGODB_URI is empty. Login, history and chat need it (free MongoDB Atlas cluster).');
if (!gemini) warnings.push('server/.env: GEMINI_API_KEY is empty. AI chat falls back to basic mode without it (free key: https://aistudio.google.com/apikey).');

console.log();
log(c.green(c.bold('Setup finished.')));
for (const w of warnings) log(c.yellow(`! ${w}`));
log(`Start the app with: ${c.bold(isWin ? 'start.bat' : 'npm start')}`);
