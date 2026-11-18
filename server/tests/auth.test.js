import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { newUser, setup } from './helpers/setup.js';

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });
const api = () => ctx.request();

describe('POST /api/auth/register', () => {
  test('creates a user and returns a token without the password hash', async () => {
    const res = await api().post('/api/auth/register')
      .send({ name: 'Ramesh', email: 'Ramesh@Example.com', password: 'secret123', preferredLanguage: 'hi' })
      .expect(201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, 'ramesh@example.com');
    assert.equal(res.body.user.preferredLanguage, 'hi');
    assert.equal(res.body.user.passwordHash, undefined);
  });

  test('accepts phone-only sign-up', async () => {
    const res = await api().post('/api/auth/register')
      .send({ name: 'Lakshmi', phone: '+919876543210', password: 'secret123' }).expect(201);
    assert.equal(res.body.user.phone, '+919876543210');
  });

  test('rejects duplicates, missing contact and invalid fields', async () => {
    await api().post('/api/auth/register').send({ name: 'Dup', email: 'ramesh@example.com', password: 'secret123' }).expect(409);
    const none = await api().post('/api/auth/register').send({ name: 'Nobody', password: 'secret123' }).expect(400);
    assert.match(JSON.stringify(none.body.error.details), /email or a phone/);
    const bad = await api().post('/api/auth/register')
      .send({ name: 'X', email: 'not-an-email', password: '123', preferredLanguage: 'fr' }).expect(400);
    const paths = bad.body.error.details.map((d) => d.path);
    for (const p of ['name', 'email', 'password', 'preferredLanguage']) assert.ok(paths.includes(p), `missing ${p}`);
  });
});

describe('POST /api/auth/login', () => {
  test('logs in with email (case-insensitive) or phone', async () => {
    const byEmail = await api().post('/api/auth/login').send({ identifier: 'RAMESH@example.com', password: 'secret123' }).expect(200);
    assert.ok(byEmail.body.token);
    await api().post('/api/auth/login').send({ identifier: '+919876543210', password: 'secret123' }).expect(200);
  });

  test('wrong password and unknown user give the same 401', async () => {
    const a = await api().post('/api/auth/login').send({ identifier: 'ramesh@example.com', password: 'nope' }).expect(401);
    const b = await api().post('/api/auth/login').send({ identifier: 'ghost@example.com', password: 'nope' }).expect(401);
    assert.equal(a.body.error.message, b.body.error.message);
  });
});

describe('GET/PATCH /api/auth/me', () => {
  test('requires a valid bearer token', async () => {
    await api().get('/api/auth/me').expect(401);
    await api().get('/api/auth/me').set('Authorization', 'Bearer garbage').expect(401);
  });

  test('returns and updates the profile (language + location)', async () => {
    const u = await newUser(api);
    const me = await api().get('/api/auth/me').set('Authorization', u.auth).expect(200);
    assert.equal(me.body.user.id, u.user.id);

    const upd = await api().patch('/api/auth/me').set('Authorization', u.auth)
      .send({ preferredLanguage: 'te', location: { lat: 17.38, lon: 78.46, city: 'Hyderabad' } }).expect(200);
    assert.equal(upd.body.user.preferredLanguage, 'te');
    assert.deepEqual(upd.body.user.location, { lat: 17.38, lon: 78.46, city: 'Hyderabad' });

    const cleared = await api().patch('/api/auth/me').set('Authorization', u.auth).send({ location: null }).expect(200);
    assert.equal(cleared.body.user.location, undefined);
    await api().patch('/api/auth/me').set('Authorization', u.auth).send({ location: { lat: 200, lon: 0 } }).expect(400);
  });
});
