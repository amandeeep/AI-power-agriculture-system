// Loads and validates all configuration from environment variables (server/.env).
// Anything misconfigured fails fast at startup with a readable message.
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  MONGODB_URI: z.string().optional().default(''),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  ML_SERVICE_URL: z.string().url().default('http://127.0.0.1:8000'),
  ML_INTERNAL_KEY: z.string().min(1, 'ML_INTERNAL_KEY is required'),
  ML_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),
  GEMINI_THINKING_LEVEL: z.enum(['', 'minimal', 'low', 'medium', 'high']).default('minimal'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(15000), // total Gemini budget per message
  GEMINI_ATTEMPT_TIMEOUT_MS: z.coerce.number().int().positive().default(8000), // per attempt; one retry if time remains
  GEMINI_BASE_URL: z.string().url().optional(), // tests only: point the SDK at a fake Gemini server

  OPEN_METEO_FORECAST_URL: z.string().url().default('https://api.open-meteo.com/v1/forecast'),
  OPEN_METEO_GEOCODING_URL: z.string().url().default('https://geocoding-api.open-meteo.com/v1/search'),
  WEATHER_CACHE_TTL_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  OPEN_METEO_ARCHIVE_URL: z.string().url().default('https://archive-api.open-meteo.com/v1/archive'),
  CLIMATE_NORMAL_YEARS: z.coerce.number().int().min(1).max(30).default(10),

  // Address helpers (/api/places): free OpenStreetMap + India Post services, no keys.
  PLACES_SEARCH_URL: z.string().url().default('https://photon.komoot.io/api'),
  PLACES_REVERSE_URL: z.string().url().default('https://nominatim.openstreetmap.org/reverse'),
  PLACES_REVERSE_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(1100), // Nominatim policy: max 1 req/s
  PINCODE_URL: z.string().url().default('https://api.postalpincode.in/pincode'),
  PLACES_USER_AGENT: z.string().default('agri-dss/0.1 (B.Tech student project)'),

  // Location-based recommendation: radius for "popular in your area" counts.
  AREA_RADIUS_KM: z.coerce.number().positive().max(200).default(25),

  CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  CHAT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid server configuration (check server/.env):');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  clientOrigins: parsed.data.CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
});
