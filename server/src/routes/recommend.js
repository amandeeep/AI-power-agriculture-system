// POST /api/recommend/location: crop recommendation from a field/location's soil records, climate
// normals, crop history and nearby farms. GET /api/recommend/districts lists the district soil table.
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { recommendForLocation } from '../services/locationRecommend.js';
import { mlClient } from '../services/mlClient.js';

const router = Router();
router.use(requireAuth);

const bodySchema = z.object({
  fieldId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid field id').optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  state: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  soil: z.object({
    N: z.coerce.number().min(0).max(300),
    P: z.coerce.number().min(0).max(300),
    K: z.coerce.number().min(0).max(400),
    ph: z.coerce.number().min(0).max(14),
  }).optional(),
});

router.post('/location', validateBody(bodySchema), async (req, res) => {
  res.json(await recommendForLocation(req.user, req.body));
});

router.get('/districts', async (_req, res) => {
  res.json(await mlClient.getJson('/soil/districts'));
});

export default router;
