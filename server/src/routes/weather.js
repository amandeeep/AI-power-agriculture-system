// GET /api/weather?lat=&lon=   or   GET /api/weather?city=
import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate.js';
import { geocodeCity, getForecast } from '../services/weather.js';

const router = Router();

const querySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
    city: z.string().trim().min(2).max(100).optional(),
  })
  .refine((q) => (q.lat != null && q.lon != null) || q.city, {
    message: 'Provide lat and lon, or city',
    path: ['city'],
  });

router.get('/', validateQuery(querySchema), async (req, res) => {
  const { lat, lon, city } = req.validatedQuery;
  if (lat != null && lon != null) return res.json(await getForecast(lat, lon));
  const place = await geocodeCity(city);
  res.json(await getForecast(place.lat, place.lon, place.name));
});

export default router;
