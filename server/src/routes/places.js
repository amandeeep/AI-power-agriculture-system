// /api/places: address helpers for the location pickers (no auth, no DB, like /api/weather).
//   GET /search?q=kondapur          type-ahead suggestions (villages, towns, cities in India)
//   GET /reverse?lat=..&lon=..      coordinates -> village, mandal/taluk, district, state, PIN
//   GET /pincode/508001             PIN -> post offices (villages), district, state
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate.js';
import { ATTRIBUTION, lookupPincode, reversePlace, searchPlaces } from '../services/places.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();

// Protects the free upstream services: type-ahead is debounced in the client, this is a backstop.
router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Too many place lookups. Please wait a minute.' } },
}));

const searchSchema = z.object({ q: z.string().trim().min(2).max(80) });
const reverseSchema = z.object({
  lat: z.coerce.number().min(6).max(37.5),
  lon: z.coerce.number().min(68).max(98),
});

router.get('/search', validateQuery(searchSchema), async (req, res) => {
  res.json({ results: await searchPlaces(req.validatedQuery.q), attribution: ATTRIBUTION });
});

router.get('/reverse', validateQuery(reverseSchema), async (req, res) => {
  const { lat, lon } = req.validatedQuery;
  res.json({ place: await reversePlace(lat, lon), attribution: ATTRIBUTION });
});

router.get('/pincode/:pin', async (req, res) => {
  if (!/^[1-9]\d{5}$/.test(req.params.pin)) throw new HttpError(400, 'A PIN code has 6 digits and does not start with 0');
  res.json({ ...(await lookupPincode(req.params.pin)), attribution: ATTRIBUTION });
});

export default router;
