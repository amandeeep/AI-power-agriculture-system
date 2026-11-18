// Shared constants used across routes, models and (later) the Gemini orchestrator.
export const LANGUAGES = ['en', 'hi', 'te', 'ta', 'kn'];
export const PREDICTION_TYPES = ['crop', 'fertilizer', 'disease'];
export const PREDICTION_SOURCES = ['chat', 'form'];

// Indian cropping seasons, in the order they occur within an agricultural year (Kharif starts ~June).
export const SEASONS = ['Kharif', 'Rabi', 'Zaid'];
export const SEASON_MONTHS = { Kharif: [6, 7, 8, 9, 10], Rabi: [11, 12, 1, 2], Zaid: [3, 4, 5] };

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
