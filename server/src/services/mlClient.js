// Thin HTTP client for the Python ML service. Always sends the shared X-Internal-Key.
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

// FastAPI errors come as { detail: string | {message,...} | [validation issues] }.
function errorFrom(status, data) {
  const d = data?.detail;
  if (Array.isArray(d)) {
    return new HttpError(status, 'Invalid input for the prediction model',
      d.map((i) => ({ path: (i.loc || []).filter((p) => p !== 'body').join('.'), message: i.msg })));
  }
  if (d && typeof d === 'object') {
    const { message, ...rest } = d;
    return new HttpError(status, message || 'ML service error', Object.keys(rest).length ? rest : undefined);
  }
  return new HttpError(status, d || 'ML service error');
}

async function request(path, { method = 'GET', body, headers = {}, timeoutMs = env.ML_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetch(new URL(path, env.ML_SERVICE_URL), {
      method,
      body,
      headers: { 'X-Internal-Key': env.ML_INTERNAL_KEY, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new HttpError(503, 'ML service is unreachable', { cause: err.cause?.code || err.name });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw errorFrom(res.status, data);
  return data;
}

export const mlClient = {
  health: () => request('/health', { timeoutMs: 3000 }),
  getJson: (path) => request(path),
  postJson: (path, payload) =>
    request(path, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }),
  postForm: (path, formData) => request(path, { method: 'POST', body: formData }),
};
