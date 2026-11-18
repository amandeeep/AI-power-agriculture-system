// Test harness: in-memory MongoDB + one local HTTP server that impersonates both the Python ML
// service and Open-Meteo. Everything runs offline and deterministically.
// Import this BEFORE the app: it sets process.env so src/config/env.js picks up the fake URLs.
import http from 'node:http';
import { once } from 'node:events';

export const INTERNAL_KEY = 'test-internal-key';

export const fake = {
  calls: [],          // { method, path, headers, body } for every request
  forecastCalls: 0,
  placeCalls: [],     // queries that reached the fake Photon / Nominatim
  archiveDown: false, // simulate the Open-Meteo climate archive failing (-> live weather fallback)
  districtSoil: null, // set to an object to make the fake ML /soil/district answer; null = 503 (not installed)
  mlDown: false,      // simulate the ML service being unreachable (returns 503 like FastAPI would for a missing model)
  // Fake Gemini: each generateContent request takes the next scripted reply.
  // An entry is a response body, { status, body } for an HTTP error, or { delayMs } to simulate a hang.
  gemini: [],
  geminiRequests: [], // parsed request bodies, in order
  reset() {
    this.calls = [];
    this.forecastCalls = 0;
    this.mlDown = false;
    this.archiveDown = false;
    this.placeCalls = [];
    this.districtSoil = null;
    this.gemini = [];
    this.geminiRequests = [];
  },
};

/** Builders for scripted Gemini replies. */
export const gem = {
  text: (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }),
  call: (name, args = {}) => ({
    candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: `call-${name}`, name, args } }] }, finishReason: 'STOP' }],
  }),
  error: (status) => ({ status, body: { error: { code: status, message: `fake ${status}`, status: 'ERR' } } }),
  hang: (delayMs) => ({ delayMs }),
};

export const CROP_RESPONSE = {
  top: [
    { crop: 'rice', probability: 0.98, season_score: 1, weather_score: 0.9, final_score: 0.968, seasons: ['Kharif'], weather_detail: {} },
    { crop: 'jute', probability: 0.01, season_score: 1, weather_score: 0.8, final_score: 0.366, seasons: ['Kharif'], weather_detail: {} },
  ],
  confidence: 0.98, current_season: 'Kharif', month: 7, weights: { probability: 0.6, season: 0.2, weather: 0.2 },
  model_version: 'crop-stack-test',
};

// 30 past days (5 mm each = 150 mm/month) followed by the 7-day forecast, like past_days=30 returns.
const PAST_DATES = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 6, 10 - 30 + i)).toISOString().slice(0, 10));
const withPast = (arr, pastValue) => [...PAST_DATES.map(() => pastValue), ...arr];
const FORECAST_7 = {
  timezone: 'Asia/Kolkata',
  current: { time: '2026-07-10T09:00', temperature_2m: 27.5, relative_humidity_2m: 90, precipitation: 1.2, weather_code: 61, wind_speed_10m: 12 },
  daily: {
    time: ['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'],
    weather_code: [61, 65, 95, 3, 2, 1, 0],
    temperature_2m_max: [31, 30, 29, 33, 41, 34, 33],
    temperature_2m_min: [24, 23, 23, 24, 26, 25, 24],
    precipitation_sum: [10, 80, 120, 0, 0, 0, 0], // 210 mm in 7 days
    precipitation_probability_max: [80, 95, 99, 10, 5, 5, 0],
    wind_speed_10m_max: [15, 45, 30, 10, 10, 10, 10],
  },
};
const FORECAST = {
  ...FORECAST_7,
  daily: {
    time: [...PAST_DATES, ...FORECAST_7.daily.time],
    weather_code: withPast(FORECAST_7.daily.weather_code, 61),
    temperature_2m_max: withPast(FORECAST_7.daily.temperature_2m_max, 30),
    temperature_2m_min: withPast(FORECAST_7.daily.temperature_2m_min, 22),
    precipitation_sum: withPast(FORECAST_7.daily.precipitation_sum, 5),
    precipitation_probability_max: withPast(FORECAST_7.daily.precipitation_probability_max, null),
    wind_speed_10m_max: withPast(FORECAST_7.daily.wind_speed_10m_max, 10),
  },
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const raw = await readBody(req);
  const isJson = (req.headers['content-type'] || '').includes('json');
  const body = isJson && raw.length ? JSON.parse(raw) : raw;
  fake.calls.push({ method: req.method, path: url.pathname, headers: req.headers, body, query: url.searchParams });

  // --- Gemini (SDK baseUrl points here) ---
  if (url.pathname.includes(':generateContent')) {
    fake.geminiRequests.push(body);
    const next = fake.gemini.shift() ?? gem.text('(no scripted reply)');
    if (next.delayMs) {
      await new Promise((r) => setTimeout(r, next.delayMs));
      return send(res, 200, gem.text('too late'));
    }
    if (next.status) return send(res, next.status, next.body);
    return send(res, 200, next);
  }

  // --- Open-Meteo ---
  if (url.pathname === '/v1/forecast') {
    fake.forecastCalls += 1;
    return send(res, 200, FORECAST);
  }
  if (url.pathname === '/v1/archive') {
    if (fake.archiveDown) return send(res, 500, { error: true });
    // Two years of daily data: every day 25 °C, 70 % RH, 4 mm rain (-> ~124 mm in a 31-day month).
    const start = Number(url.searchParams.get('start_date').slice(0, 4));
    const end = Number(url.searchParams.get('end_date').slice(0, 4));
    const time = [];
    for (let d = new Date(Date.UTC(Math.max(start, end - 1), 0, 1)); d.getUTCFullYear() <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      time.push(d.toISOString().slice(0, 10));
    }
    return send(res, 200, { daily: {
      time,
      temperature_2m_mean: time.map(() => 25),
      relative_humidity_2m_mean: time.map(() => 70),
      precipitation_sum: time.map(() => 4),
    } });
  }
  // --- Places: Photon search, Nominatim reverse, India Post PIN ---
  if (url.pathname === '/photon/api') {
    fake.placeCalls.push(url.searchParams.get('q'));
    const feat = (name, osm_value, county, state, postcode, lon, lat, countrycode = 'IN') =>
      ({ geometry: { coordinates: [lon, lat] }, properties: { name, osm_value, county, state, postcode, countrycode } });
    return send(res, 200, { features: [
      feat('Kondapur', 'village', 'Narsapur mandal', 'Telangana', '502313', 78.29535, 17.71083),
      feat('Kondapur', 'village', 'Narsapur mandal', 'Telangana', '502313', 78.2954, 17.7109), // duplicate node
      feat('Kondapur', 'station', 'Narsapur mandal', 'Telangana', null, 78.3, 17.7),             // not a place
      feat('Kondapur', 'hamlet', 'Manoharabad mandal', 'Telangana', '502336', 78.51096, 17.72882),
      feat('Kondapur', 'village', 'X', 'Somewhere', null, 80, 10, 'LK'),                          // outside India
    ] });
  }
  if (url.pathname === '/nominatim/reverse') {
    fake.placeCalls.push(`reverse ${url.searchParams.get('lat')},${url.searchParams.get('lon')}`);
    return send(res, 200, { address: {
      village: 'Mamidipally', county: 'Balapur mandal', state_district: 'Ranga Reddy District', state: 'Telangana',
      postcode: '509218', country_code: 'in',
    } });
  }
  if (url.pathname.startsWith('/pincode/')) {
    const pin = url.pathname.split('/').pop();
    if (pin !== '508001') return send(res, 200, [{ Status: 'Error', PostOffice: null }]);
    return send(res, 200, [{ Status: 'Success', PostOffice: [
      { Name: 'Bottuguda', Block: 'Nalgonda', District: 'Nalgonda', State: 'Telangana' },
      { Name: 'Panagal', Block: 'NA', District: 'Nalgonda', State: 'Telangana' },
    ] }]);
  }

  if (url.pathname === '/v1/search') {
    const name = url.searchParams.get('name');
    if (name.toLowerCase() === 'hyderabad') {
      return send(res, 200, { results: [{ name: 'Hyderabad', admin1: 'Telangana', country: 'India', latitude: 17.38, longitude: 78.46 }] });
    }
    return send(res, 200, {});
  }

  // --- ML service ---
  if (url.pathname === '/health') return send(res, 200, { status: 'ok', models: { crop: { loaded: true } } });
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) return send(res, 401, { detail: 'Invalid or missing X-Internal-Key' });
  if (fake.mlDown) return send(res, 503, { detail: { message: 'disease model is not available.', reason: 'missing' } });

  if (url.pathname === '/predict/crop') {
    if (!body.context) return send(res, 200, CROP_RESPONSE);
    // Echo enough of the context back to assert on (same shape as the real ML service).
    const prev = body.context.previous_crops ?? [];
    const top = CROP_RESPONSE.top.map((t) => ({ ...t, rotation_score: prev.length ? (t.crop === prev[0] ? 0 : 0.8) : null,
      rotation_reason: prev.length ? (t.crop === prev[0] ? 'same_as_last_season' : 'different_family') : null,
      area_score: Object.keys(body.context.area_counts ?? {}).length ? 0.5 : null }));
    const records = Object.values(body.context.area_counts ?? {}).reduce((a, b) => a + b, 0);
    return send(res, 200, { ...CROP_RESPONSE, top, soil_source: body.context.soil_source, area_records: records,
      weights: { probability: 0.48, season: 0.16, weather: 0.16, rotation: 0.1, area: 0.1 } });
  }
  if (url.pathname === '/soil/district') {
    if (!fake.districtSoil) return send(res, 503, { detail: { message: 'District soil data is not available yet.' } });
    // Like the real service: coordinates inside fake.districtSoil.bbox win, else the district name.
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    const box = fake.districtSoil.bbox; // [lon0, lat0, lon1, lat1], optional
    const byCoords = box && url.searchParams.has('lat') && lon >= box[0] && lat >= box[1] && lon <= box[2] && lat <= box[3];
    const byName = (url.searchParams.get('district') ?? '').toLowerCase() === fake.districtSoil.district.toLowerCase();
    if (!byCoords && !byName) return send(res, 404, { detail: { message: 'No soil data for this location.' } });
    return send(res, 200, { ...fake.districtSoil, soil_source: 'district_estimate', matched_by: byCoords ? 'coordinates' : 'name',
      version: 'shc-test', scale_note: 'test', source: 'SHC test' });
  }
  if (url.pathname === '/predict/fertilizer') {
    if (body.crop === 'wheat') return send(res, 422, { detail: { message: "Unknown crop 'wheat'.", supported_crops: ['rice'] } });
    // Same shape as ml-service/app/services/fertilizer.py
    return send(res, 200, {
      crop: body.crop,
      nutrients: {
        N: { actual: body.N, ideal: 79.89, difference: body.N - 79.89, status: 'deficient', unit: 'kg/ha' },
        P: { actual: body.P, ideal: 47.58, difference: body.P - 47.58, status: 'deficient', unit: 'kg/ha' },
        K: { actual: body.K, ideal: 39.87, difference: body.K - 39.87, status: 'excess', unit: 'kg/ha' },
      },
      fertilizers: [
        { name: 'Urea', grade: '46% N', nutrient: 'N', kg_per_acre: 27.3, kg_per_ha: 67.5, when: 'Split doses' },
        { name: 'DAP', grade: '18-46-0', nutrient: 'P', kg_per_acre: 19.9, kg_per_ha: 49.1, when: 'Basal' },
      ],
      organic_alternatives: { N: ['FYM', 'Vermicompost', 'Neem cake'], P: ['Rock phosphate'] },
      warnings: ['Potassium is already high: skip MOP.'],
      balanced: false, method: 'rule-based', confidence: null,
      model_version: 'fertilizer-rules-v1', disclaimer: 'Consult your local Krishi Vigyan Kendra / soil test lab.',
    });
  }
  if (url.pathname === '/predict/disease') {
    const multipart = (req.headers['content-type'] || '').startsWith('multipart/form-data');
    if (!multipart || !raw.includes('name="file"')) return send(res, 422, { detail: [{ loc: ['body', 'file'], msg: 'Field required' }] });
    return send(res, 200, {
      label: 'Tomato___Late_blight', crop: 'Tomato', disease: 'Late blight', confidence: 0.91, uncertain: false, healthy: false,
      top3: [{ label: 'Tomato___Late_blight', crop: 'Tomato', disease: 'Late blight', confidence: 0.91 }],
      treatment: { pathogen: 'Water mould', symptoms: 'Dark patches', organic: ['Remove infected plants'], chemical: ['Mancozeb 75% WP @ 2.5 g/L'], prevention: ['Avoid overhead irrigation'] },
      disclaimer: 'Follow the label.', model_version: 'disease-test',
    });
  }
  send(res, 404, { detail: 'Not Found' });
}

/** Boots fake services + in-memory Mongo, configures env, and returns the app and helpers. */
export async function setup() {
  const server = http.createServer((req, res) => handle(req, res).catch((e) => send(res, 500, { detail: e.message })));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGODB_URI: '',
    JWT_SECRET: 'test-jwt-secret-at-least-16',
    ML_SERVICE_URL: base,
    ML_INTERNAL_KEY: INTERNAL_KEY,
    OPEN_METEO_FORECAST_URL: `${base}/v1/forecast`,
    OPEN_METEO_GEOCODING_URL: `${base}/v1/search`,
    OPEN_METEO_ARCHIVE_URL: `${base}/v1/archive`,
    PLACES_SEARCH_URL: `${base}/photon/api`,
    PLACES_REVERSE_URL: `${base}/nominatim/reverse`,
    PLACES_REVERSE_MIN_INTERVAL_MS: '0',
    PINCODE_URL: `${base}/pincode`,
    GEMINI_API_KEY: 'test-gemini-key',
    GEMINI_BASE_URL: base,
    GEMINI_MODEL: 'gemini-test',
    GEMINI_TIMEOUT_MS: '3500',
    GEMINI_ATTEMPT_TIMEOUT_MS: '1000',
    CHAT_RATE_LIMIT_MAX: '1000',
  });

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mongo = await MongoMemoryServer.create();
  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(mongo.getUri());

  const { createApp } = await import('../../src/app.js');
  const { default: request } = await import('supertest');
  const app = createApp();

  return {
    app,
    request: () => request(app),
    async teardown() {
      await mongoose.disconnect();
      await mongo.stop();
      server.close();
    },
  };
}

let counter = 0;
/** Registers a fresh user and returns { token, user, auth } where auth is the header value. */
export async function newUser(api, extra = {}) {
  counter += 1;
  const res = await api()
    .post('/api/auth/register')
    .send({ name: `Farmer ${counter}`, email: `farmer${counter}@example.com`, password: 'secret123', ...extra })
    .expect(201);
  return { ...res.body, auth: `Bearer ${res.body.token}` };
}
