import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fake, newUser, setup } from './helpers/setup.js';

let ctx;
let clearPlacesCache;
const api = () => ctx.request();

before(async () => {
  ctx = await setup();
  ({ clearPlacesCache } = await import('../src/services/places.js'));
});
after(async () => { await ctx.teardown(); });
beforeEach(() => { fake.reset(); clearPlacesCache(); });

describe('/api/places', () => {
  test('search returns de-duplicated Indian places with labels, and caches', async () => {
    const res = await api().get('/api/places/search?q=kondapur').expect(200);
    assert.deepEqual(res.body.results.map((r) => r.label), [
      'Kondapur, Narsapur mandal, Telangana 502313',
      'Kondapur, Manoharabad mandal, Telangana 502336',
    ]);
    assert.equal(res.body.results[0].lat, 17.71083);
    assert.match(res.body.attribution, /OpenStreetMap/);
    await api().get('/api/places/search?q=Kondapur').expect(200);
    assert.equal(fake.placeCalls.length, 1); // second query served from cache (case-insensitive)
  });

  test('search validates the query', async () => {
    await api().get('/api/places/search?q=k').expect(400);
  });

  test('reverse geocoding fills village, mandal, district (suffix removed), state and PIN', async () => {
    const res = await api().get('/api/places/reverse?lat=17.24&lon=78.43').expect(200);
    assert.deepEqual(res.body.place, {
      village: 'Mamidipally', subDistrict: 'Balapur mandal', district: 'Ranga Reddy', state: 'Telangana',
      pincode: '509218', lat: 17.24, lon: 78.43, label: 'Mamidipally, Balapur mandal, Ranga Reddy, Telangana 509218',
    });
    await api().get('/api/places/reverse?lat=17.2401&lon=78.4302').expect(200); // same ~100 m cell -> cached
    assert.equal(fake.placeCalls.length, 1);
    await api().get('/api/places/reverse?lat=51.5&lon=-0.1').expect(400); // outside India
  });

  test('PIN code lookup lists post offices with district and state', async () => {
    const res = await api().get('/api/places/pincode/508001').expect(200);
    assert.equal(res.body.district, 'Nalgonda');
    assert.equal(res.body.state, 'Telangana');
    assert.deepEqual(res.body.offices.map((o) => o.name), ['Bottuguda', 'Panagal']);
    assert.equal(res.body.offices[1].subDistrict, undefined); // India Post "NA"
    await api().get('/api/places/pincode/999999').expect(404);
    await api().get('/api/places/pincode/012345').expect(400);
    await api().get('/api/places/pincode/12345').expect(400);
  });

  test('the full address is saved on the profile and on fields', async () => {
    const u = await newUser(api);
    const loc = { lat: 17.24, lon: 78.43, city: 'Mamidipally, Ranga Reddy', village: 'Mamidipally', subDistrict: 'Balapur mandal', district: 'Ranga Reddy', state: 'Telangana', pincode: '509218' };
    const me = await api().patch('/api/auth/me').set('Authorization', u.auth).send({ location: loc }).expect(200);
    assert.equal((me.body.user ?? me.body).location.district, 'Ranga Reddy');
    await api().patch('/api/auth/me').set('Authorization', u.auth).send({ location: { ...loc, pincode: '50921' } }).expect(400);

    const f = (await api().post('/api/fields').set('Authorization', u.auth).send({ name: 'Plot', ...loc }).expect(201)).body;
    assert.equal(f.pincode, '509218');
    // PUT replaces the field: a new location without a PIN clears the old one.
    const upd = (await api().put(`/api/fields/${f.id}`).set('Authorization', u.auth).send({ name: 'Plot', lat: 17, lon: 79 }).expect(200)).body;
    assert.equal(upd.pincode, undefined);
    assert.equal(upd.district, undefined);
  });
});
