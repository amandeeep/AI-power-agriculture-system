// GET /api/health: API liveness + status of its dependencies (MongoDB, ML service, Gemini key).
import { Router } from 'express';
import { dbStatus } from '../config/db.js';
import { env } from '../config/env.js';
import { mlClient } from '../services/mlClient.js';

const router = Router();

router.get('/', async (req, res) => {
  let ml;
  try {
    const h = await mlClient.health();
    ml = { status: h.status, models: Object.fromEntries(Object.entries(h.models).map(([k, v]) => [k, v.loaded])) };
  } catch {
    ml = { status: 'unreachable' };
  }
  res.json({
    status: 'ok',
    service: 'server',
    uptimeSec: Math.round(process.uptime()),
    db: dbStatus(),
    mlService: ml,
    gemini: env.GEMINI_API_KEY ? 'configured' : 'not_configured',
  });
});

export default router;
