// The 4 tools Gemini can call, plus their executors. Shared by the AI orchestrator and the basic-mode
// fallback, so both paths produce identical data (and identical Prediction records).
//
// Every executor returns { full, forModel, predictionId? } or { error, forModel }:
//   full     -> stored on the chat message and rendered as a card in the UI
//   forModel -> a compact version sent back to Gemini (fewer tokens = stays within the free tier)
import { HttpError } from '../../utils/httpError.js';
import { Field } from '../../models/Field.js';
import { recommendForLocation } from '../locationRecommend.js';
import { predictCrop, predictDisease, predictFertilizer } from '../predictions.js';
import { geocodeCity, getForecast } from '../weather.js';

export const TOOL_DECLARATIONS = [
  {
    name: 'recommendCrop',
    description:
      'Recommend the best crops for a field from its soil test (N, P, K, pH). Temperature, humidity and rainfall ' +
      'are auto-filled from live weather when the farmer location is known, so only pass them if the farmer gave them. ' +
      'Never guess soil values. If the farmer has no soil test numbers, use recommendCropForLocation instead.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        N: { type: 'number', description: 'Soil nitrogen, kg/ha (0-300)' },
        P: { type: 'number', description: 'Soil phosphorus, kg/ha (0-300)' },
        K: { type: 'number', description: 'Soil potassium, kg/ha (0-400)' },
        ph: { type: 'number', description: 'Soil pH (0-14)' },
        temperature: { type: 'number', description: 'Average temperature, °C (optional)' },
        humidity: { type: 'number', description: 'Relative humidity, % (optional)' },
        rainfall: { type: 'number', description: 'Rainfall, mm per month (optional)' },
      },
      required: ['N', 'P', 'K', 'ph'],
    },
  },
  {
    name: 'recommendCropForLocation',
    description:
      "Recommend crops for one of the farmer's saved fields (or their saved location) WITHOUT soil numbers from the chat. " +
      "Uses the field's own soil test records (or the district's Soil Health Card average), 10-year climate normals for the " +
      'month, the crops grown there in past seasons (crop rotation) and what nearby farms grow. Use it when the farmer asks ' +
      '"what should I grow on my field / in my area" and gives no N, P, K, pH.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        field: { type: 'string', description: "Name of the farmer's field, if they mentioned one (optional)" },
        month: { type: 'integer', description: 'Sowing month 1-12, if the farmer is planning ahead (optional)' },
      },
    },
  },
  {
    name: 'recommendFertilizer',
    description:
      'Fertilizer plan (Urea, DAP, MOP in kg per acre, organic options, excess warnings) for a crop given the soil N, P, K. ' +
      'Supported crops: rice, maize, chickpea, kidneybeans, pigeonpeas, mothbeans, mungbean, blackgram, lentil, pomegranate, ' +
      'banana, mango, grapes, watermelon, muskmelon, apple, orange, papaya, coconut, cotton, jute, coffee.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        crop: { type: 'string', description: 'Crop name in English, e.g. rice, maize, chickpea' },
        N: { type: 'number', description: 'Soil nitrogen, kg/ha' },
        P: { type: 'number', description: 'Soil phosphorus, kg/ha' },
        K: { type: 'number', description: 'Soil potassium, kg/ha' },
      },
      required: ['crop', 'N', 'P', 'K'],
    },
  },
  {
    name: 'detectDisease',
    description:
      'Identify a plant disease from the leaf photo attached to the CURRENT message and return the treatment. ' +
      'Takes no arguments. If no photo is attached, ask the farmer to attach one.',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getWeather',
    description:
      'Current weather, 7-day forecast and farm risk alerts (heavy rain, heat, frost, wind, fungal risk). ' +
      "Leave location empty to use the farmer's saved location.",
    parametersJsonSchema: {
      type: 'object',
      properties: { location: { type: 'string', description: 'City or village name (optional)' } },
    },
  },
];

const CLIMATE = ['temperature', 'humidity', 'rainfall'];
const SOIL = ['N', 'P', 'K', 'ph'];

const toNumber = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const errorResult = (code, message, extra = {}) => ({ error: code, forModel: { error: code, message, ...extra } });

// Devanagari, Bengali, Telugu, Tamil and Kannada digits -> ASCII, so "N ९०" matches 90.
const INDIC_DIGIT_BLOCKS = [0x0966, 0x09e6, 0x0c66, 0x0be6, 0x0ce6];
function normalizeDigits(text) {
  return text.replace(/[०-९০-৯౦-౯௦-௯೦-೯]/g, (ch) => {
    const code = ch.codePointAt(0);
    const base = INDIC_DIGIT_BLOCKS.find((b) => code >= b && code <= b + 9);
    return String(code - base);
  });
}

/**
 * Guard against invented inputs: an LLM sometimes fills in a plausible soil value (e.g. "pH 7") the
 * farmer never gave. A soil value is accepted only if that number appears in the farmer's own
 * messages (this one or recent ones); otherwise it is treated as missing, so the farmer is asked.
 */
function farmerSaid(value, ctx) {
  if (ctx.trustArgs) return true; // basic mode extracts values from the farmer's text itself
  const text = normalizeDigits(ctx.userText ?? '');
  const n = Number(value);
  const forms = new Set([String(n), n.toFixed(1), n.toFixed(2)].map((s) => s.replace('.', '\\.')));
  return [...forms].some((f) => new RegExp(`(^|[^\\d.])${f}(?![\\d])`).test(text));
}

function dropInvented(input, keys, ctx) {
  const invented = [];
  for (const k of keys) {
    if (input[k] !== undefined && !farmerSaid(input[k], ctx)) {
      invented.push(k);
      input[k] = undefined;
    }
  }
  return invented;
}

// --- executors ------------------------------------------------------------------------------------

async function recommendCrop(args, ctx) {
  const input = Object.fromEntries([...SOIL, ...CLIMATE].map((k) => [k, toNumber(args[k])]));
  const notGiven = dropInvented(input, [...SOIL, ...CLIMATE], ctx); // climate falls back to live weather below
  const missingSoil = SOIL.filter((k) => input[k] === undefined);
  if (missingSoil.length) {
    return errorResult('missing_values',
      'Ask the farmer for these soil test values. Do not guess or assume them.',
      { missing: missingSoil, ...(notGiven.length ? { not_stated_by_farmer: notGiven } : {}) });
  }

  // Auto-fill climate values from live weather when the farmer's location is known.
  const autofilled = [];
  const location = ctx.location ?? ctx.user.location;
  if (CLIMATE.some((k) => input[k] === undefined) && location?.lat != null) {
    try {
      const w = await getForecast(location.lat, location.lon);
      const live = { temperature: w.current.temperature, humidity: w.current.humidity, rainfall: w.summary.rainfallMonthlyEstimate };
      for (const k of CLIMATE) {
        if (input[k] === undefined) {
          input[k] = live[k];
          autofilled.push(k);
        }
      }
    } catch {
      /* weather is optional here; handled by the missing check below */
    }
  }
  const missingClimate = CLIMATE.filter((k) => input[k] === undefined);
  if (missingClimate.length) {
    return errorResult('missing_values',
      'Location unknown, so live weather could not fill these. Ask the farmer for them, or to set a location in Profile.',
      { missing: missingClimate });
  }

  const full = await predictCrop(ctx.user, input, { location, source: 'chat', sessionId: ctx.sessionId });
  return {
    full: { ...full, inputs: input, autofilled },
    predictionId: full.predictionId,
    forModel: {
      top: full.top.map(({ crop, final_score, probability, season_score, weather_score, seasons }) =>
        ({ crop, final_score, probability, season_score, weather_score, seasons })),
      current_season: full.current_season,
      score_formula: 'final = 0.6*probability + 0.2*season_score + 0.2*weather_score',
      inputs_used: input,
      autofilled_from_live_weather: autofilled,
      model_confidence: full.confidence,
      model_version: full.model_version,
    },
  };
}

const ROTATION_TEXT = {
  same_as_last_season: 'same crop as last season (rotation advised)',
  repeated_recently: 'grown recently on this field',
  legume_after_non_legume: 'legume after a cereal: restores nitrogen',
  different_family: 'good rotation',
  same_family: 'same crop family as last season',
  perennial: 'perennial (rotation not applicable)',
  unknown_family: 'rotation effect unknown',
};

async function recommendCropForLocation(args, ctx) {
  const fields = await Field.find({ userId: ctx.user._id }).sort({ createdAt: 1 }).lean();
  let field;
  const wanted = String(args.field ?? '').trim().toLowerCase();
  if (wanted) field = fields.find((f) => f.name.toLowerCase() === wanted) ?? fields.find((f) => f.name.toLowerCase().includes(wanted));
  if (!field && fields.length === 1) field = fields[0];
  if (!field && fields.length > 1) {
    return errorResult('which_field', 'The farmer has several fields. Ask which one.', { fields: fields.map((f) => f.name) });
  }
  const month = Number.isInteger(Number(args.month)) && args.month >= 1 && args.month <= 12 ? Number(args.month) : undefined;
  let full;
  try {
    full = await recommendForLocation(ctx.user, { fieldId: field?._id?.toString(), month, ...(field ? {} : ctx.location ?? {}) },
      { source: 'chat', sessionId: ctx.sessionId });
  } catch (err) {
    if (err instanceof HttpError && err.status === 422) {
      return errorResult(err.details?.code ?? 'missing_values',
        err.details?.code === 'no_location'
          ? 'Location unknown. Ask the farmer to add a field with its location (Fields page) or set a location in Profile.'
          : 'No soil records for this field or district. Ask the farmer for their soil test values (N, P, K, pH) or to add a soil test on the Fields page.');
    }
    throw err;
  }
  return {
    full,
    predictionId: full.predictionId,
    forModel: {
      field: full.field?.name ?? null,
      top: full.top.map(({ crop, final_score, probability, season_score, weather_score, rotation_score, rotation_reason, area_score }) => ({
        crop, final_score, probability, season_score, weather_score,
        ...(rotation_score != null ? { rotation_score, rotation: ROTATION_TEXT[rotation_reason] } : {}),
        ...(area_score != null ? { area_score } : {}),
      })),
      weights: full.weights,
      soil_source: full.soil.source,
      soil_values: full.soil.values,
      ...(full.soil.source === 'district_estimate' ? { soil_caution: 'District average, not this field: advise a soil test.' } : {}),
      climate: { source: full.climate.source, month: full.climate.month, temperature: full.climate.temperature, humidity: full.climate.humidity, rainfall_mm: full.climate.rainfall },
      past_crops: full.history.map((h) => `${h.season} ${h.year}: ${h.crop}`),
      nearby_records: full.area.records,
      current_season: full.current_season,
      model_confidence: full.confidence,
      model_version: full.model_version,
    },
  };
}

async function recommendFertilizer(args, ctx) {
  const input = { crop: String(args.crop ?? '').trim(), N: toNumber(args.N), P: toNumber(args.P), K: toNumber(args.K) };
  dropInvented(input, ['N', 'P', 'K'], ctx);
  const missing = ['crop', 'N', 'P', 'K'].filter((k) => input[k] === undefined || input[k] === '');
  if (missing.length) return errorResult('missing_values', 'Ask the farmer for these values.', { missing });

  const full = await predictFertilizer(ctx.user, input, { source: 'chat', sessionId: ctx.sessionId });
  return {
    full,
    predictionId: full.predictionId,
    forModel: {
      crop: full.crop,
      nutrients: Object.fromEntries(Object.entries(full.nutrients).map(([n, v]) => [n, { status: v.status, actual: v.actual, ideal: v.ideal }])),
      fertilizers_per_acre: full.fertilizers.map((f) => ({ name: f.name, grade: f.grade, kg_per_acre: f.kg_per_acre, when: f.when })),
      warnings: full.warnings,
      organic_alternatives: Object.fromEntries(Object.entries(full.organic_alternatives).map(([n, list]) => [n, list.slice(0, 2)])),
      disclaimer: full.disclaimer,
      model_version: full.model_version,
    },
  };
}

async function detectDisease(_args, ctx) {
  if (!ctx.image) return errorResult('no_image', 'No photo attached. Ask the farmer to attach a clear photo of the affected leaf.');
  const full = await predictDisease(ctx.user, ctx.image, { source: 'chat', sessionId: ctx.sessionId });
  const t = full.treatment;
  return {
    full,
    predictionId: full.predictionId,
    forModel: {
      result: full.uncertain ? 'uncertain' : full.label,
      crop: full.crop,
      disease: full.disease,
      confidence: full.confidence,
      healthy: full.healthy,
      top3: full.top3?.map(({ crop, disease, confidence }) => ({ crop, disease, confidence })),
      ...(t ? { symptoms: t.symptoms, organic: t.organic.slice(0, 2), chemical: t.chemical.slice(0, 2), prevention: t.prevention.slice(0, 2) } : {}),
      message: full.message,
      disclaimer: full.disclaimer,
      model_version: full.model_version,
    },
  };
}

async function getWeather(args, ctx) {
  let place;
  const name = String(args.location ?? '').trim();
  if (name) place = await geocodeCity(name);
  else {
    const loc = ctx.location ?? ctx.user.location;
    if (loc?.lat == null) return errorResult('no_location', "Farmer location unknown. Ask for their city or village, or to set it in Profile.");
    place = { lat: loc.lat, lon: loc.lon, name: loc.city };
  }
  const full = await getForecast(place.lat, place.lon, place.name);
  return {
    full,
    forModel: {
      location: full.location.name ?? `${place.lat},${place.lon}`,
      current: full.current,
      next_7_days: full.daily.map(({ date, tMin, tMax, precipitation, precipitationProbability, description }) =>
        ({ date, tMin, tMax, rain_mm: precipitation, rain_chance: precipitationProbability, description })),
      rain_7d_mm: full.summary.rainfall7d,
      alerts: full.alerts,
    },
  };
}

const EXECUTORS = { recommendCrop, recommendCropForLocation, recommendFertilizer, detectDisease, getWeather };

// What Gemini should tell the farmer when a backing service is down (so it doesn't blame the photo, etc.).
const UNAVAILABLE_HINTS = {
  detectDisease:
    'Photo diagnosis is temporarily unavailable (the disease model is not running). This is NOT a problem with the photo: ' +
    'do not ask for a new photo. Tell the farmer it is unavailable right now, give only general safe advice based on the ' +
    'symptoms they described, and suggest showing the leaf to the local Krishi Vigyan Kendra / agriculture officer.',
  recommendCrop: 'Crop recommendation is temporarily unavailable. Ask the farmer to try again later.',
  recommendCropForLocation: 'Location-based crop recommendation is temporarily unavailable. Ask the farmer to try again later.',
  recommendFertilizer: 'Fertilizer advice is temporarily unavailable. Ask the farmer to try again later.',
  getWeather: 'Weather data is temporarily unavailable. Ask the farmer to try again later.',
};

/**
 * Runs one tool. Never throws: service failures (ML down, unknown crop, weather outage) become
 * { error } results so Gemini (or the fallback) can explain them to the farmer.
 */
export async function executeTool(name, args = {}, ctx) {
  const fn = EXECUTORS[name];
  if (!fn) return errorResult('unknown_tool', `Unknown tool ${name}`);
  try {
    return await fn(args, ctx);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 503 || status === 502) {
      return errorResult('service_unavailable', UNAVAILABLE_HINTS[name] ?? 'This service is temporarily unavailable.', { status });
    }
    return errorResult('tool_failed', err.message, {
      status,
      ...(err.details?.supported_crops ? { supported_crops: err.details.supported_crops } : {}),
    });
  }
}
