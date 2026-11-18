// Basic mode: used when Gemini is rate-limited (429), failing (5xx), slow (>15 s) or not configured.
// A keyword router picks the intent, the matching service is called directly through the shared tool
// executors, and the reply is built from pre-written templates in the farmer's language.
import { executeTool } from '../chat/tools.js';
import { detectIntent, extractCity, extractCrop, extractSoil } from './intents.js';
import { nutrientName, render } from './templates.js';

const pct = (x) => Math.round((x ?? 0) * 100);

function renderCrop(lang, r) {
  if (r.error === 'missing_values') {
    return render(lang, 'askSoil', { missing: r.forModel.missing.map((n) => nutrientName(lang, n) ?? n).join(', ') });
  }
  if (r.error) return render(lang, 'serviceDown');
  const lines = r.full.top.map((c, i) => render(lang, 'cropLine', {
    i: i + 1, crop: c.crop, final: pct(c.final_score), prob: pct(c.probability), season: pct(c.season_score), weather: pct(c.weather_score),
  }));
  return [render(lang, 'cropHeader'), ...lines].join('\n');
}

// Location-based result renders like a normal crop result; if it failed (no field, no soil records),
// fall back to asking for the soil test values, as for a plain crop request.
function renderCropForLocation(lang, r) {
  if (r.error && r.error !== 'service_unavailable') {
    return render(lang, 'askSoil', { missing: ['N', 'P', 'K', 'ph'].map((n) => nutrientName(lang, n) ?? n).join(', ') });
  }
  return renderCrop(lang, r);
}

function renderFertilizer(lang, r) {
  if (r.error === 'missing_values' || r.forModel?.status === 422) return render(lang, 'askFert');
  if (r.error) return render(lang, 'serviceDown');
  const f = r.full;
  const parts = [];
  if (f.fertilizers.length) {
    parts.push(render(lang, 'fertHeader', { crop: f.crop }));
    for (const x of f.fertilizers) parts.push(render(lang, 'fertLine', { name: x.name, grade: x.grade, kg: x.kg_per_acre }));
  } else if (f.balanced) {
    parts.push(render(lang, 'fertNone', { crop: f.crop }));
  }
  for (const [n, v] of Object.entries(f.nutrients)) {
    if (v.status === 'excess') parts.push(render(lang, 'excess', { nutrient: nutrientName(lang, n) }));
  }
  parts.push(render(lang, 'fertDisclaimer'));
  return parts.join('\n');
}

function renderDisease(lang, r) {
  if (r.error === 'no_image') return render(lang, 'askImage');
  if (r.error) return render(lang, 'serviceDown');
  const d = r.full;
  if (d.uncertain) return render(lang, 'uncertain');
  if (d.healthy) return render(lang, 'healthy', { crop: d.crop });
  const parts = [render(lang, 'diseaseFound', { disease: d.disease, crop: d.crop, conf: pct(d.confidence) })];
  if (d.treatment?.organic?.[0]) parts.push(render(lang, 'organic', { text: d.treatment.organic[0] }));
  if (d.treatment?.chemical?.[0]) parts.push(render(lang, 'chemical', { text: d.treatment.chemical[0] }), render(lang, 'chemSafety'));
  return parts.join('\n');
}

function renderWeather(lang, r) {
  if (r.error === 'no_location') return render(lang, 'askLocation');
  if (r.error) return render(lang, 'serviceDown');
  const w = r.full;
  const parts = [
    render(lang, 'weatherNow', {
      place: w.location.name ?? `${w.location.lat}, ${w.location.lon}`,
      temp: w.current.temperature, hum: w.current.humidity, desc: w.current.description,
    }),
    render(lang, 'weatherWeek', { rain: w.summary.rainfall7d }),
  ];
  for (const a of w.alerts) parts.push(render(lang, `alerts.${a.code}`, { date: a.date ?? '', value: a.value ?? '' }));
  return parts.join('\n');
}

const RENDERERS = { recommendCrop: renderCrop, recommendCropForLocation: renderCropForLocation, recommendFertilizer: renderFertilizer, detectDisease: renderDisease, getWeather: renderWeather };

/** Turns tool results (from either path) into a templated reply. */
export function renderToolResults(lang, toolResults) {
  return toolResults.map((t) => RENDERERS[t.name]?.(lang, t)).filter(Boolean).join('\n\n');
}

/**
 * @param ctx { message, language, user, location?, image?, sessionId, priorResults? }
 *   priorResults: tool results Gemini already obtained before it failed. They are reused instead of
 *   calling the services (and saving Predictions) twice.
 */
export async function runFallback(ctx) {
  const lang = ctx.language;
  let toolResults = ctx.priorResults ?? [];

  if (!toolResults.length) {
    // Follow-ups like "The pH is 7" only make sense with the earlier turns, so the farmer's recent
    // messages are combined with this one. Values in the current message win over older ones.
    const recentUserText = (ctx.history ?? []).filter((m) => m.role === 'user').slice(-3).map((m) => m.content).join('\n');
    const combined = `${recentUserText}\n${ctx.message}`;
    let intent = detectIntent(ctx.message, Boolean(ctx.image));
    if (intent === 'unknown' && recentUserText) intent = detectIntent(combined);
    const soil = { ...extractSoil(recentUserText), ...extractSoil(ctx.message) };

    const call = {
      // No soil numbers at all -> use the farmer's field records / location instead of asking straight away.
      crop: () => (Object.keys(soil).length ? ['recommendCrop', soil] : ['recommendCropForLocation', {}]),
      fertilizer: () => ['recommendFertilizer', { crop: extractCrop(ctx.message) ?? extractCrop(recentUserText), ...soil }],
      disease: () => ['detectDisease', {}],
      weather: () => ['getWeather', { location: extractCity(ctx.message) ?? undefined }],
    }[intent]?.();

    if (!call) {
      return { reply: `${render(lang, 'basicNotice')}\n\n${render(lang, 'help')}`, intent, toolCalls: [], toolResults: [] };
    }
    const [name, args] = call;
    const r = await executeTool(name, args, { ...ctx, trustArgs: true }); // args were parsed from the farmer's text
    toolResults = [{ name, args, ...r }];
  }

  return {
    reply: `${render(lang, 'basicNotice')}\n\n${renderToolResults(lang, toolResults)}`,
    toolCalls: toolResults.map(({ name, args }) => ({ name, args })),
    toolResults,
  };
}
