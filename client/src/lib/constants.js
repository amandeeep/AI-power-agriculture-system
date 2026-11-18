// UI constants shared by pages and components.

export const LANGUAGES = [
  { code: 'en', native: 'English', speech: 'en-IN' },
  { code: 'hi', native: 'हिन्दी', speech: 'hi-IN' },
  { code: 'te', native: 'తెలుగు', speech: 'te-IN' },
  { code: 'ta', native: 'தமிழ்', speech: 'ta-IN' },
  { code: 'kn', native: 'ಕನ್ನಡ', speech: 'kn-IN' },
];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

// The 22 crops the models know (dataset labels). Display names come from i18n: t(`crops.${id}`).
export const CROPS = [
  'rice', 'maize', 'chickpea', 'kidneybeans', 'pigeonpeas', 'mothbeans', 'mungbean', 'blackgram', 'lentil',
  'pomegranate', 'banana', 'mango', 'grapes', 'watermelon', 'muskmelon', 'apple', 'orange', 'papaya',
  'coconut', 'cotton', 'jute', 'coffee',
];

// Form ranges mirror the server/ML validation. `typical` is shown as a helpful hint.
export const RANGES = {
  N: { min: 0, max: 300, step: 1, typical: '0–140', unit: 'kg/ha' },
  P: { min: 0, max: 300, step: 1, typical: '5–145', unit: 'kg/ha' },
  K: { min: 0, max: 400, step: 1, typical: '5–205', unit: 'kg/ha' },
  ph: { min: 0, max: 14, step: 0.1, typical: '3.5–9.9', unit: '' },
  temperature: { min: -20, max: 60, step: 0.1, typical: '8–44', unit: '°C' },
  humidity: { min: 0, max: 100, step: 1, typical: '14–100', unit: '%' },
  rainfall: { min: 0, max: 5000, step: 1, typical: '20–300', unit: 'mm' },
};

// Validated categorical chart palette (slots 1-5), used in a fixed order. Slots 4-5 only appear in the
// location-based score (rotation, nearby farms); the 5-slot set passes the CVD check (worst adjacent ΔE 9.1).
export const SERIES = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', magenta: '#e87ba4' };
export const SEASONS = ['Kharif', 'Rabi', 'Zaid'];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** WMO weather code -> i18n key under `weatherCodes.` */
export function weatherKey(code) {
  if (code === 0) return 'clear';
  if (code === 1) return 'mainlyClear';
  if (code === 2) return 'partlyCloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 61 || code === 63) return 'rain';
  if (code === 65) return 'heavyRain';
  if (code === 66 || code === 67) return 'freezingRain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 95) return 'thunderstorm';
  return 'unknown';
}

/** Locale for Intl date formatting, e.g. "hi-IN". */
export const intlLocale = (lang) => `${lang || 'en'}-IN`;
