// Open-Meteo weather (free, no key): current conditions + 7-day forecast, geocoding, farm risk alerts.
// Results are cached in memory (default 30 min) to stay fast and polite to the free API.
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { TtlCache } from '../utils/ttlCache.js';

const forecastCache = new TtlCache({ ttlMs: env.WEATHER_CACHE_TTL_MS });
const geocodeCache = new TtlCache({ ttlMs: 24 * 60 * 60 * 1000 }); // place names don't move

// WMO weather interpretation codes -> short English text. The client translates codes itself.
const WMO = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};
export const describeWeather = (code) => WMO[code] ?? 'Unknown';

// Thresholds follow IMD conventions where they exist (heavy rain >= 64.5 mm/day, very heavy >= 115.6).
export const ALERT_RULES = {
  HEAVY_RAIN_MM: 64.5,
  VERY_HEAVY_RAIN_MM: 115.6,
  HEAT_C: 40,
  FROST_C: 4,
  STRONG_WIND_KMH: 40,
  FUNGAL_HUMIDITY: 85,
  DRY_SPELL_MM: 2,
};

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch (err) {
    throw new HttpError(502, 'Weather service is unreachable', { cause: err.cause?.code || err.name });
  }
  if (!res.ok) throw new HttpError(502, `Weather service returned ${res.status}`);
  return res.json();
}

export async function geocodeCity(city) {
  const key = city.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached) return cached;

  const url = new URL(env.OPEN_METEO_GEOCODING_URL);
  url.search = new URLSearchParams({ name: city.trim(), count: '1', language: 'en', format: 'json' });
  const data = await getJson(url);
  const hit = data.results?.[0];
  if (!hit) throw new HttpError(404, `Location not found: ${city}`);

  const place = {
    lat: hit.latitude,
    lon: hit.longitude,
    name: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '),
  };
  geocodeCache.set(key, place);
  return place;
}

/** Farm-relevant risk alerts from the forecast. Codes (not sentences), so the UI can translate them. */
export function buildAlerts(current, daily) {
  const R = ALERT_RULES;
  const alerts = [];
  for (const d of daily) {
    if (d.precipitation >= R.VERY_HEAVY_RAIN_MM) alerts.push({ code: 'very_heavy_rain', severity: 'danger', date: d.date, value: d.precipitation, unit: 'mm' });
    else if (d.precipitation >= R.HEAVY_RAIN_MM) alerts.push({ code: 'heavy_rain', severity: 'warning', date: d.date, value: d.precipitation, unit: 'mm' });
    if (d.tMax >= R.HEAT_C) alerts.push({ code: 'heat', severity: 'warning', date: d.date, value: d.tMax, unit: '°C' });
    if (d.tMin <= R.FROST_C) alerts.push({ code: 'frost', severity: 'warning', date: d.date, value: d.tMin, unit: '°C' });
    if (d.windMax >= R.STRONG_WIND_KMH) alerts.push({ code: 'strong_wind', severity: 'warning', date: d.date, value: d.windMax, unit: 'km/h' });
    if ([95, 96, 99].includes(d.weatherCode)) alerts.push({ code: 'thunderstorm', severity: 'warning', date: d.date });
  }
  // Warm + very humid now: classic conditions for fungal diseases (blight, mildew, rust).
  if (current.humidity >= R.FUNGAL_HUMIDITY && current.temperature >= 18 && current.temperature <= 32) {
    alerts.push({ code: 'fungal_risk', severity: 'info', value: current.humidity, unit: '%' });
  }
  const weekRain = daily.reduce((s, d) => s + (d.precipitation ?? 0), 0);
  if (weekRain < R.DRY_SPELL_MM && daily.some((d) => d.tMax >= 35)) {
    alerts.push({ code: 'dry_spell', severity: 'info', value: Number(weekRain.toFixed(1)), unit: 'mm' });
  }
  return alerts;
}

/**
 * Current conditions + 7-day forecast for a point. `cached: true` when served from memory.
 * summary.rainfallMonthlyEstimate is on the crop dataset's rainfall scale (≈ mm per month): the actual
 * rain of the last 30 days (Open-Meteo past_days=30), or the 7-day forecast scaled ×30/7 if history is missing.
 */
export async function getForecast(lat, lon, name) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`; // ~1 km grid, so nearby farms share a cache entry
  const cached = forecastCache.get(key);
  if (cached) return { ...cached, location: { ...cached.location, ...(name ? { name } : {}) }, cached: true };

  const url = new URL(env.OPEN_METEO_FORECAST_URL);
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
    timezone: 'auto',
    forecast_days: '7',
    past_days: '30', // actual rain of the last 30 days -> monthly rainfall on the crop dataset's scale
  });
  const raw = await getJson(url);
  if (!raw.current || !raw.daily) throw new HttpError(502, 'Unexpected response from weather service');

  const c = raw.current;
  const current = {
    time: c.time,
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    precipitation: c.precipitation,
    windSpeed: c.wind_speed_10m,
    weatherCode: c.weather_code,
    description: describeWeather(c.weather_code),
  };
  const d = raw.daily;
  const days = d.time.map((date, i) => ({
    date,
    tMax: d.temperature_2m_max[i],
    tMin: d.temperature_2m_min[i],
    precipitation: d.precipitation_sum[i] ?? 0,
    precipitationProbability: d.precipitation_probability_max?.[i] ?? null,
    windMax: d.wind_speed_10m_max[i],
    weatherCode: d.weather_code[i],
    description: describeWeather(d.weather_code[i]),
  }));
  // The response holds the past 30 days followed by the 7-day forecast; split them at today (local date).
  const today = String(c.time).slice(0, 10);
  const past = days.filter((x) => x.date < today);
  const daily = days.filter((x) => x.date >= today).slice(0, 7);
  const rainfall7d = daily.reduce((s, x) => s + x.precipitation, 0);
  const rainfallPast30d = past.reduce((s, x) => s + x.precipitation, 0);
  // Prefer the actual last-30-days total. If history is missing, fall back to scaling the forecast.
  const rainfallMonthlyEstimate = past.length >= 20
    ? (rainfallPast30d / past.length) * 30
    : (rainfall7d / Math.max(daily.length, 1)) * 30;

  const result = {
    location: { lat, lon, ...(name ? { name } : {}), timezone: raw.timezone },
    current,
    daily,
    summary: {
      rainfall7d: Number(rainfall7d.toFixed(1)),
      rainfallPast30d: past.length ? Number(rainfallPast30d.toFixed(1)) : null,
      rainfallMonthlyEstimate: Number(rainfallMonthlyEstimate.toFixed(1)),
      rainfallMonthlySource: past.length >= 20 ? 'past_30_days' : 'forecast_scaled',
    },
    alerts: buildAlerts(current, daily),
    units: { temperature: '°C', humidity: '%', precipitation: 'mm', windSpeed: 'km/h' },
    source: 'Open-Meteo',
    fetchedAt: new Date().toISOString(),
  };
  forecastCache.set(key, result);
  return { ...result, cached: false };
}

/** Weather in the shape the ML crop endpoint expects (`weather` field), or null if unavailable. */
export async function cropWeatherFor(location) {
  if (location?.lat == null || location?.lon == null) return null;
  try {
    const w = await getForecast(location.lat, location.lon);
    return {
      temperature: w.current.temperature,
      humidity: w.current.humidity,
      rainfall: w.summary.rainfallMonthlyEstimate,
    };
  } catch {
    return null; // live weather is a bonus for scoring, never a reason to fail a prediction
  }
}

export function clearWeatherCache() {
  forecastCache.clear();
  geocodeCache.clear();
}
