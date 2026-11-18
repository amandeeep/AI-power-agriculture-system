// Makes a clean zip of the project to send to another PC:  npm run pack   (or: node scripts/pack.js)
//
// Left out (rebuilt by setup.bat on the other PC, or too big / private):
//   node_modules, ml-service/.venv, ml-service/data (training datasets), .git, build output, caches,
//   and every .env file (they hold YOUR MongoDB / Gemini secrets).
// Kept: the trained models (ml-service/models) and the generated district soil files, which are
// gitignored but needed to run.
//   --with-env   also include the .env files (only if you really want to share your own keys)
//   --out <file> output path (default: ../agri-dss-share.zip, next to the project folder)
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const WITH_ENV = argv.includes('--with-env');
const outIdx = argv.indexOf('--out');
const out = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : path.join(root, '..', 'agri-dss-share.zip'));
const name = path.basename(root);

const excludes = [
  'node_modules', '.venv', '.git', 'dist', 'coverage', '__pycache__', '.pytest_cache', '.ipynb_checkpoints',
  `${name}/ml-service/data`, '*.log',
  ...(WITH_ENV ? [] : ['.env', '.env.local', '.env.production', '.env.development']),
];

// Windows 10+ ships bsdtar as System32\tar.exe, which writes zip files (Git Bash's GNU tar cannot).
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
if (process.platform === 'win32' && !existsSync(tar)) { console.error('[pack] System32\\tar.exe not found (needs Windows 10 or newer).'); process.exit(1); }

if (existsSync(out)) rmSync(out);
console.log(`[pack] Zipping ${name}/ -> ${out}${WITH_ENV ? '  (INCLUDING .env files with your secrets)' : ''}`);
const args = ['-a', '-c', '-f', out, ...excludes.flatMap((e) => ['--exclude', e]), '-C', path.dirname(root), name];
const r = spawnSync(tar, args, { stdio: 'inherit' });
if (r.status !== 0) { console.error('[pack] tar failed.'); process.exit(1); }

const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`[pack] Done: ${out} (${mb} MB)`);
console.log('[pack] On the other PC: unzip, install Node.js 20+ and Python 3.11, double-click setup.bat, then start.bat.');
if (!WITH_ENV) console.log('[pack] .env files were left out. setup.bat creates them; the other person adds a MONGODB_URI and GEMINI_API_KEY in server/.env.');
