import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CROP_RESPONSE, INTERNAL_KEY, fake, newUser, setup } from './helpers/setup.js';

let ctx;
let farmer; // has a saved location -> live weather is used
let guest;  // no location
before(async () => {
  ctx = await setup();
  farmer = await newUser(api, { location: { lat: 17.38, lon: 78.46, city: 'Hyderabad' } });
  guest = await newUser(api);
});
after(async () => { await ctx.teardown(); });
beforeEach(() => fake.reset());
const api = () => ctx.request();

const SOIL = { N: 90, P: 42, K: 43, temperature: 21, humidity: 82, ph: 6.5, rainfall: 203 };
const mlCall = (path) => fake.calls.find((c) => c.path === path);

describe('POST /api/predict/crop', () => {
  test('requires auth', async () => {
    await api().post('/api/predict/crop').send(SOIL).expect(401);
  });

  test('proxies to the ML service with the internal key and saves a Prediction', async () => {
    const res = await api().post('/api/predict/crop').set('Authorization', guest.auth).send(SOIL).expect(200);
    assert.deepEqual(res.body.top, CROP_RESPONSE.top);
    assert.equal(res.body.model_version, 'crop-stack-test');
    assert.equal(res.body.liveWeatherUsed, false);
    assert.ok(res.body.predictionId);

    const call = mlCall('/predict/crop');
    assert.equal(call.headers['x-internal-key'], INTERNAL_KEY);
    assert.equal(call.body.weather, undefined);

    const hist = await api().get('/api/history').set('Authorization', guest.auth).expect(200);
    assert.equal(hist.body.items[0].id, res.body.predictionId);
    assert.equal(hist.body.items[0].source, 'form');
  });

  test('adds live weather from the saved location (rainfall on the monthly scale)', async () => {
    const res = await api().post('/api/predict/crop').set('Authorization', farmer.auth).send(SOIL).expect(200);
    assert.equal(res.body.liveWeatherUsed, true);
    // fake weather: 27.5 °C, 90 %, and 150 mm of actual rain in the last 30 days
    assert.deepEqual(mlCall('/predict/crop').body.weather, { temperature: 27.5, humidity: 90, rainfall: 150 });
  });

  test('validates ranges before calling the ML service', async () => {
    const res = await api().post('/api/predict/crop').set('Authorization', guest.auth).send({ ...SOIL, ph: 15 }).expect(400);
    assert.equal(res.body.error.details[0].path, 'ph');
    assert.equal(fake.calls.length, 0);
  });

  test('returns 503 when the ML service is down', async () => {
    fake.mlDown = true;
    const res = await api().post('/api/predict/crop').set('Authorization', guest.auth).send(SOIL).expect(503);
    assert.match(res.body.error.message, /not available/);
  });
});

describe('POST /api/predict/fertilizer', () => {
  test('proxies and saves', async () => {
    const res = await api().post('/api/predict/fertilizer').set('Authorization', guest.auth)
      .send({ crop: 'rice', N: 40, P: 25, K: 70 }).expect(200);
    assert.equal(res.body.fertilizers[0].name, 'Urea');
    assert.ok(res.body.predictionId);
  });

  test('passes through ML validation errors (unknown crop -> 422)', async () => {
    const res = await api().post('/api/predict/fertilizer').set('Authorization', guest.auth)
      .send({ crop: 'wheat', N: 40, P: 25, K: 70 }).expect(422);
    assert.match(res.body.error.message, /Unknown crop/);
  });
});

describe('POST /api/predict/disease', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG header bytes are enough for the proxy

  test('forwards the image as multipart "file" and saves only metadata', async () => {
    const res = await api().post('/api/predict/disease').set('Authorization', guest.auth)
      .attach('image', png, { filename: 'leaf.png', contentType: 'image/png' }).expect(200);
    assert.equal(res.body.disease, 'Late blight');
    const hist = await api().get('/api/history?type=disease').set('Authorization', guest.auth).expect(200);
    assert.deepEqual(hist.body.items[0].input, { filename: 'leaf.png', mimetype: 'image/png', size: png.length });
  });

  test('rejects missing, wrong-type and oversized files', async () => {
    await api().post('/api/predict/disease').set('Authorization', guest.auth).expect(400);
    await api().post('/api/predict/disease').set('Authorization', guest.auth)
      .attach('image', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' }).expect(415);
    await api().post('/api/predict/disease').set('Authorization', guest.auth)
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'big.jpg', contentType: 'image/jpeg' }).expect(413);
    assert.equal(fake.calls.filter((c) => c.path === '/predict/disease').length, 0);
  });

  test('model missing on the ML side -> 503 with a clear message', async () => {
    fake.mlDown = true;
    const res = await api().post('/api/predict/disease').set('Authorization', guest.auth)
      .attach('image', png, { filename: 'leaf.png', contentType: 'image/png' }).expect(503);
    assert.match(res.body.error.message, /disease model is not available/);
  });
});
