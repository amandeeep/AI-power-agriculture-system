// Pings the health endpoints of all three services and prints a summary table.
// Usage: npm run health   (override URLs with ML_URL / API_URL / WEB_URL env vars)
const targets = [
  { name: 'ml-service', url: process.env.ML_URL || 'http://127.0.0.1:8000/health' },
  { name: 'server', url: process.env.API_URL || 'http://127.0.0.1:5000/api/health' },
  { name: 'client', url: process.env.WEB_URL || 'http://localhost:5173/' },
];

let failed = false;
for (const t of targets) {
  const started = Date.now();
  try {
    const res = await fetch(t.url, { signal: AbortSignal.timeout(5000) });
    const type = res.headers.get('content-type') || '';
    const body = type.includes('json') ? JSON.stringify(await res.json()) : `(${type.split(';')[0]})`;
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${t.name.padEnd(11)} ${res.status} ${Date.now() - started}ms  ${body}`);
    if (!res.ok) failed = true;
  } catch (err) {
    failed = true;
    console.log(`DOWN ${t.name.padEnd(11)} ${t.url}  ${err.cause?.code || err.message}`);
  }
}
process.exit(failed ? 1 : 0);
