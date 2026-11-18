// /api/auth: register, login, current user, profile update.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { LANGUAGES } from '../config/constants.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimits.js';
import { validateBody } from '../middleware/validate.js';
import { User } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();

const phoneSchema = z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Phone must be 10-15 digits, optionally starting with +');
const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  city: z.string().trim().max(100).optional(),
  village: z.string().trim().max(100).optional(),
  subDistrict: z.string().trim().max(100).optional(),
  district: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'PIN code must be 6 digits').optional(),
});

const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')).optional(),
    phone: phoneSchema.optional(),
    password: z.string().min(6, 'Password must be at least 6 characters').max(100),
    preferredLanguage: z.enum(LANGUAGES).default('en'),
    location: locationSchema.optional(),
  })
  .refine((v) => v.email || v.phone, { message: 'Provide an email or a phone number', path: ['email'] });

const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or phone number'),
  password: z.string().min(1, 'Enter your password'),
});

const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    preferredLanguage: z.enum(LANGUAGES),
    location: locationSchema.nullable(),
  })
  .partial();

const authResponse = (user) => ({ token: signToken(user), user: user.toJSON() });

router.post('/register', authLimiter, validateBody(registerSchema), async (req, res) => {
  const { password, ...data } = req.body;
  const clash = await User.exists({ $or: [data.email && { email: data.email }, data.phone && { phone: data.phone }].filter(Boolean) });
  if (clash) throw new HttpError(409, 'An account with this email or phone already exists');

  const user = await User.create({ ...data, passwordHash: await bcrypt.hash(password, 10) });
  res.status(201).json(authResponse(user));
});

router.post('/login', authLimiter, validateBody(loginSchema), async (req, res) => {
  const { identifier, password } = req.body;
  const query = identifier.includes('@') ? { email: identifier.toLowerCase() } : { phone: identifier };
  const user = await User.findOne(query).select('+passwordHash');
  // Same message for unknown user and wrong password: don't reveal which accounts exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Incorrect email/phone or password');
  }
  res.json(authResponse(user));
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toJSON() });
});

router.patch('/me', requireAuth, validateBody(profileSchema), async (req, res) => {
  const { location, ...rest } = req.body;
  Object.assign(req.user, rest);
  if (location === null) req.user.location = undefined;
  else if (location) req.user.location = location;
  await req.user.save();
  res.json({ user: req.user.toJSON() });
});

export default router;
