// Gemini orchestrator: reads the farmer's message, lets Gemini pick a tool (function calling),
// runs it against the ML service / weather API, and returns Gemini's plain-language answer.
// Any Gemini failure (429, 5xx, timeout, missing key) switches to basic mode (keyword router + templates).
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { executeTool, TOOL_DECLARATIONS } from './chat/tools.js';
import { runFallback } from './fallback/index.js';

export const MAX_TOOL_ROUNDS = 3;
export const HISTORY_MESSAGES = 10;
const MAX_HISTORY_CHARS = 1500; // per message: keeps the context (and free-tier token use) small

const LANGUAGE_NAMES = { en: 'English', hi: 'Hindi', te: 'Telugu', ta: 'Tamil', kn: 'Kannada' };

let client;
function gemini() {
  client ??= new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY,
    httpOptions: {
      // Sent to Google as the server-side deadline, which must be >= 10 s ("Minimum allowed deadline is 10s").
      // Our real per-attempt limit is the abortSignal in callGemini().
      timeout: Math.max(env.GEMINI_TIMEOUT_MS, 10000),
      retryOptions: { attempts: 1 }, // no SDK retries: on failure we fall back immediately
      ...(env.GEMINI_BASE_URL ? { baseUrl: env.GEMINI_BASE_URL } : {}),
    },
  });
  return client;
}

/** For tests: drop the cached client so a new base URL / key is picked up. */
export function resetGeminiClient() {
  client = undefined;
}

export function systemPrompt({ language, user, location, hasImage }) {
  const loc = location ?? user.location;
  const where = loc?.lat != null
    ? `${loc.city ?? 'saved farm location'} (lat ${loc.lat}, lon ${loc.lon}). Live weather is available.`
    : 'unknown';
  return [
    'You are "Krishi Mitra", a friendly agricultural advisor for small and marginal farmers in India.',
    `ALWAYS reply in ${LANGUAGE_NAMES[language]} (use its native script), in short, simple sentences a farmer can follow on a phone.`,
    '',
    'Rules:',
    '1. Use the tools for every fact: crop choice, fertilizer amounts, disease diagnosis, weather. NEVER invent numbers, doses, scores or forecasts; every number must come from a tool result.',
    '2. Ask for missing soil test values (N, P, K, pH) instead of guessing them. Climate values are auto-filled from live weather when the location is known. If the farmer has no soil numbers but asks what to grow on their field or in their area, use recommendCropForLocation; mention when soil is a district estimate and suggest a soil test.',
    '3. Explain WHY. For crops: present the top crops IN THE ORDER the tool ranked them, each with its final score and its score parts (soil match probability, season fit, weather fit, and crop-rotation / nearby-farms fit when present). If a top-ranked crop is out of season, still list it but add that caution. For fertilizer: name the nutrient that is deficient or in excess.',
    '4. Flag risks clearly, for example heavy rain, heat, frost, fungal disease risk, a fast-spreading disease, or excess nutrients.',
    '5. End with 2-3 clear next steps.',
    '6. For chemical sprays or fertilizer, always add a short safety note: follow the label, wear gloves and a mask, and confirm with the local Krishi Vigyan Kendra / soil test lab.',
    '7. If a tool returns "uncertain", ask for a clearer, close-up, well-lit photo of one affected leaf. If a tool returns an error, explain simply and suggest what to do.',
    '8. Politely decline questions unrelated to farming, agriculture, weather or rural livelihood.',
    '9. Keep crop and disease names understandable; you may add the English name in brackets.',
    '',
    `Farmer: ${user.name}. Location: ${where}`,
    `Today: ${new Date().toISOString().slice(0, 10)}.`,
    hasImage ? 'The farmer attached a leaf photo to this message: call detectDisease to analyse it.' : '',
  ].filter((l) => l !== '').join('\n');
}

function toContents(history, message, hasImage) {
  const contents = history
    .filter((m) => m.content?.trim())
    .slice(-HISTORY_MESSAGES)
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content.slice(0, MAX_HISTORY_CHARS) }] }));
  // The photo itself is NOT sent to Gemini (saves tokens); our own disease model analyses it via the tool.
  const text = [message?.trim(), hasImage ? '[Leaf photo attached]' : ''].filter(Boolean).join('\n') || '[Leaf photo attached]';
  contents.push({ role: 'user', parts: [{ text }] });
  return contents;
}

class GeminiUnavailable extends Error {
  constructor(reason, cause) {
    super(reason);
    this.reason = reason;
    this.cause = cause;
  }
}

function classify(err) {
  const status = err?.status;
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error'; // includes 504 DEADLINE_EXCEEDED from Google's side
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || /abort|timed? ?out/i.test(err?.message)) return 'timeout';
  return status ? `http_${status}` : 'error';
}

/**
 * One Gemini call within the message's time budget.
 * Gemini latency is spiky (usually ~2 s, occasionally 30 s+), so each attempt gets at most
 * GEMINI_ATTEMPT_TIMEOUT_MS. A slow or 5xx attempt is retried once if enough budget remains.
 * When the 15 s budget runs out, or on 429 (retrying would only burn quota), GeminiUnavailable is thrown
 * and the caller switches to basic mode.
 */
async function callGemini(contents, system, { allowTools, budget }) {
  const MIN_ATTEMPT_MS = 2000;
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const remaining = budget.deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) break;
    const timeoutMs = Math.min(env.GEMINI_ATTEMPT_TIMEOUT_MS, remaining);
    try {
      return await gemini().models.generateContent({
        model: env.GEMINI_MODEL,
        contents,
        config: {
          systemInstruction: system,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          // After the last allowed tool round, force a plain-text answer.
          toolConfig: { functionCallingConfig: { mode: allowTools ? 'AUTO' : 'NONE' } },
          temperature: 0.3,
          maxOutputTokens: 2048,
          ...(env.GEMINI_THINKING_LEVEL ? { thinkingConfig: { thinkingLevel: env.GEMINI_THINKING_LEVEL } } : {}),
          // Client-side cut-off only: Google rejects server deadlines below 10 s (see gemini() below).
          abortSignal: AbortSignal.timeout(timeoutMs),
        },
      });
    } catch (err) {
      lastErr = err;
      const reason = classify(err);
      if (reason !== 'timeout' && reason !== 'server_error') throw new GeminiUnavailable(reason, err);
      budget.retries += 1;
    }
  }
  throw new GeminiUnavailable(classify(lastErr) === 'server_error' ? 'server_error' : 'timeout', lastErr);
}

/**
 * @param ctx {
 *   message, language, user, history: [{role, content}], sessionId,
 *   location?: {lat, lon, city}, image?: {buffer, mimetype, originalname, size}
 * }
 * @returns { reply, mode: 'ai'|'basic', fallbackReason?, toolCalls, toolResults, rounds }
 */
export async function orchestrate(ctx) {
  const toolResults = [];
  const hasImage = Boolean(ctx.image);

  if (!env.GEMINI_API_KEY) return basic(ctx, 'not_configured', toolResults);

  const system = systemPrompt({ language: ctx.language, user: ctx.user, location: ctx.location, hasImage });
  const contents = toContents(ctx.history ?? [], ctx.message, hasImage);
  // What the farmer actually wrote (recent turns + this one): tools only accept soil numbers found here.
  ctx = { ...ctx, userText: [...(ctx.history ?? []).filter((m) => m.role === 'user').map((m) => m.content), ctx.message].join('\n') };
  // Total time Gemini may spend on this message (tool execution time is not counted).
  const budget = { deadline: Date.now() + env.GEMINI_TIMEOUT_MS, retries: 0 };

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const response = await callGemini(contents, system, { allowTools: round < MAX_TOOL_ROUNDS, budget });
      const calls = response.functionCalls ?? [];

      if (!calls.length) {
        const reply = response.text?.trim();
        if (!reply) throw new GeminiUnavailable('empty_response');
        return {
          reply, mode: 'ai', toolCalls: toolResults.map(({ name, args }) => ({ name, args })), toolResults,
          rounds: round, geminiRetries: budget.retries,
        };
      }

      // Keep Gemini's own turn verbatim (Gemini 3 needs its thought signatures echoed back).
      contents.push(response.candidates[0].content);
      const toolsStarted = Date.now();
      const results = await Promise.all(calls.map(async (call) => {
        const r = await executeTool(call.name, call.args ?? {}, ctx);
        toolResults.push({ name: call.name, args: call.args ?? {}, ...r });
        return { functionResponse: { id: call.id, name: call.name, response: { result: r.forModel } } };
      }));
      budget.deadline += Date.now() - toolsStarted; // our own services' time doesn't eat Gemini's budget
      contents.push({ role: 'user', parts: results });
    }
    throw new GeminiUnavailable('too_many_rounds'); // unreachable: the last round forbids tools
  } catch (err) {
    if (!(err instanceof GeminiUnavailable)) throw err;
    // For 429s, name the exact quota (per-minute vs per-day) so it can be diagnosed from the log.
    const quota = err.cause?.message?.match(/"quotaId":\s*"([^"]+)"/)?.[1];
    const detail = quota ?? err.cause?.message?.slice(0, 160);
    console.warn(`[chat] Gemini unavailable (${err.reason}${detail ? `: ${detail}` : ''}), using basic mode`);
    return basic(ctx, err.reason, toolResults);
  }
}

async function basic(ctx, reason, priorResults) {
  const r = await runFallback({ ...ctx, priorResults });
  return { ...r, mode: 'basic', fallbackReason: reason, rounds: 0 };
}
