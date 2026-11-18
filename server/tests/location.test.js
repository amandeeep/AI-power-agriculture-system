import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fake, gem, newUser, setup } from './helpers/setup.js';

let ctx;
let farmer;
let neighbours;
let clearClimateCache;
let monthlyNormals;
let summarizeSoilTests;
const api = () => ctx.request();
const HYD = { lat: 17.38, lon: 78.46 };

before(async () => {
  ctx = await setup();
  ({ clearClimateCache, monthlyNormals } = await import('../src/services/climate.js'));
  ({ summarizeSoilTests } = await import('../src/services/locationRecommend.js'));
  farmer = await newUser(api);
  neighbours = [await newUser(api), await newUser(api)];
});
after(async () => { await ctx.teardown(); });
beforeEach(() => { fake.reset(); clearClimateCache(); });

const post = (u, path, body) => api().post(path).set('Authorization', u.auth).send(body);
const mlCrop = () => fake.calls.find((c) => c.path === '/predict/crop');

describe('pure helpers', () => {
  test('monthlyNormals averages temperature/humidity and totals rain per month per year', () => {
    const daily = {
      time: ['2024-07-01', '2024-07-02', '2025-07-01', '2025-08-01'],
      temperature_2m_mean: [20, 30, 28, 26],
      relative_humidity_2m_mean: [80, 90, 70, 60],
      precipitation_sum: [10, 20, 40, 5],
    };
    const n = monthlyNormals(daily);
    assert.deepEqual(n[7], { temperature: 26, humidity: 80, rainfall: 35, years: 2 }); // (30 + 40) / 2
    assert.deepEqual(n[8], { temperature: 26, humidity: 60, rainfall: 5, years: 1 });
  });

  test('summarizeSoilTests weights recent tests more and reports a per-year trend', () => {
    const now = new Date('2026-07-01');
    const tests = [
      { testedAt: '2026-07-01', N: 100, P: 40, K: 40, ph: 6.5 },
      { testedAt: '2025-07-01', N: 60, P: 40, K: 40, ph: 6.5 }, // one half-life old -> weight 0.5
    ];
    const s = summarizeSoilTests(tests, now);
    assert.equal(s.values.N, 86.7); // (100*1 + 60*0.5) / 1.5
    assert.equal(s.trendPerYear.N, 40);
    assert.equal(s.trendPerYear.P, 0);
    assert.equal(s.testsUsed, 2);
    assert.equal(summarizeSoilTests([], now), null);
    assert.equal(summarizeSoilTests([tests[0]], now).trendPerYear, null);
  });
});

describe('/api/fields', () => {
  test('CRUD is scoped to the owner, with soil tests and crop history', async () => {
    await api().get('/api/fields').expect(401);
    const f = (await post(farmer, '/api/fields', { name: 'North plot', ...HYD, state: 'Telangana', district: 'Hyderabad' }).expect(201)).body;
    assert.equal(f.name, 'North plot');
    assert.equal(f.geo, undefined); // internal

    await post(farmer, '/api/fields', { name: 'x', lat: 10 }).expect(400); // lat without lon
    await api().get(`/api/fields/${f.id}`).set('Authorization', neighbours[0].auth).expect(404);

    await post(farmer, `/api/fields/${f.id}/soil-tests`, { testedAt: '2025-06-01', N: 80, P: 40, K: 40, ph: 6.5 }).expect(201);
    await post(farmer, `/api/fields/${f.id}/soil-tests`, { testedAt: '2030-01-01', N: 80, P: 40, K: 40, ph: 6.5 }).expect(400);
    await post(farmer, `/api/fields/${f.id}/crops`, { year: 2025, season: 'Kharif', crop: 'Rice' }).expect(201);
    await post(farmer, `/api/fields/${f.id}/crops`, { year: 2025, season: 'Kharif', crop: 'maize' }).expect(409);
    await post(farmer, `/api/fields/${f.id}/crops`, { year: 2025, season: 'Rabi', crop: 'chickpea' }).expect(201);
    await post(farmer, `/api/fields/${f.id}/crops`, { year: 2025, season: 'Monsoon', crop: 'rice' }).expect(400);

    const detail = (await api().get(`/api/fields/${f.id}`).set('Authorization', farmer.auth).expect(200)).body;
    assert.equal(detail.soilTests.length, 1);
    assert.equal(detail.soilSummary.values.N, 80);
    assert.deepEqual(detail.cropHistory.map((h) => `${h.season}${h.year}:${h.crop}`), ['Rabi2025:chickpea', 'Kharif2025:rice']);

    const list = (await api().get('/api/fields').set('Authorization', farmer.auth).expect(200)).body.items;
    assert.equal(list.length, 1);

    const tmp = (await post(farmer, '/api/fields', { name: 'Temp' }).expect(201)).body;
    await api().delete(`/api/fields/${tmp.id}`).set('Authorization', farmer.auth).expect(204);
    await api().delete(`/api/fields/${tmp.id}`).set('Authorization', farmer.auth).expect(404);
  });
});

describe('POST /api/recommend/location', () => {
  let field;
  before(async () => {
    field = (await post(farmer, '/api/fields', { name: 'Rice field', ...HYD, district: 'Rangareddy', state: 'Telangana' })).body;
    await post(farmer, `/api/fields/${field.id}/soil-tests`, { testedAt: new Date().toISOString(), N: 90, P: 42, K: 43, ph: 6.5 });
    await post(farmer, `/api/fields/${field.id}/crops`, { year: 2025, season: 'Kharif', crop: 'paddy' });
    await post(farmer, `/api/fields/${field.id}/crops`, { year: 2024, season: 'Rabi', crop: 'wheat' });
    // Nearby farms (within 25 km): 2 neighbours grew maize and jute; one far away (Delhi) grew cotton.
    for (const [u, crop, loc] of [[neighbours[0], 'maize', { lat: 17.45, lon: 78.5 }], [neighbours[1], 'jute', { lat: 17.3, lon: 78.4 }],
      [neighbours[1], 'cotton', { lat: 28.6, lon: 77.2 }]]) {
      const nf = (await post(u, '/api/fields', { name: crop, ...loc })).body;
      await post(u, `/api/fields/${nf.id}/crops`, { year: new Date().getFullYear() - 1, season: 'Kharif', crop });
    }
  });

  test('uses the field soil tests, climate normals, rotation history and nearby farms', async () => {
    const res = await post(farmer, '/api/recommend/location', { fieldId: field.id, month: 7 }).expect(200);
    const b = res.body;
    assert.equal(b.soil.source, 'field_tests');
    assert.equal(b.soil.values.N, 90);
    assert.equal(b.climate.source, 'climate_normals');
    assert.equal(b.climate.temperature, 25);
    assert.equal(b.climate.humidity, 70);
    assert.equal(b.climate.rainfall, 124); // 31 days x 4 mm
    assert.deepEqual(b.history.map((h) => h.crop), ['paddy', 'wheat']);
    assert.equal(b.area.records, 2);
    assert.ok(b.predictionId && b.model_version);

    const call = mlCrop().body;
    assert.deepEqual(call.context.previous_crops, ['paddy', 'wheat']);
    assert.deepEqual(call.context.area_counts, { maize: 1, jute: 1 }); // own field and the far-away farm excluded
    assert.equal(call.context.soil_source, 'field_tests');
    assert.equal(call.weather, undefined); // normals, not live weather
    assert.equal(call.month, 7);
  });

  test('a saved location-based recommendation counts for neighbours (area) without exposing who', async () => {
    const res = await post(neighbours[0], '/api/recommend/location', { ...HYD, soil: { N: 10, P: 10, K: 10, ph: 7 }, month: 7 }).expect(200);
    assert.equal(res.body.soil.source, 'manual');
    const counts = mlCrop().body.context.area_counts;
    // farmer's earlier recommendation (top: rice) is now visible to the neighbour as an area count
    assert.ok(counts.rice >= 1);
    assert.ok(!JSON.stringify(res.body.area).includes(farmer.user.id));
  });

  test('falls back to the district estimate, then to a clear 422', async () => {
    const bare = (await post(farmer, '/api/fields', { name: 'New plot', ...HYD, district: 'Nalgonda', state: 'Telangana' })).body;
    const none = await post(farmer, '/api/recommend/location', { fieldId: bare.id }).expect(422);
    assert.equal(none.body.error.details.code, 'no_soil_data');
    assert.equal(none.body.error.details.district_data, 'not_installed');

    fake.districtSoil = { state: 'Telangana', district: 'Nalgonda', N: 55, P: 30, K: 35, ph: 7.6, samples: 1200, confidence: 0.55 };
    const res = await post(farmer, '/api/recommend/location', { fieldId: bare.id }).expect(200);
    assert.equal(res.body.soil.source, 'district_estimate');
    assert.equal(res.body.soil.values.ph, 7.6);
    assert.equal(res.body.soil.district.samples, 1200);
  });

  test('district estimate is found from coordinates even when the district name is spelled differently', async () => {
    const plot = (await post(farmer, '/api/fields', { name: 'Spelling plot', lat: 17.05, lon: 79.27, district: 'NALGONDA DIST.' })).body;
    fake.districtSoil = { state: 'Telangana', district: 'Nalgonda', bbox: [78.9, 16.6, 79.9, 17.5], N: 14, P: 76, K: 32.6, ph: 6.98,
      samples: 391, confidence: 0.6, year: '2025-26', status: { N: { low: 100, medium: 0, high: 0 } }, history: { '2024-25': {}, '2025-26': {} } };
    const res = await post(farmer, '/api/recommend/location', { fieldId: plot.id }).expect(200);
    assert.equal(res.body.soil.source, 'district_estimate');
    assert.equal(res.body.soil.district.matchedBy, 'coordinates');
    assert.equal(res.body.soil.district.year, '2025-26');
    assert.deepEqual(res.body.soil.district.status.N, { low: 100, medium: 0, high: 0 });
    const q = fake.calls.find((c) => c.path === '/soil/district').query;
    assert.equal(q.get('lat'), '17.05');
  });

  test('nearby counts only include the same season as the target month', async () => {
    await post(farmer, '/api/recommend/location', { fieldId: field.id, month: 11 }).expect(200); // Rabi
    assert.deepEqual(mlCrop().body.context.area_counts, {}); // neighbours only recorded Kharif crops
  });

  test('live weather is used when the climate archive is down', async () => {
    fake.archiveDown = true;
    const res = await post(farmer, '/api/recommend/location', { fieldId: field.id }).expect(200);
    assert.equal(res.body.climate.source, 'live_weather');
    assert.equal(res.body.climate.humidity, 90);
  });

  test('errors: unknown field, no location', async () => {
    await post(farmer, '/api/recommend/location', { fieldId: '0123456789abcdef01234567' }).expect(404);
    const lonely = await newUser(api);
    const r = await post(lonely, '/api/recommend/location', { soil: { N: 1, P: 1, K: 1, ph: 7 } }).expect(422);
    assert.equal(r.body.error.details.code, 'no_location');
  });
});

describe('chat: recommendCropForLocation', () => {
  test('AI mode: Gemini calls the location tool and gets a compact result', async () => {
    fake.gemini = [gem.call('recommendCropForLocation', { field: 'rice field' }), gem.text('Grow jute this season.')];
    const res = await post(farmer, '/api/chat', { message: 'What should I grow on my rice field?' }).expect(200);
    assert.equal(res.body.mode, 'ai');
    const tr = res.body.message.toolResults[0];
    assert.equal(tr.name, 'recommendCropForLocation');
    const fr = fake.geminiRequests[1].contents.at(-1).parts.find((p) => p.functionResponse).functionResponse.response.result;
    assert.equal(fr.field, 'Rice field');
    assert.equal(fr.soil_source, 'field_tests');
    assert.equal(typeof fr.top[0].rotation, 'string'); // reason code translated to a short phrase
    assert.equal(fr.weights.rotation, 0.1);
    assert.ok(fr.past_crops[0].includes('paddy'));
  });

  test('several fields and none named -> asks which field', async () => {
    fake.gemini = [gem.call('recommendCropForLocation', {}), gem.text('Which field?')];
    await post(farmer, '/api/chat', { message: 'What should I grow?' }).expect(200);
    const fr = fake.geminiRequests[1].contents.at(-1).parts.find((p) => p.functionResponse).functionResponse.response.result;
    assert.equal(fr.error, 'which_field');
    assert.ok(fr.fields.includes('Rice field'));
  });

  test('basic mode without soil numbers uses the single saved field', async () => {
    const solo = await newUser(api);
    const f = (await post(solo, '/api/fields', { name: 'Home', ...HYD })).body;
    await post(solo, `/api/fields/${f.id}/soil-tests`, { testedAt: '2026-01-01', N: 90, P: 42, K: 43, ph: 6.5 });
    fake.gemini = [gem.error(429)];
    const res = await post(solo, '/api/chat', { message: 'which crop should I grow?' }).expect(200);
    assert.equal(res.body.mode, 'basic');
    assert.equal(res.body.message.toolResults[0].name, 'recommendCropForLocation');
    assert.match(res.body.message.content, /rice/i);
  });
});
