// Shared axios instance. Base URL comes from env (VITE_API_BASE_URL), defaulting to the Vite dev proxy.
import axios from 'axios';

export const TOKEN_KEY = 'agri.token';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 60000, // chat can take a while (Gemini + tools)
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// An expired or invalid token logs the user out everywhere (AuthContext listens for this event).
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem(TOKEN_KEY) && !err.config?.url?.startsWith('/auth/login')) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    return Promise.reject(err);
  }
);

/**
 * Turns an API error into a readable message. `t` (i18next) translates generic network errors.
 * Server messages ({ error: { message } }) are shown as-is.
 */
export function errorMessage(err, t) {
  if (err?.response?.data?.error?.message) return err.response.data.error.message;
  if (err?.code === 'ECONNABORTED') return t ? t('common.timeout') : 'The request took too long.';
  if (!err?.response) return t ? t('common.networkError') : 'Network error';
  return t ? t('common.unknownError') : 'Something went wrong';
}

/** Field-level validation errors from the server (zod), as { field: message }. */
export function fieldErrors(err) {
  const details = err?.response?.data?.error?.details;
  if (!Array.isArray(details)) return {};
  return Object.fromEntries(details.filter((d) => d.path).map((d) => [d.path, d.message]));
}
