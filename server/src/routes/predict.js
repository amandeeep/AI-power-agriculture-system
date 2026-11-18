// /api/predict/*: form-based predictions. Proxies to the ML service and saves a Prediction (source "form").
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { imageUpload } from '../middleware/upload.js';
import { validateBody } from '../middleware/validate.js';
import {
  cropInputSchema,
  fertilizerInputSchema,
  predictCrop,
  predictDisease,
  predictFertilizer,
} from '../services/predictions.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);

// Optional lat/lon in the body overrides the saved profile location for live-weather scoring.
const cropBodySchema = cropInputSchema.extend({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
});

router.post('/crop', validateBody(cropBodySchema), async (req, res) => {
  const { lat, lon, ...input } = req.body;
  const location = lat != null && lon != null ? { lat, lon } : undefined;
  res.json(await predictCrop(req.user, input, { location }));
});

router.post('/fertilizer', validateBody(fertilizerInputSchema), async (req, res) => {
  res.json(await predictFertilizer(req.user, req.body));
});

router.post('/disease', imageUpload.single('image'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Attach a leaf photo in the "image" field');
  res.json(await predictDisease(req.user, req.file));
});

export default router;
