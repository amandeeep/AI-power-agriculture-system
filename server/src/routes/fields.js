// /api/fields: a farmer's fields, their soil tests and their crop history (all scoped to the user).
import { Router } from 'express';
import { z } from 'zod';
import { SEASONS } from '../config/constants.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { CropHistory } from '../models/CropHistory.js';
import { Field } from '../models/Field.js';
import { SoilTest } from '../models/SoilTest.js';
import { summarizeSoilTests, seasonSortKey } from '../services/locationRecommend.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const fieldSchema = z.object({
  name: z.string().trim().min(1).max(60),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  village: z.string().trim().max(100).optional(),
  subDistrict: z.string().trim().max(100).optional(),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'PIN code must be 6 digits').optional(),
  areaAcres: z.coerce.number().min(0).max(10000).optional(),
}).refine((f) => (f.lat == null) === (f.lon == null), { message: 'Give both lat and lon, or neither', path: ['lat'] });

const soilTestSchema = z.object({
  testedAt: z.coerce.date().refine((d) => d <= new Date(Date.now() + 24 * 3600 * 1000), 'Test date is in the future'),
  N: z.coerce.number().min(0).max(300),
  P: z.coerce.number().min(0).max(300),
  K: z.coerce.number().min(0).max(400),
  ph: z.coerce.number().min(0).max(14),
  organicCarbon: z.coerce.number().min(0).max(10).optional(),
  source: z.enum(['soil_health_card', 'lab', 'self']).optional(),
  note: z.string().trim().max(200).optional(),
});

const cropHistorySchema = z.object({
  year: z.coerce.number().int().min(1990).max(new Date().getFullYear() + 1),
  season: z.enum(SEASONS),
  crop: z.string().trim().min(2).max(40),
  yieldQuintalPerAcre: z.coerce.number().min(0).max(1000).optional(),
});

async function ownField(req) {
  const id = objectId.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'Field not found');
  const field = await Field.findOne({ _id: id.data, userId: req.user._id });
  if (!field) throw new HttpError(404, 'Field not found');
  return field;
}

// --- fields ---

router.get('/', async (req, res) => {
  const fields = await Field.find({ userId: req.user._id }).sort({ createdAt: 1 });
  res.json({ items: fields });
});

router.post('/', validateBody(fieldSchema), async (req, res) => {
  const count = await Field.countDocuments({ userId: req.user._id });
  if (count >= 50) throw new HttpError(400, 'Field limit reached (50)');
  const field = await Field.create({ ...req.body, userId: req.user._id });
  res.status(201).json(field);
});

router.get('/:id', async (req, res) => {
  const field = await ownField(req);
  const [tests, history] = await Promise.all([
    SoilTest.find({ fieldId: field._id }).sort({ testedAt: -1 }).limit(50),
    CropHistory.find({ fieldId: field._id }),
  ]);
  res.json({
    field,
    soilTests: tests,
    soilSummary: summarizeSoilTests(tests.map((t) => t.toObject())),
    cropHistory: history.sort((a, b) => seasonSortKey(b) - seasonSortKey(a)),
  });
});

router.put('/:id', validateBody(fieldSchema), async (req, res) => {
  const field = await ownField(req);
  // PUT replaces the whole field: optional values left out of the body are cleared.
  const OPTIONAL = ['lat', 'lon', 'city', 'state', 'district', 'village', 'subDistrict', 'pincode', 'areaAcres'];
  field.set({ ...Object.fromEntries(OPTIONAL.map((k) => [k, undefined])), ...req.body });
  await field.save();
  res.json(field);
});

router.delete('/:id', async (req, res) => {
  const field = await ownField(req);
  await Promise.all([
    SoilTest.deleteMany({ fieldId: field._id }),
    CropHistory.deleteMany({ fieldId: field._id }),
    field.deleteOne(),
  ]);
  res.status(204).end();
});

// --- soil tests ---

router.post('/:id/soil-tests', validateBody(soilTestSchema), async (req, res) => {
  const field = await ownField(req);
  const test = await SoilTest.create({ ...req.body, fieldId: field._id, userId: req.user._id });
  res.status(201).json(test);
});

router.delete('/:id/soil-tests/:testId', async (req, res) => {
  const field = await ownField(req);
  const id = objectId.safeParse(req.params.testId);
  const r = id.success ? await SoilTest.deleteOne({ _id: id.data, fieldId: field._id }) : { deletedCount: 0 };
  if (!r.deletedCount) throw new HttpError(404, 'Soil test not found');
  res.status(204).end();
});

// --- crop history ---

router.post('/:id/crops', validateBody(cropHistorySchema), async (req, res) => {
  const field = await ownField(req);
  const exists = await CropHistory.findOne({ fieldId: field._id, year: req.body.year, season: req.body.season });
  if (exists) throw new HttpError(409, `A crop is already recorded for ${req.body.season} ${req.body.year}`);
  const row = await CropHistory.create({ ...req.body, fieldId: field._id, userId: req.user._id });
  res.status(201).json(row);
});

router.delete('/:id/crops/:rowId', async (req, res) => {
  const field = await ownField(req);
  const id = objectId.safeParse(req.params.rowId);
  const r = id.success ? await CropHistory.deleteOne({ _id: id.data, fieldId: field._id }) : { deletedCount: 0 };
  if (!r.deletedCount) throw new HttpError(404, 'Crop record not found');
  res.status(204).end();
});

export default router;
