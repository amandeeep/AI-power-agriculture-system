// Routes that need MongoDB return a clear 503 instead of hanging when the database is unavailable.
import mongoose from 'mongoose';
import { HttpError } from '../utils/httpError.js';

export function requireDb(_req, _res, next) {
  if (mongoose.connection.readyState !== 1) {
    throw new HttpError(503, 'Database is not connected. Set MONGODB_URI in server/.env and restart the server.');
  }
  next();
}
