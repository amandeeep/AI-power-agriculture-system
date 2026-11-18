// Location-based crop recommendation (Phase 6.5).
//
// Soil   : manual values > the field's own soil tests (recency-weighted, with trend) > district estimate
//          from Soil Health Card aggregates (ML service /soil/district).
// Climate: 10-year monthly normals for the target month (Open-Meteo archive); live weather as a fallback.
// Context: the field's past crops (rotation score) + anonymous counts of crops grown/recommended
//          by OTHER farmers within AREA_RADIUS_KM (area score). The ML service does the scoring.
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { SEASON_MONTHS } from '../config/constants.js';
import { CropHistory } from '../models/CropHistory.js';
import { Field } from '../models/Field.js';
import { Prediction } from '../models/Prediction.js';
import { SoilTest } from '../models/SoilTest.js';
import { HttpError } from '../utils/httpError.js';
import { getClimateNormals } from './climate.js';
import { mlClient } from './mlClient.js';
import { predictCropWithPayload } from './predictions.js';
import { cropWeatherFor } from './weather.js';

const SOIL_KEYS = ['N', 'P', 'K', 'ph'];
const SOIL_HALF_LIFE_DAYS = 365; // a test one year old counts half as much as one from today
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_SEASONS = 6;
const AREA_YEARS = 3;

// Sowing order within a calendar year: Zaid (Mar) -> Kharif (Jun) -> Rabi (Nov).
const SOWING_ORDER = { Zaid: 0, Kharif: 1, Rabi: 2 };
export const seasonSortKey = (h) => h.year * 10 + SOWING_ORDER[h.season];

const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// --- soil ------------------------------------------------------------------------------------------

/** Pure: recency-weighted soil values + per-year trend (least squares) from tests sorted any way. */
export function summarizeSoilTests(tests, now = new Date()) {
  if (!tests.length) return null;
  const weights = tests.map((t) => 0.5 ** (Math.max(0, now - new Date(t.testedAt)) / DAY_MS / SOIL_HALF_LIFE_DAYS));
  const wSum = weights.reduce((s, w) => s + w, 0);
  const values = Object.fromEntries(SOIL_KEYS.map((k) =>
    [k, round(tests.reduce((s, t, i) => s + t[k] * weights[i], 0) / wSum, k === 'ph' ? 2 : 1)]));

  let trend = null;
  const years = tests.map((t) => new Date(t.testedAt).getTime() / (365.25 * DAY_MS));
  const spanYears = Math.max(...years) - Math.min(...years);
  if (tests.length >= 2 && spanYears >= 0.25) {
    const my = years.reduce((s, y) => s + y, 0) / years.length;
    const den = years.reduce((s, y) => s + (y - my) ** 2, 0);
    trend = Object.fromEntries(SOIL_KEYS.map((k) => {
      const mv = tests.reduce((s, t) => s + t[k], 0) / tests.length;
      const slope = tests.reduce((s, t, i) => s + (years[i] - my) * (t[k] - mv), 0) / den;
      return [k, round(slope, k === 'ph' ? 2 : 1)];
    }));
  }
  const latest = tests.reduce((a, b) => (new Date(a.testedAt) > new Date(b.testedAt) ? a : b));
  return { values, trendPerYear: trend, testsUsed: tests.length, latestTestAt: latest.testedAt };
}

// Coordinates first (the ML service finds the district polygon: no spelling problems), name as fallback.
async function districtSoil(state, district, location) {
  if (!district && location?.lat == null) return null;
  const q = new URLSearchParams({
    ...(location?.lat != null ? { lat: String(location.lat), lon: String(location.lon) } : {}),
    ...(district ? { district } : {}),
    ...(state ? { state } : {}),
  });
  try {
    return await mlClient.getJson(`/soil/district?${q}`);
  } catch (err) {
    if (err instanceof HttpError && [404, 409, 503].includes(err.status)) return { unavailable: err.status, message: err.message, details: err.details };
    throw err;
  }
}

async function resolveSoil({ manual, field, state, district, location }) {
  if (manual && SOIL_KEYS.every((k) => manual[k] != null)) {
    return { source: 'manual', values: Object.fromEntries(SOIL_KEYS.map((k) => [k, manual[k]])) };
  }
  if (field) {
    const tests = await SoilTest.find({ fieldId: field._id }).sort({ testedAt: -1 }).limit(20).lean();
    const summary = summarizeSoilTests(tests);
    if (summary) return { source: 'field_tests', ...summary };
  }
  const d = await districtSoil(field?.state ?? state, field?.district ?? district, location);
  if (d && !d.unavailable) {
    return {
      source: 'district_estimate',
      values: Object.fromEntries(SOIL_KEYS.map((k) => [k, d[k]])),
      district: {
        state: d.state, district: d.district, samples: d.samples, confidence: d.confidence ?? null, version: d.version,
        year: d.year, matchedBy: d.matched_by, status: d.status, history: d.history,
      },
      note: d.scale_note,
      source_name: d.source,
    };
  }
  throw new HttpError(422, 'No soil data for this location. Add a soil test for the field, or enter N, P, K and pH.', {
    code: 'no_soil_data',
    ...(d?.unavailable === 409 ? { district_ambiguous: d.details?.states } : {}),
    ...(d?.unavailable === 503 ? { district_data: 'not_installed' } : {}),
    ...(d?.unavailable === 404 ? { district_data: 'district_not_found' } : {}),
  });
}

// --- climate ---------------------------------------------------------------------------------------

async function resolveClimate(location, month) {
  try {
    const normals = await getClimateNormals(location.lat, location.lon);
    const m = normals.months[month];
    if (m && m.temperature != null && m.humidity != null && m.rainfall != null) {
      return { source: 'climate_normals', period: normals.period, month, temperature: m.temperature, humidity: m.humidity, rainfall: m.rainfall };
    }
  } catch {
    /* fall through to live weather */
  }
  const live = await cropWeatherFor(location);
  if (live) return { source: 'live_weather', month, ...live };
  throw new HttpError(502, 'Climate data is unavailable for this location right now. Try again later.');
}

// --- history + area --------------------------------------------------------------------------------

async function previousCrops(field) {
  if (!field) return [];
  const rows = await CropHistory.find({ fieldId: field._id }).lean();
  return rows.sort((a, b) => seasonSortKey(b) - seasonSortKey(a)).slice(0, HISTORY_SEASONS)
    .map(({ year, season, crop, yieldQuintalPerAcre }) => ({ year, season, crop, yieldQuintalPerAcre }));
}

export const seasonOfMonth = (month) => Object.keys(SEASON_MONTHS).find((s) => SEASON_MONTHS[s].includes(month));

/**
 * Anonymous crop counts from OTHER farmers within the radius, for the same season as the target month:
 * grown (last 3 years) + recommended (last year). Kharif crops must not count as "popular" for Rabi.
 */
export async function areaCounts(location, userId, season, radiusKm = env.AREA_RADIUS_KM) {
  const within = { $geoWithin: { $centerSphere: [[location.lon, location.lat], radiusKm / 6378.1] } };
  const others = { $ne: new mongoose.Types.ObjectId(String(userId)) };
  const fieldIds = await Field.find({ geo: within, userId: others }).distinct('_id');
  const minYear = new Date().getUTCFullYear() - AREA_YEARS;
  const [grown, recommended] = await Promise.all([
    fieldIds.length
      ? CropHistory.aggregate([
        { $match: { fieldId: { $in: fieldIds }, year: { $gte: minYear }, season } },
        { $group: { _id: '$crop', n: { $sum: 1 } } },
      ])
      : [],
    Prediction.aggregate([
      { $match: { type: 'crop', geo: within, userId: others, 'output.current_season': season, createdAt: { $gte: new Date(Date.now() - 365 * DAY_MS) } } },
      { $project: { crop: { $arrayElemAt: ['$output.top.crop', 0] } } },
      { $match: { crop: { $type: 'string' } } },
      { $group: { _id: '$crop', n: { $sum: 1 } } },
    ]),
  ]);
  const counts = {};
  for (const { _id, n } of [...grown, ...recommended]) counts[_id] = (counts[_id] ?? 0) + n;
  return counts;
}

// --- entry point -----------------------------------------------------------------------------------

/**
 * opts: { fieldId?, lat?, lon?, state?, district?, month?, soil?: {N,P,K,ph} }
 * Returns the ML output plus the soil / climate / history / area evidence behind it.
 */
export async function recommendForLocation(user, opts, { source = 'form', sessionId } = {}) {
  let field = null;
  if (opts.fieldId) {
    field = await Field.findOne({ _id: opts.fieldId, userId: user._id });
    if (!field) throw new HttpError(404, 'Field not found');
  }
  const location = field?.lat != null
    ? { lat: field.lat, lon: field.lon }
    : opts.lat != null && opts.lon != null ? { lat: opts.lat, lon: opts.lon } : user.location?.lat != null ? user.location : null;
  if (!location) throw new HttpError(422, 'Location unknown. Choose a field with a location, or set one in your profile.', { code: 'no_location' });

  const month = opts.month ?? new Date().getMonth() + 1;
  const [soil, climate, history, area] = await Promise.all([
    resolveSoil({ manual: opts.soil, field, state: opts.state ?? user.location?.state, district: opts.district ?? user.location?.district, location }),
    resolveClimate(location, month),
    previousCrops(field),
    areaCounts(location, user._id, seasonOfMonth(month)),
  ]);

  const payload = {
    ...soil.values,
    temperature: climate.temperature,
    humidity: climate.humidity,
    rainfall: climate.rainfall,
    month,
    context: { previous_crops: history.map((h) => h.crop), area_counts: area, soil_source: soil.source },
  };
  const out = await predictCropWithPayload(user, payload, { location, source, sessionId });
  return {
    ...out,
    field: field ? field.toJSON() : null,
    location,
    soil,
    climate,
    history,
    area: { season: seasonOfMonth(month), radiusKm: env.AREA_RADIUS_KM, records: out.area_records ?? 0, used: Object.keys(area).length > 0 && out.top.some((t) => t.area_score != null) },
  };
}

