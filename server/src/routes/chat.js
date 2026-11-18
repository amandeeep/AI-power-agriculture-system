// /api/chat: the AI assistant. Multipart (an optional "image" field) or JSON.
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { LANGUAGES } from '../config/constants.js';
import { requireAuth } from '../middleware/auth.js';
import { chatLimiter } from '../middleware/rateLimits.js';
import { imageUpload } from '../middleware/upload.js';
import { validateBody } from '../middleware/validate.js';
import { ChatSession } from '../models/ChatSession.js';
import { HISTORY_MESSAGES, orchestrate } from '../services/orchestrator.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);

// Multipart sends everything as strings, so location may arrive as a JSON string or as lat/lon fields.
const locationField = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v || undefined;
    if (!v.trim()) return undefined;
    try { return JSON.parse(v); } catch { return v; } // non-JSON string -> fails the object check -> 400
  },
  z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180), city: z.string().max(100).optional() }).optional()
);

const chatSchema = z.object({
  sessionId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid sessionId').optional().or(z.literal('').transform(() => undefined)),
  message: z.string().trim().max(2000).default(''),
  language: z.enum(LANGUAGES).optional(),
  location: locationField,
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
});

async function findOwnSession(id, userId) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Conversation not found');
  const session = await ChatSession.findOne({ _id: id, userId });
  if (!session) throw new HttpError(404, 'Conversation not found');
  return session;
}

function titleFrom(message, hasImage) {
  const t = message.replace(/\s+/g, ' ').trim();
  if (t) return t.length > 60 ? `${t.slice(0, 57)}...` : t;
  return hasImage ? '🍂 Leaf photo' : 'New conversation';
}

router.post('/', chatLimiter, imageUpload.single('image'), validateBody(chatSchema), async (req, res) => {
  const { sessionId, message, lat, lon } = req.body;
  if (!message && !req.file) throw new HttpError(400, 'Type a message or attach a photo');

  const user = req.user;
  const language = req.body.language ?? user.preferredLanguage;
  const location = req.body.location ?? (lat != null && lon != null ? { lat, lon } : undefined);

  const session = sessionId
    ? await findOwnSession(sessionId, user._id)
    : await ChatSession.create({ userId: user._id, language, title: titleFrom(message, Boolean(req.file)) });

  const history = session.messages.slice(-HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content }));
  const result = await orchestrate({ message, language, user, history, location, image: req.file, sessionId: session._id });

  const userMessage = {
    role: 'user',
    content: message,
    ...(req.file ? { attachment: { filename: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size } } : {}),
  };
  const assistantMessage = {
    role: 'assistant',
    content: result.reply,
    mode: result.mode,
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
    // Store the full tool data (for the UI cards), not the compact version that was sent to Gemini.
    ...(result.toolResults.length
      ? { toolResults: result.toolResults.map(({ name, full, error, forModel, predictionId }) => ({ name, predictionId, ...(error ? { error, details: forModel } : { result: full }) })) }
      : {}),
  };
  session.messages.push(userMessage, assistantMessage);
  session.language = language;
  await session.save();

  const saved = session.messages.slice(-2).map((m) => m.toJSON());
  res.json({ sessionId: session.id, title: session.title, mode: result.mode, userMessage: saved[0], message: saved[1] });
});

router.get('/sessions', async (req, res) => {
  const sessions = await ChatSession.aggregate([
    { $match: { userId: req.user._id } },
    { $sort: { updatedAt: -1 } },
    { $limit: 100 },
    { $project: { _id: 0, id: { $toString: '$_id' }, title: 1, language: 1, updatedAt: 1, createdAt: 1, messageCount: { $size: '$messages' } } },
  ]);
  res.json({ sessions });
});

router.get('/sessions/:id', async (req, res) => {
  res.json({ session: (await findOwnSession(req.params.id, req.user._id)).toJSON() });
});

router.delete('/sessions/:id', async (req, res) => {
  const session = await findOwnSession(req.params.id, req.user._id);
  await session.deleteOne();
  res.status(204).end();
});

export default router;
