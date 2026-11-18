import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

const handler = (_req, res) =>
  res.status(429).json({ error: { message: 'Too many requests. Please wait a moment and try again.' } });

// Broad safety net for the whole API.
export const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, handler });

// Brute-force protection for login / register.
export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, handler });

// Chat calls Gemini, so keep it within the free tier. Keyed per user when logged in.
export const chatLimiter = rateLimit({
  windowMs: env.CHAT_RATE_LIMIT_WINDOW_MS,
  limit: env.CHAT_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
  handler,
});
