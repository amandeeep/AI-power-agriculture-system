// Central error handling: every error leaves the API as { error: { message, details? } }.
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

export function notFound(req, res) {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.originalUrl}` } });
}

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature to treat this as an error handler
export function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err instanceof ZodError) {
    status = 400;
    message = 'Validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  }

  if (status >= 500) {
    if (err instanceof HttpError) {
      // Expected failure of a dependency (ML service, weather, DB): one line is enough.
      if (env.NODE_ENV !== 'test') console.warn(`[warn] ${status} ${req.method} ${req.originalUrl}: ${message}`);
    } else {
      console.error('[error]', err); // unexpected bug: keep the full stack
      if (env.NODE_ENV === 'production') message = 'Internal server error'; // don't leak internals
    }
  }
  res.status(status).json({ error: { message, ...(details ? { details } : {}) } });
}
