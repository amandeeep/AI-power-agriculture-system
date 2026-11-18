// GET /api/history?type=crop|fertilizer|disease&page=1&limit=20: the user's saved predictions, newest first.
import { Router } from 'express';
import { z } from 'zod';
import { PREDICTION_TYPES } from '../config/constants.js';
import { requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { Prediction } from '../models/Prediction.js';

const router = Router();

const querySchema = z.object({
  type: z.enum(PREDICTION_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/', requireAuth, validateQuery(querySchema), async (req, res) => {
  const { type, page, limit } = req.validatedQuery;
  const filter = { userId: req.user._id, ...(type ? { type } : {}) };
  const [items, total] = await Promise.all([
    Prediction.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Prediction.countDocuments(filter),
  ]);
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
});

export default router;
