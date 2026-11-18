import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fake, gem, newUser, setup } from './helpers/setup.js';

let ctx;
let farmer; // has a location -> weather auto-fill
let guest;  // no location
before(async () => {
  ctx = await setup();
  farmer = await newUser(api, { preferredLanguage: 'hi', location: { lat: 17.38, lon: 78.46, city: 'Hyderabad' } });
  guest = await newUser(api);
});
after(async () => { await ctx.teardown(); });
beforeEach(() => fake.reset());
const api = () => ctx.request();

const chat = (user, body) => api().post('/api/chat').set('Authorization', user.auth).send(body);
const fnResponses = (req) => req.contents.at(-1).parts.filter((p) => p.functionResponse).map((p) => p.functionResponse);

describe('POST /api/chat: AI mode (Gemini function calling)', () => {
  test('crop question -> recommendCrop tool -> climate auto-filled from weather -> answer saved with prediction', async () => {
    fake.gemini = [gem.call('recommendCrop', { N: 90, P: 42, K: 43, ph: 6.5 }), gem.text('धान सबसे अच्छी फसल है क्योंकि…')];
    const res = await chat(farmer, { message: 'मेरी मिट्टी N 90 P 42 K 43 pH 6.5 है, कौन सी फसल लगाऊं?', language: 'hi' }).expect(200);

    assert.equal(res.body.mode, 'ai');
    assert.equal(res.body.message.content, 'धान सबसे अच्छी फसल है क्योंकि…');
    const tr = res.body.message.toolResults[0];
    assert.equal(tr.name, 'recommendCrop');
    assert.deepEqual(tr.result.autofilled, ['temperature', 'humidity', 'rainfall']);
    assert.equal(tr.result.top[0].crop, 'rice');

    // The system prompt asks for Hindi, and Gemini got the compact tool result back.
    const [first, second] = fake.geminiRequests;
    assert.match(first.systemInstruction.parts[0].text, /ALWAYS reply in Hindi/);
    assert.equal(first.tools[0].functionDeclarations.length, 5);
    const fr = fnResponses(second)[0];
    assert.equal(fr.name, 'recommendCrop');
    assert.deepEqual(fr.response.result.autofilled_from_live_weather, ['temperature', 'humidity', 'rainfall']);
    assert.equal(fr.response.result.inputs_used.humidity, 90);

    // Prediction saved with source "chat" and linked to the session.
    const hist = await api().get('/api/history').set('Authorization', farmer.auth).expect(200);
    assert.equal(hist.body.items[0].source, 'chat');
    assert.equal(hist.body.items[0].sessionId, res.body.sessionId);
  });

  test('missing soil values -> tool tells Gemini to ask (nothing is guessed or saved)', async () => {
    fake.gemini = [gem.call('recommendCrop', { N: 90, P: 42, K: 43 }), gem.text('Please share your soil pH.')];
    const res = await chat(guest, { message: 'N 90 P 42 K 43, which crop?' }).expect(200);
    const fr = fnResponses(fake.geminiRequests[1])[0].response.result;
    assert.equal(fr.error, 'missing_values');
    assert.deepEqual(fr.missing, ['ph']);
    assert.equal(res.body.message.toolResults[0].error, 'missing_values');
    assert.equal(fake.calls.filter((c) => c.path === '/predict/crop').length, 0);
  });

  test('values Gemini invents (farmer never said them) are rejected as missing', async () => {
    fake.gemini = [gem.call('recommendCrop', { N: 20, P: 67, K: 20, ph: 7 }), gem.text('What is your soil pH?')];
    await chat(farmer, { message: 'Which crop should I grow? My soil has N 20, P 67, K 20.' }).expect(200);
    const fr = fnResponses(fake.geminiRequests[1])[0].response.result;
    assert.deepEqual(fr.missing, ['ph']);
    assert.deepEqual(fr.not_stated_by_farmer, ['ph']);
    assert.equal(fake.calls.filter((c) => c.path === '/predict/crop').length, 0);
  });

  test('values in Indian-script digits count as stated (N ९०, pH ६.५)', async () => {
    fake.gemini = [gem.call('recommendCrop', { N: 90, P: 42, K: 43, ph: 6.5 }), gem.text('ठीक है')];
    await chat(farmer, { message: 'मिट्टी: N ९०, P ४२, K ४३, pH ६.५', language: 'hi' }).expect(200);
    assert.equal(fake.calls.filter((c) => c.path === '/predict/crop').length, 1);
  });

  test('a value from an earlier turn of the same conversation counts as stated', async () => {
    fake.gemini = [gem.text('Please share pH.')];
    const first = await chat(farmer, { message: 'N 20, P 67, K 20. Which crop?' }).expect(200);
    fake.gemini = [gem.call('recommendCrop', { N: 20, P: 67, K: 20, ph: 7 }), gem.text('Papaya…')];
    await chat(farmer, { sessionId: first.body.sessionId, message: 'pH is 7' }).expect(200);
    assert.equal(fake.calls.filter((c) => c.path === '/predict/crop').length, 1);
  });

  test('disease model down -> Gemini is told it is unavailable, not that the photo is bad', async () => {
    fake.mlDown = true;
    fake.gemini = [gem.call('detectDisease'), gem.text('Photo diagnosis is unavailable right now…')];
    await api().post('/api/chat').set('Authorization', guest.auth).field('message', 'tomato spots')
      .attach('image', Buffer.from('89504e470d0a1a0a', 'hex'), { filename: 'leaf.png', contentType: 'image/png' }).expect(200);
    const fr = fnResponses(fake.geminiRequests[1])[0].response.result;
    assert.equal(fr.error, 'service_unavailable');
    assert.match(fr.message, /NOT a problem with the photo/);
  });

  test('without a location, climate values must be asked for too', async () => {
    fake.gemini = [gem.call('recommendCrop', { N: 90, P: 42, K: 43, ph: 6.5 }), gem.text('What is your city?')];
    await chat(guest, { message: 'N 90 P 42 K 43 pH 6.5' }).expect(200);
    const fr = fnResponses(fake.geminiRequests[1])[0].response.result;
    assert.deepEqual(fr.missing, ['temperature', 'humidity', 'rainfall']);
  });

  test('image query -> detectDisease uses the attached photo; only metadata is stored', async () => {
    fake.gemini = [gem.call('detectDisease'), gem.text('Late blight detected. Spray…')];
    const res = await api().post('/api/chat').set('Authorization', guest.auth)
      .field('message', 'What is wrong with my tomato?').field('language', 'en')
      .attach('image', Buffer.from('89504e470d0a1a0a', 'hex'), { filename: 'leaf.png', contentType: 'image/png' })
      .expect(200);
    assert.equal(res.body.message.toolResults[0].result.disease, 'Late blight');
    assert.deepEqual(res.body.userMessage.attachment, { filename: 'leaf.png', mimetype: 'image/png', size: 8 });
    // The photo goes to our model, not to Gemini.
    assert.ok(fake.calls.some((c) => c.path === '/predict/disease'));
    assert.match(JSON.stringify(fake.geminiRequests[0].contents), /\[Leaf photo attached\]/);
    assert.doesNotMatch(JSON.stringify(fake.geminiRequests[0].contents), /inlineData/);
  });

  test('at most 3 tool rounds, then a text answer is forced', async () => {
    fake.gemini = [gem.call('getWeather'), gem.call('getWeather'), gem.call('getWeather'), gem.text('Final answer')];
    const res = await chat(farmer, { message: 'weather?' }).expect(200);
    assert.equal(res.body.message.content, 'Final answer');
    assert.equal(fake.geminiRequests.length, 4);
    assert.equal(fake.geminiRequests[2].toolConfig.functionCallingConfig.mode, 'AUTO');
    assert.equal(fake.geminiRequests[3].toolConfig.functionCallingConfig.mode, 'NONE');
  });

  test('conversation continues in the same session with history sent to Gemini', async () => {
    fake.gemini = [gem.text('Please tell me your soil pH.')];
    const first = await chat(guest, { message: 'Which crop for N 90 P 42 K 43?' }).expect(200);
    fake.gemini = [gem.text('Thanks!')];
    await chat(guest, { sessionId: first.body.sessionId, message: 'pH is 6.5' }).expect(200);
    const contents = fake.geminiRequests.at(-1).contents;
    assert.equal(contents.length, 3);
    assert.deepEqual(contents.map((c) => c.role), ['user', 'model', 'user']);
  });
});

describe('POST /api/chat: basic-mode fallback', () => {
  test('429 from Gemini -> keyword router -> Hindi template reply with the crop result', async () => {
    fake.gemini = [gem.error(429)];
    const res = await chat(farmer, { message: 'मेरी मिट्टी N 90 P 42 K 43 pH 6.5 है, कौन सी फसल लगाऊं?', language: 'hi' }).expect(200);
    assert.equal(res.body.mode, 'basic');
    assert.equal(res.body.message.fallbackReason, 'rate_limited');
    assert.match(res.body.message.content, /बेसिक मोड/);
    assert.match(res.body.message.content, /सबसे अच्छी फसलें/);
    assert.match(res.body.message.content, /rice/);
    assert.equal(res.body.message.toolResults[0].name, 'recommendCrop');
  });

  test('timeout: slow attempt is retried once, then the budget runs out -> basic mode', async () => {
    fake.gemini = [gem.hang(3000), gem.hang(3000)]; // tests: 1 s per attempt, 3.5 s budget
    const started = Date.now();
    const res = await chat(farmer, { message: 'weather in Hyderabad', language: 'en' }).expect(200);
    assert.ok(Date.now() - started < 2900, 'should not wait for the slow replies');
    assert.equal(fake.geminiRequests.length, 2);
    assert.equal(res.body.mode, 'basic');
    assert.equal(res.body.message.fallbackReason, 'timeout');
    assert.match(res.body.message.content, /Weather for Hyderabad/);
  });

  test('5xx -> basic mode reuses tool results Gemini already obtained (no duplicate prediction)', async () => {
    fake.gemini = [gem.call('recommendFertilizer', { crop: 'rice', N: 40, P: 25, K: 70 }), gem.error(503), gem.error(503)];
    const res = await chat(guest, { message: 'fertilizer for rice N 40 P 25 K 70', language: 'te' }).expect(200);
    assert.equal(res.body.mode, 'basic');
    assert.equal(res.body.message.fallbackReason, 'server_error');
    assert.match(res.body.message.content, /ఎరువుల ప్రణాళిక/);
    assert.equal(fake.calls.filter((c) => c.path === '/predict/fertilizer').length, 1);
  });

  test('disease photo in basic mode (Tamil)', async () => {
    fake.gemini = [gem.error(500), gem.error(500)];
    const res = await api().post('/api/chat').set('Authorization', guest.auth).field('language', 'ta')
      .attach('image', Buffer.from('89504e470d0a1a0a', 'hex'), { filename: 'leaf.png', contentType: 'image/png' })
      .expect(200);
    assert.match(res.body.message.content, /கண்டறியப்பட்டது/);
    assert.match(res.body.message.content, /Mancozeb/);
  });

  test('basic mode remembers earlier soil values in a follow-up ("The pH is 7")', async () => {
    fake.gemini = [gem.error(429)];
    const first = await chat(farmer, { message: 'Which crop should I grow? N 20, P 67, K 20', language: 'en' }).expect(200);
    assert.match(first.body.message.content, /need your soil test values: pH/);
    fake.gemini = [gem.error(429)];
    const second = await chat(farmer, { sessionId: first.body.sessionId, message: 'The pH is 7.', language: 'en' }).expect(200);
    assert.match(second.body.message.content, /Best crops for your soil/);
    assert.deepEqual(fake.calls.find((c) => c.path === '/predict/crop').body.N, 20);
  });

  test('a single 5xx / slow reply is retried and the answer stays in AI mode', async () => {
    fake.gemini = [gem.error(504), gem.text('All good')];
    const res = await chat(guest, { message: 'hello' }).expect(200);
    assert.equal(res.body.mode, 'ai');
    assert.equal(res.body.message.content, 'All good');
    fake.gemini = [gem.hang(3000), gem.text('Fast now')];
    const res2 = await chat(guest, { message: 'hello again' }).expect(200);
    assert.equal(res2.body.mode, 'ai');
  });

  test('429 is not retried (would only burn quota)', async () => {
    fake.gemini = [gem.error(429), gem.text('should not be used')];
    const res = await chat(guest, { message: 'weather?' }).expect(200);
    assert.equal(res.body.mode, 'basic');
    assert.equal(fake.geminiRequests.length, 1);
  });

  test('off-topic in basic mode -> help menu (Kannada)', async () => {
    fake.gemini = [gem.error(429)];
    const res = await chat(guest, { message: 'tell me a joke', language: 'kn' }).expect(200);
    assert.match(res.body.message.content, /ಬೇಸಿಕ್ ಮೋಡ್/);
    assert.match(res.body.message.content, /ಬೆಳೆ ಸಲಹೆ/);
  });
});

describe('chat sessions + validation', () => {
  test('list, get, delete, and other users cannot see them', async () => {
    fake.gemini = [gem.text('Hello!')];
    const created = await chat(guest, { message: 'Hello' }).expect(200);
    const id = created.body.sessionId;

    const list = await api().get('/api/chat/sessions').set('Authorization', guest.auth).expect(200);
    const mine = list.body.sessions.find((s) => s.id === id);
    assert.equal(mine.title, 'Hello');
    assert.equal(mine.messageCount, 2);

    const one = await api().get(`/api/chat/sessions/${id}`).set('Authorization', guest.auth).expect(200);
    assert.deepEqual(one.body.session.messages.map((m) => m.role), ['user', 'assistant']);

    await api().get(`/api/chat/sessions/${id}`).set('Authorization', farmer.auth).expect(404);
    await api().delete(`/api/chat/sessions/${id}`).set('Authorization', farmer.auth).expect(404);
    await api().delete(`/api/chat/sessions/${id}`).set('Authorization', guest.auth).expect(204);
    await api().get(`/api/chat/sessions/${id}`).set('Authorization', guest.auth).expect(404);
    await api().get('/api/chat/sessions/not-an-id').set('Authorization', guest.auth).expect(404);
  });

  test('rejects empty message, bad language, bad location; requires auth', async () => {
    await chat(guest, { message: '  ' }).expect(400);
    await chat(guest, { message: 'hi', language: 'fr' }).expect(400);
    await chat(guest, { message: 'hi', location: 'not json' }).expect(400);
    await api().post('/api/chat').send({ message: 'hi' }).expect(401);
    assert.equal(fake.geminiRequests.length, 0);
  });
});
