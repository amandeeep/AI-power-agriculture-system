import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fake, newUser, setup } from './helpers/setup.js';

let ctx;
let clearWeatherCache;
before(async () => {
  ctx = await setup();
  ({ clearWeatherCache } = await import('../src/services/weather.js'));
});
after(async () => { await ctx.teardown(); });
beforeEach(() => { fake.reset(); clearWeatherCache(); });
const api = () => ctx.request();

describe('GET /api/weather', () => {
  test('lat/lon returns current conditions, a 7-day forecast and farm alerts', async () => {
    const res = await api().get('/api/weather?lat=17.385&lon=78.4867').expect(200);
    const b = res.body;
    assert.equal(b.cached, false);
    assert.equal(b.current.temperature, 27.5);
    assert.equal(b.current.description, 'Light rain');
    assert.equal(b.daily.length, 7);
    assert.equal(b.summary.rainfall7d, 210);
    assert.equal(b.summary.rainfallPast30d, 150); // actual rain of the last 30 days
    assert.equal(b.summary.rainfallMonthlyEstimate, 150);
    assert.equal(b.summary.rainfallMonthlySource, 'past_30_days');
    assert.equal(b.daily[0].date, '2026-07-10'); // past days are not part of the forecast list

    const codes = b.alerts.map((a) => `${a.code}${a.date ? '@' + a.date : ''}`);
    for (const expected of ['heavy_rain@2026-07-11', 'very_heavy_rain@2026-07-12', 'thunderstorm@2026-07-12',
      'strong_wind@2026-07-11', 'heat@2026-07-14', 'fungal_risk']) {
      assert.ok(codes.includes(expected), `missing alert ${expected}; got ${codes}`);
    }
    // Open-Meteo got the right query
    const q = fake.calls.find((c) => c.path === '/v1/forecast').query;
    assert.equal(q.get('forecast_days'), '7');
    assert.equal(q.get('timezone'), 'auto');
    assert.equal(q.get('past_days'), '30');
  });

  test('is cached for 30 minutes (second call does not hit Open-Meteo)', async () => {
    await api().get('/api/weather?lat=17.385&lon=78.4867').expect(200);
    const again = await api().get('/api/weather?lat=17.3851&lon=78.4866').expect(200); // same ~1 km cell
    assert.equal(again.body.cached, true);
    assert.equal(fake.forecastCalls, 1);
  });

  test('city is geocoded first', async () => {
    const res = await api().get('/api/weather?city=Hyderabad').expect(200);
    assert.equal(res.body.location.name, 'Hyderabad, Telangana, India');
    assert.equal(res.body.location.lat, 17.38);
  });

  test('validation and unknown city', async () => {
    await api().get('/api/weather').expect(400);
    await api().get('/api/weather?lat=17').expect(400);
    await api().get('/api/weather?lat=95&lon=10').expect(400);
    const res = await api().get('/api/weather?city=Nowhereville').expect(404);
    assert.match(res.body.error.message, /not found/);
  });
});

describe('GET /api/history', () => {
  test('returns only my predictions, newest first, with paging and type filter', async () => {
    const me = await newUser(api);
    const other = await newUser(api);
    const soil = { N: 90, P: 42, K: 43, temperature: 21, humidity: 82, ph: 6.5, rainfall: 203 };
    for (let i = 0; i < 3; i += 1) {
      await api().post('/api/predict/crop').set('Authorization', me.auth).send(soil).expect(200);
    }
    await api().post('/api/predict/fertilizer').set('Authorization', me.auth).send({ crop: 'rice', N: 1, P: 1, K: 1 }).expect(200);
    await api().post('/api/predict/crop').set('Authorization', other.auth).send(soil).expect(200);

    const all = await api().get('/api/history').set('Authorization', me.auth).expect(200);
    assert.equal(all.body.total, 4);
    assert.equal(all.body.items[0].type, 'fertilizer'); // newest first
    assert.ok(all.body.items.every((p) => p.userId === me.user.id));

    const page = await api().get('/api/history?type=crop&limit=2&page=2').set('Authorization', me.auth).expect(200);
    assert.equal(page.body.total, 3);
    assert.equal(page.body.pages, 2);
    assert.equal(page.body.items.length, 1);

    await api().get('/api/history?type=banana').set('Authorization', me.auth).expect(400);
    await api().get('/api/history').expect(401);
  });
});
