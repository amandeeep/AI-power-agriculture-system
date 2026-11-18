// Indian place lookup for the location pickers. Free, no API keys:
//   search  : Photon (OpenStreetMap, built for type-ahead): villages, towns, cities + mandal/taluk, state, PIN
//   reverse : Nominatim (OpenStreetMap): coordinates -> village, mandal/taluk, DISTRICT, state, PIN
//             (Photon rarely has the district, so a picked suggestion is also reverse-geocoded)
//   pincode : India Post: 6-digit PIN -> post offices (villages), block, district, state
// All calls go through the server: results are cached, Nominatim is throttled to 1 request/second
// (its usage policy), and an identifying User-Agent is sent. Data © OpenStreetMap contributors.
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { TtlCache } from '../utils/ttlCache.js';

const DAY = 24 * 60 * 60 * 1000;
const searchCache = new TtlCache({ ttlMs: DAY, maxEntries: 2000 });
const reverseCache = new TtlCache({ ttlMs: 30 * DAY, maxEntries: 5000 });
const pinCache = new TtlCache({ ttlMs: 30 * DAY, maxEntries: 2000 });

export const ATTRIBUTION = '© OpenStreetMap contributors, India Post';
const INDIA_BBOX = '68,6,98,37.5'; // lon_min, lat_min, lon_max, lat_max
const PLACE_KINDS = new Set(['village', 'hamlet', 'town', 'city', 'suburb', 'neighbourhood', 'locality', 'isolated_dwelling', 'administrative', 'county', 'state_district', 'district']);

const clean = (s) => (typeof s === 'string' && s.trim() ? s.trim() : undefined);
const round = (x, d) => Number(Number(x).toFixed(d));

async function getJson(url, what) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': env.PLACES_USER_AGENT, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(10000) });
  } catch (err) {
    throw new HttpError(502, `${what} service is unreachable`, { cause: err.cause?.code || err.name });
  }
  if (!res.ok) throw new HttpError(502, `${what} service returned ${res.status}`);
  return res.json();
}

/** Human-readable one-line label: "Kondapur, Narsapur mandal, Medak, Telangana 502313". */
export function placeLabel(p) {
  const parts = [p.village ?? p.name, p.subDistrict, p.district, p.state].filter(Boolean);
  const unique = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  return `${unique.join(', ')}${p.pincode ? ` ${p.pincode}` : ''}`;
}

// --- search (Photon) -------------------------------------------------------------------------------

export function mapPhotonFeature(f) {
  const p = f.properties ?? {};
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (lat == null || lon == null) return null;
  const place = {
    name: clean(p.name),
    kind: p.osm_value,
    subDistrict: clean(p.county),
    district: clean(p.district),
    state: clean(p.state),
    pincode: clean(p.postcode),
    lat: round(lat, 5),
    lon: round(lon, 5),
  };
  return place.name ? { ...place, label: placeLabel(place) } : null;
}

export async function searchPlaces(q) {
  const key = q.trim().toLowerCase();
  const hit = searchCache.get(key);
  if (hit) return hit;
  const url = new URL(env.PLACES_SEARCH_URL);
  url.search = new URLSearchParams({ q: q.trim(), limit: '12', lang: 'en', bbox: INDIA_BBOX });
  const data = await getJson(url, 'Place search');
  const seen = new Set();
  const results = (data.features ?? [])
    .filter((f) => (f.properties?.countrycode ?? 'IN') === 'IN' && PLACE_KINDS.has(f.properties?.osm_value))
    .map(mapPhotonFeature)
    .filter(Boolean)
    .filter((p) => { // one entry per place (OSM often has a node + a boundary + a station for the same town)
      const k = `${p.name}|${p.subDistrict ?? ''}|${p.state ?? ''}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
  searchCache.set(key, results);
  return results;
}

// --- reverse (Nominatim, max 1 request/second) -----------------------------------------------------

let nominatimQueue = Promise.resolve();
let lastNominatimAt = 0;
function throttled(fn) {
  const run = nominatimQueue.then(async () => {
    const wait = lastNominatimAt + env.PLACES_REVERSE_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    return fn();
  });
  nominatimQueue = run.catch(() => {});
  return run;
}

const stripSuffix = (s, re) => (s ? s.replace(re, '').trim() : s);

export function mapNominatimAddress(a = {}, lat, lon) {
  const place = {
    village: clean(a.village ?? a.hamlet ?? a.town ?? a.city ?? a.suburb ?? a.neighbourhood ?? a.municipality),
    subDistrict: clean(a.county ?? a.subdistrict),
    // Most Indian states: state_district = district, county = mandal/taluk/tehsil.
    district: stripSuffix(clean(a.state_district ?? a.district), /\s+district$/i),
    state: clean(a.state),
    pincode: clean(a.postcode),
    lat: round(lat, 5),
    lon: round(lon, 5),
  };
  return { ...place, label: placeLabel(place) };
}

export async function reversePlace(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`; // ~100 m
  const hit = reverseCache.get(key);
  if (hit) return { ...hit, lat: round(lat, 5), lon: round(lon, 5) };
  const url = new URL(env.PLACES_REVERSE_URL);
  url.search = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: '14', addressdetails: '1', 'accept-language': 'en' });
  const data = await throttled(() => getJson(url, 'Address lookup'));
  if (!data.address) throw new HttpError(404, 'No address found for this location');
  if (data.address.country_code && data.address.country_code !== 'in') throw new HttpError(422, 'This location is outside India');
  const place = mapNominatimAddress(data.address, lat, lon);
  reverseCache.set(key, place);
  return place;
}

// --- PIN code (India Post) -------------------------------------------------------------------------

export async function lookupPincode(pin) {
  const hit = pinCache.get(pin);
  if (hit) return hit;
  const data = await getJson(`${env.PINCODE_URL.replace(/\/$/, '')}/${pin}`, 'PIN code');
  const entry = Array.isArray(data) ? data[0] : data;
  if (entry?.Status !== 'Success' || !entry.PostOffice?.length) throw new HttpError(404, `PIN code ${pin} not found`);
  const offices = entry.PostOffice.map((o) => {
    const place = {
      name: clean(o.Name),
      subDistrict: clean(o.Block) && o.Block !== 'NA' ? clean(o.Block) : undefined,
      district: clean(o.District),
      state: clean(o.State),
      pincode: pin,
    };
    return { ...place, label: placeLabel(place) };
  });
  const result = { pincode: pin, district: offices[0].district, state: offices[0].state, offices };
  pinCache.set(pin, result);
  return result;
}

export function clearPlacesCache() {
  searchCache.clear();
  reverseCache.clear();
  pinCache.clear();
  lastNominatimAt = 0;
}
