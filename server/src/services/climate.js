// Historical climate normals from the Open-Meteo archive (ERA5 reanalysis, free, no key).
// For each calendar month: mean temperature, mean relative humidity and the average monthly rainfall
// total over the last CLIMATE_NORMAL_YEARS full years. Monthly rainfall is the crop dataset's scale.
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { TtlCache } from '../utils/ttlCache.js';

const cache = new TtlCache({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxEntries: 200 }); // normals barely change

const round1 = (x) => Math.round(x * 10) / 10;

/** Pure: daily archive arrays -> { 1: {temperature, humidity, rainfall, years}, ..., 12: {...} } */
export function monthlyNormals(daily) {
  const acc = {}; // month -> { t:[], h:[], rainByYear:{year: mm} }
  daily.time.forEach((date, i) => {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    const a = (acc[month] ??= { t: [], h: [], rainByYear: {} });
    const t = daily.temperature_2m_mean?.[i];
    const h = daily.relative_humidity_2m_mean?.[i];
    const r = daily.precipitation_sum?.[i];
    if (t != null) a.t.push(t);
    if (h != null) a.h.push(h);
    if (r != null) a.rainByYear[year] = (a.rainByYear[year] ?? 0) + r;
  });
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const out = {};
  for (const [month, a] of Object.entries(acc)) {
    const yearly = Object.values(a.rainByYear);
    out[month] = {
      temperature: a.t.length ? round1(mean(a.t)) : null,
      humidity: a.h.length ? round1(mean(a.h)) : null,
      rainfall: yearly.length ? round1(mean(yearly)) : null,
      years: yearly.length,
    };
  }
  return out;
}

/** Monthly normals for a point (cached per ~11 km grid cell). Throws HttpError 502 on failure. */
export async function getClimateNormals(lat, lon) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const lastYear = new Date().getUTCFullYear() - 1;
  const firstYear = lastYear - env.CLIMATE_NORMAL_YEARS + 1;
  const url = new URL(env.OPEN_METEO_ARCHIVE_URL);
  url.search = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    start_date: `${firstYear}-01-01`,
    end_date: `${lastYear}-12-31`,
    daily: 'temperature_2m_mean,relative_humidity_2m_mean,precipitation_sum',
    timezone: 'auto',
  });

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw new HttpError(502, 'Climate archive is unreachable', { cause: err.cause?.code || err.name });
  }
  if (!res.ok) throw new HttpError(502, `Climate archive returned ${res.status}`);
  const raw = await res.json();
  if (!raw.daily?.time?.length) throw new HttpError(502, 'Unexpected response from climate archive');

  const result = {
    months: monthlyNormals(raw.daily),
    period: `${firstYear}-${lastYear}`,
    source: 'Open-Meteo archive (ERA5)',
  };
  cache.set(key, result);
  return { ...result, cached: false };
}

export function clearClimateCache() {
  cache.clear();
}
