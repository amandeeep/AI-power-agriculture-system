// MongoDB connection. The API still boots without a URI (health reports "not_configured"),
// so the ML/weather features can be developed before Atlas is set up.
import mongoose from 'mongoose';
import { env } from './env.js';

const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export async function connectDB() {
  if (!env.MONGODB_URI) {
    console.warn('[db] MONGODB_URI not set; running without a database.');
    return false;
  }
  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log(`[db] connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
    return true;
  } catch (err) {
    console.error(`[db] connection failed: ${err.message}`);
    return false;
  }
}

export function dbStatus() {
  if (!env.MONGODB_URI) return 'not_configured';
  return STATES[mongoose.connection.readyState] ?? 'unknown';
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
