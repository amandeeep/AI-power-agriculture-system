// JWT auth: `Authorization: Bearer <token>` -> req.user (a lean User document without the hash).
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id ?? user._id.toString() }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  const user = await User.findById(payload.sub);
  if (!user) throw new HttpError(401, 'User no longer exists');
  req.user = user;
  next();
}
