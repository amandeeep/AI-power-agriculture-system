// Starts the FastAPI ML service using the project's virtualenv interpreter.
// Works on Windows (.venv\Scripts\python.exe) and POSIX (.venv/bin/python).
// Host/port: ML_HOST / ML_PORT from the process env (set by scripts/start-all.js when 8000 is taken),
// then ml-service/.env, then safe defaults.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mlDir = path.join(root, 'ml-service');

// Minimal .env parser (KEY=VALUE, ignores comments) so we don't need extra deps.
function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
}

const env = readEnv(path.join(mlDir, '.env'));
const host = process.env.ML_HOST || env.ML_HOST || '127.0.0.1';
const port = process.env.ML_PORT || env.ML_PORT || '8000';

const python =
  process.platform === 'win32'
    ? path.join(mlDir, '.venv', 'Scripts', 'python.exe')
    : path.join(mlDir, '.venv', 'bin', 'python');

if (!existsSync(python)) {
  console.error(
    `[ml] Virtualenv not found at ${python}\n` +
      '     Create it with:  cd ml-service && py -3.11 -m venv .venv && .venv\\Scripts\\python -m pip install -r requirements.txt'
  );
  process.exit(1);
}

const child = spawn(
  python,
  ['-m', 'uvicorn', 'app.main:app', '--host', host, '--port', port, '--reload', '--reload-dir', 'app'],
  { cwd: mlDir, stdio: 'inherit' }
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
