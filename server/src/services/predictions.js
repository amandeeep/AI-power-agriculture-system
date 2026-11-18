// Runs a prediction on the ML service and records it as a Prediction document.
// Shared by the form routes (/api/predict/*) and the Gemini orchestrator (Phase 5).
import { z } from 'zod';
import { Prediction } from '../models/Prediction.js';
import { mlClient } from './mlClient.js';
import { cropWeatherFor } from './weather.js';

// Ranges mirror ml-service/app/schemas.py so bad input is caught before the network hop.
export const cropInputSchema = z.object({
  N: z.coerce.number().min(0).max(300),
  P: z.coerce.number().min(0).max(300),
  K: z.coerce.number().min(0).max(400),
  temperature: z.coerce.number().min(-20).max(60),
  humidity: z.coerce.number().min(0).max(100),
  ph: z.coerce.number().min(0).max(14),
  rainfall: z.coerce.number().min(0).max(5000),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export const fertilizerInputSchema = z.object({
  crop: z.string().trim().min(2).max(40),
  N: z.coerce.number().min(0).max(300),
  P: z.coerce.number().min(0).max(300),
  K: z.coerce.number().min(0).max(400),
});

// Rounded to 2 dp (~1 km) so a stored recommendation never pinpoints a farm.
export const toGeo = (loc) => (loc?.lat != null && loc?.lon != null
  ? { type: 'Point', coordinates: [Number(loc.lon.toFixed(2)), Number(loc.lat.toFixed(2))] }
  : undefined);

async function save(user, type, input, output, { source = 'form', sessionId, geo } = {}) {
  const doc = await Prediction.create({ userId: user._id, type, input, output, source, sessionId, geo });
  return doc.id;
}

/**
 * Crop recommendation. When the user's location is known, live weather is passed along so the
 * ML service can compute weather_score from real conditions (the soil/climate inputs are the fallback).
 */
export async function predictCrop(user, input, { location, source, sessionId } = {}) {
  const loc = location ?? user.location;
  const weather = await cropWeatherFor(loc);
  const payload = { ...input, ...(weather ? { weather } : {}) };
  const output = await mlClient.postJson('/predict/crop', payload);
  const predictionId = await save(user, 'crop', payload, output, { source, sessionId, geo: toGeo(loc) });
  return { predictionId, liveWeatherUsed: Boolean(weather), ...output };
}

/**
 * Crop recommendation with a ready-made payload (soil + climate + context), used by the location-based
 * recommender. No live-weather override: the climate inputs are already the seasonal normals.
 */
export async function predictCropWithPayload(user, payload, { location, source, sessionId } = {}) {
  const output = await mlClient.postJson('/predict/crop', payload);
  const predictionId = await save(user, 'crop', payload, output, { source, sessionId, geo: toGeo(location) });
  return { predictionId, ...output };
}

export async function predictFertilizer(user, input, { source, sessionId } = {}) {
  const output = await mlClient.postJson('/predict/fertilizer', input);
  const predictionId = await save(user, 'fertilizer', input, output, { source, sessionId });
  return { predictionId, ...output };
}

/** file = { buffer, mimetype, originalname, size } (from multer memory storage). */
export async function predictDisease(user, file, { source, sessionId } = {}) {
  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname || 'leaf.jpg');
  const output = await mlClient.postForm('/predict/disease', form);
  // The image itself isn't stored, only its metadata (keeps the free Atlas tier small).
  const input = { filename: file.originalname, mimetype: file.mimetype, size: file.size };
  const predictionId = await save(user, 'disease', input, output, { source, sessionId });
  return { predictionId, ...output };
}
