import 'dotenv/config';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { pino } from 'pino';
import { Op } from 'sequelize';
import { createApp } from '../app/app.js';
import { loadConfig } from '../app/config.js';
import { createContainer, type Container } from '../app/container.js';
import { migrate } from '../app/db/migrator.js';
import type { UserModel } from '../app/models/index.js';
import type { BookingStatus, Role } from '../app/domain/types.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Set TEST_DATABASE_URL to a dedicated PostgreSQL database whose name ends in _test. Tests never use DATABASE_URL.');
}
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '10', LOG_LEVEL: 'silent'
});
const password = 'Integration-test-password-42';
let hash: string;
let container: Container;
let app: ReturnType<typeof createApp>;
const ownedUsers: string[] = [];
const ownedBookings: string[] = [];
beforeAll(async () => {
  hash = await bcrypt.hash(password, 10);
  container = await createContainer(config);
  await migrate(container.db);
  app = createApp(config, container, { limits: { globalMax: 2000, loginMax: 500 } });
});
afterAll(async () => {
  if (!container) return;
  try {
    // Only remove records this test process created; never truncate shared tables.
    await container.db.transaction(async transaction => {
      await container.models.BookingStatusHistory.destroy({ where: { booking_id: { [Op.in]: ownedBookings } }, transaction });
      await container.models.Review.destroy({ where: { booking_id: { [Op.in]: ownedBookings } }, transaction });
      await container.models.Booking.destroy({ where: { id: { [Op.in]: ownedBookings } }, transaction });
      await container.models.ArtistProfile.destroy({ where: { user_id: { [Op.in]: ownedUsers } }, transaction });
      await container.models.User.destroy({ where: { id: { [Op.in]: ownedUsers } }, transaction });
    });
  } finally { await container.db.close(); }
});
async function user(role: Role) {
  const item = await container.models.User.create({ email_normalized: randomUUID() + '@example.test', role, password_hash: hash });
  ownedUsers.push(item.getDataValue('id'));
  return item;
}
async function login(item: UserModel) {
  const response = await request(app).post('/api/v1/auth/login').send({ email: item.getDataValue('email_normalized'), password }).expect(200);
  return response.body.data.access_token as string;
}
async function fixture() {
  const artist = await user('artist'), client = await user('client');
  return { artist, client, artistToken: await login(artist), clientToken: await login(client) };
}
const futureWindow = (hours = 24) => ({
  event_start: new Date(Date.now() + hours * 3600000),
  event_end: new Date(Date.now() + (hours + 1) * 3600000)
});
async function booking(artist: UserModel, client: UserModel, status: BookingStatus = 'pending', times = futureWindow()) {
  const result = await container.models.Booking.create({
    artist_id: artist.getDataValue('id'), client_id: client.getDataValue('id'),
    ...times, status, notes: 'Integration fixture'
  });
  ownedBookings.push(result.getDataValue('id'));
  return result;
}
function patch(id: string, token: string, status: string, targetApp = app) {
  return request(targetApp).patch('/api/v1/bookings/' + id + '/status').auth(token, { type: 'bearer' }).send({ status });
}
function errorShape(response: request.Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.body.success).toBe(false);
  expect(response.body.data).toStrictEqual({});
  expect(typeof response.body.error).toBe('string');
  expect(response.body.error.length).toBeTruthy();
  expect(Object.keys(response.body).sort()).toStrictEqual(['data', 'error', 'success']);
}
function bookingBody(artist: UserModel, times = futureWindow()) {
  return { artist_id: artist.getDataValue('id'), event_start: times.event_start.toISOString(), event_end: times.event_end.toISOString(), notes: 'A private acoustic event.' };
}

test('login issues a verifiable JWT with user ID, role, iat and expiration', async () => {
  const account = await user('client');
  const response = await request(app).post('/api/v1/auth/login').send({
    email: '  ' + account.getDataValue('email_normalized').toUpperCase() + '  ', password
  }).expect(200);
  const claims = jwt.verify(response.body.data.access_token, config.JWT_SECRET, { algorithms: ['HS256'], issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE }) as jwt.JwtPayload;
  expect(claims.sub).toBe(account.getDataValue('id'));
  expect(claims.role).toBe('client');
  expect(typeof claims.iat).toBe('number');
  expect(claims.exp! - claims.iat!).toBe(900);
  expect(response.body.error).toBe('');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(!JSON.stringify(response.body).includes(hash)).toBeTruthy();
});

test('API routes require the v1 prefix; health is unversioned and unsupported methods retain 405', async () => {
  const id = randomUUID();
  for (const prefix of ['', '/api/v2', '/api/v01', '/apiv1']) {
    const attempts = [
      request(app).post(prefix + '/auth/login').send({}),
      request(app).post(prefix + '/bookings').send({}),
      request(app).patch(prefix + '/bookings/' + id + '/status').send({ status: 'cancelled' }),
      request(app).get(prefix + '/artists/' + id + '/reviews')
    ];
    for (const attempt of attempts) {
      const response = await attempt;
      errorShape(response, 404);
      expect(response.body.error).toBe('Route not found.');
      expect(response.headers['x-request-id']).toBeTruthy();
    }
  }
  const health = await request(app).get('/health').expect(200);
  expect(health.body).toStrictEqual({ success: true, data: { status: 'ok' }, error: '' });
  errorShape(await request(app).get('/api/v1/health'), 404);
  errorShape(await request(app).get('/api/v1/missing'), 404);
  const method = await request(app).put('/api/v1/bookings').send({});
  errorShape(method, 405);
  expect(method.headers.allow).toBe('POST');
});

test('unknown email, wrong password and disabled account have identical credential failures', async () => {
  const account = await user('client');
  const attempts = [
    { email: randomUUID() + '@example.test', password },
    { email: account.getDataValue('email_normalized'), password: 'wrong-password' }
  ];
  let body: unknown;
  for (const attempt of attempts) {
    const response = await request(app).post('/api/v1/auth/login').send(attempt);
    errorShape(response, 401);
    if (body) expect(response.body).toStrictEqual(body);
    body = response.body;
  }
  await account.update({ is_active: false });
  const disabled = await request(app).post('/api/v1/auth/login').send({ email: account.getDataValue('email_normalized'), password });
  errorShape(disabled, 401);
  expect(disabled.body).toStrictEqual(body);
});

test('login validates types and byte limits without modifying passwords', async () => {
  const account = await user('client');
  for (const body of [
    {}, { email: 'bad', password }, { email: account.getDataValue('email_normalized'), password: ['x'] },
    { email: account.getDataValue('email_normalized'), password: 'é'.repeat(37) },
    { email: account.getDataValue('email_normalized'), password, role: 'artist' }
  ]) errorShape(await request(app).post('/api/v1/auth/login').send(body), 400);
  errorShape(await request(app).post('/api/v1/auth/login').send({ email: account.getDataValue('email_normalized'), password: ' ' + password }), 401);
});

test('every protected endpoint authenticates before controller validation and rejects invalid or stale tokens', async () => {
  const { client, clientToken } = await fixture();
  const subject = client.getDataValue('id');
  const options = { subject, issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE };
  const tokens = [
    clientToken + 'x',
    jwt.sign({ role: 'client' }, config.JWT_SECRET, { ...options, algorithm: 'HS256', expiresIn: -10 }),
    jwt.sign({ role: 'client' }, config.JWT_SECRET, { ...options, algorithm: 'HS384', expiresIn: 300 }),
    jwt.sign({ role: 'client' }, config.JWT_SECRET, { ...options, issuer: 'another-app', expiresIn: 300 }),
    jwt.sign({ role: 'client' }, config.JWT_SECRET, { ...options, audience: 'another-api', expiresIn: 300 }),
    jwt.sign({ role: 'artist' }, config.JWT_SECRET, { ...options, algorithm: 'HS256', expiresIn: 300 }),
    jwt.sign({ role: 'client', exp: Math.floor(Date.now()/1000)+300 }, config.JWT_SECRET, { ...options, noTimestamp: true })
  ];
  // These deliberately invalid inputs would return 400 if a controller ran first.
  const endpoints = [
    () => request(app).post('/api/v1/bookings').send({}),
    () => request(app).patch('/api/v1/bookings/not-a-uuid/status').send({}),
    () => request(app).get('/api/v1/artists/not-a-uuid/reviews')
  ];
  const headers = [undefined, 'Basic credentials', 'Bearer', 'Bearer one two', 'Bearer one,two', ...tokens.map(token => 'Bearer ' + token)];
  const expectUnauthenticated = (response: request.Response) => {
    errorShape(response, 401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  };
  for (const endpoint of endpoints) {
    for (const header of headers) {
      const attempt = endpoint();
      if (header !== undefined) attempt.set('Authorization', header);
      expectUnauthenticated(await attempt);
    }
    // A successful request must still proceed after earlier authentication failures.
    errorShape(await endpoint().auth(clientToken, { type: 'bearer' }), 400);
  }
  await client.update({ is_active: false });
  for (const endpoint of endpoints) expectUnauthenticated(await endpoint().auth(clientToken, { type: 'bearer' }));
  await client.update({ is_active: true, role: 'artist' });
  for (const endpoint of endpoints) expectUnauthenticated(await endpoint().auth(clientToken, { type: 'bearer' }));
  await client.destroy();
  for (const endpoint of endpoints) expectUnauthenticated(await endpoint().auth(clientToken, { type: 'bearer' }));
});

test('concurrent requests keep each client identity isolated and do not authenticate a tokenless request', async () => {
  const { artist, client, clientToken } = await fixture();
  const otherClient = await user('client');
  const otherToken = await login(otherClient);
  const body = bookingBody(artist);
  const send = () => request(app).post('/api/v1/bookings').send(body);
  const [first, second, unauthenticated] = await Promise.all([
    send().auth(clientToken, { type: 'bearer' }),
    send().auth(otherToken, { type: 'bearer' }),
    send()
  ]);
  for (const response of [first, second]) {
    if (response.body.data?.booking?.id) ownedBookings.push(response.body.data.booking.id);
    expect(response.status).toBe(201);
  }
  expect(first.body.data.booking.client_id).toBe(client.getDataValue('id'));
  expect(second.body.data.booking.client_id).toBe(otherClient.getDataValue('id'));
  errorShape(unauthenticated, 401);
  expect(await container.models.Booking.count({ where: { artist_id: artist.getDataValue('id') } })).toBe(2);
});

test('client creates a pending booking, derives its owner, and accepts explicit timezone offsets', async () => {
  const { artist, client, clientToken } = await fixture();
  const body = bookingBody(artist);
  body.event_start = body.event_start.replace('Z', '+00:00');
  const response = await request(app).post('/api/v1/bookings').auth(clientToken, { type: 'bearer' }).send(body).expect(201);
  const created = response.body.data.booking;
  ownedBookings.push(created.id);
  expect(created.status).toBe('pending');
  expect(created.client_id).toBe(client.getDataValue('id'));
  expect(created.artist_id).toBe(artist.getDataValue('id'));
  expect(created.event_start).toBe(new Date(body.event_start).toISOString());
  expect(!('client_role' in created)).toBeTruthy();
});

test('booking creation rejects unauthorized callers, spoofed fields, invalid artists and malformed dates', async () => {
  const { artist, client, clientToken, artistToken } = await fixture();
  const send = (body: object, token = clientToken) => request(app).post('/api/v1/bookings').auth(token, { type: 'bearer' }).send(body);
  const body = bookingBody(artist);
  errorShape(await send(body, artistToken), 403);
  for (const changed of [
    { ...body, client_id: randomUUID() }, { ...body, status: 'confirmed' },
    { ...body, notes: '  ' }, { ...body, notes: 'a'.repeat(5001) },
    { ...body, artist_id: 'not-a-uuid' }, { ...body, event_start: '2027-02-30T12:00:00Z' },
    { ...body, event_start: '2027-01-01T12:00:00' }, { ...body, event_start: '2027-01-01T25:00:00Z' },
    { ...body, event_start: '2027-01-01T12:00:00.1234Z' }
  ]) errorShape(await send(changed), 400);
  errorShape(await send({ ...body, artist_id: randomUUID() }), 404);
  errorShape(await send({ ...body, artist_id: client.getDataValue('id') }), 404);
  await artist.update({ is_active: false });
  errorShape(await send(body), 404);
});

test('booking rejects past starts and nonpositive duration', async () => {
  const { artist, clientToken } = await fixture();
  const body = bookingBody(artist);
  for (const changed of [
    { ...body, event_start: new Date(Date.now() - 3600000).toISOString() },
    { ...body, event_end: body.event_start },
    { ...body, event_end: new Date(Date.now() + 1000).toISOString() }
  ]) errorShape(await request(app).post('/api/v1/bookings').auth(clientToken, { type: 'bearer' }).send(changed), 422);
});

test('overlap checks cover containment; adjacent events and overlapping pending requests are allowed', async () => {
  const { artist, client, clientToken } = await fixture();
  const times = futureWindow();
  await booking(artist, client, 'confirmed', times);
  const send = async (start: Date, end: Date, expected: number) => {
    const response = await request(app).post('/api/v1/bookings').auth(clientToken, { type: 'bearer' })
      .send(bookingBody(artist, { event_start: start, event_end: end }));
    if (expected === 201) { expect(response.status).toBe(201); ownedBookings.push(response.body.data.booking.id); }
    else errorShape(response, expected);
  };
  await send(times.event_start, times.event_end, 409);
  await send(new Date(+times.event_start + 1000), new Date(+times.event_end - 1000), 409);
  await send(new Date(+times.event_start - 1000), new Date(+times.event_end + 1000), 409);
  await send(new Date(+times.event_end - 1000), new Date(+times.event_end + 1000), 409);
  await send(times.event_end, new Date(+times.event_end + 3600000), 201);
  await send(times.event_end, new Date(+times.event_end + 3600000), 201);
  await send(new Date(+times.event_start - 3600000), times.event_start, 201);
});

test('required: pending -> completed returns 422 with descriptive error and no database mutation', async () => {
  const { artist, client, artistToken } = await fixture();
  const item = await booking(artist, client);
  const before = item.getDataValue('updated_at').getTime();
  const response = await patch(item.getDataValue('id'), artistToken, 'completed');
  errorShape(response, 422);
  expect(response.body.error).toMatch(/pending to completed/);
  expect(response.body.error).toMatch(/confirmed, cancelled/);
  await item.reload();
  expect(item.getDataValue('status')).toBe('pending');
  expect(item.getDataValue('updated_at').getTime()).toBe(before);
  expect(await container.models.BookingStatusHistory.count({ where: { booking_id: item.getDataValue('id') } })).toBe(0);
});

test('clients can only cancel and unrelated users cannot discover or update a booking', async () => {
  const { artist, client, artistToken, clientToken } = await fixture();
  const item = await booking(artist, client);
  const id = item.getDataValue('id');
  errorShape(await patch(id, clientToken, 'confirmed'), 403);
  const outsiderArtist = await user('artist'), outsiderClient = await user('client');
  errorShape(await patch(id, await login(outsiderArtist), 'confirmed'), 404);
  errorShape(await patch(id, await login(outsiderClient), 'cancelled'), 404);
  errorShape(await patch(randomUUID(), artistToken, 'confirmed'), 404);
  errorShape(await patch('bad-id', artistToken, 'confirmed'), 400);
  const cancelled = await patch(id, clientToken, 'cancelled').expect(200);
  expect(cancelled.body.data.booking.status).toBe('cancelled');
  errorShape(await patch(id, clientToken, 'cancelled'), 422);
});

test('legal progression records its history; time gates, skipped states and self-transitions are enforced', async () => {
  const { artist, client, artistToken, clientToken } = await fixture();
  const item = await booking(artist, client);
  const id = item.getDataValue('id');
  await patch(id, artistToken, 'confirmed').expect(200);
  errorShape(await patch(id, artistToken, 'confirmed'), 422);
  errorShape(await patch(id, artistToken, 'in_progress'), 422);
  errorShape(await patch(id, artistToken, 'completed'), 422);
  await patch(id, clientToken, 'cancelled').expect(200);
  errorShape(await patch(id, artistToken, 'confirmed'), 422);

  const started = await booking(artist, client, 'confirmed', {
    event_start: new Date(Date.now() - 7200000), event_end: new Date(Date.now() - 3600000)
  });
  const pastId = started.getDataValue('id');
  await patch(pastId, artistToken, 'in_progress').expect(200);
  errorShape(await patch(pastId, clientToken, 'completed'), 403);
  errorShape(await patch(pastId, artistToken, 'cancelled'), 422);
  await patch(pastId, artistToken, 'completed').expect(200);
  errorShape(await patch(pastId, artistToken, 'cancelled'), 422);
  const history = await container.models.BookingStatusHistory.findAll({ where: { booking_id: pastId }, order: [['changed_at', 'ASC']] });
  expect(history.map(row => [row.getDataValue('from_status'), row.getDataValue('to_status')])).toStrictEqual([['confirmed', 'in_progress'], ['in_progress', 'completed']]);

  const ongoing = await booking(artist, client, 'in_progress', {
    event_start: new Date(Date.now() - 600000), event_end: new Date(Date.now() + 600000)
  });
  errorShape(await patch(ongoing.getDataValue('id'), artistToken, 'completed'), 422);
  errorShape(await patch(ongoing.getDataValue('id'), artistToken, 'unknown'), 422);
});

test('two API instances cannot confirm overlapping pending requests concurrently', async () => {
  const { artist, client, artistToken } = await fixture();
  const times = futureWindow();
  const first = await booking(artist, client, 'pending', times);
  const second = await booking(artist, client, 'pending', times);
  const otherContainer = await createContainer(config);
  const otherApp = createApp(config, otherContainer);
  try {
    const responses = await Promise.all([
      patch(first.getDataValue('id'), artistToken, 'confirmed'),
      patch(second.getDataValue('id'), artistToken, 'confirmed', otherApp)
    ]);
    expect(responses.map(response => response.status).sort()).toStrictEqual([200, 409]);
    expect(await container.models.Booking.count({ where: { artist_id: artist.getDataValue('id'), status: 'confirmed' } })).toBe(1);
    const loser = responses.find(response => response.status === 409)!;
    errorShape(loser, 409);
  } finally { await otherContainer.db.close(); }
});

test('repeated concurrent confirmation applies exactly one transition and history record', async () => {
  const { artist, client, artistToken } = await fixture();
  const item = await booking(artist, client);
  const responses = await Promise.all([
    patch(item.getDataValue('id'), artistToken, 'confirmed'),
    patch(item.getDataValue('id'), artistToken, 'confirmed')
  ]);
  expect(responses.map(response => response.status).sort()).toStrictEqual([200, 422]);
  expect(await container.models.BookingStatusHistory.count({ where: { booking_id: item.getDataValue('id') } })).toBe(1);
});

test('database exclusion constraint independently rejects overlaps and retains in-progress reservations', async () => {
  const { artist, client } = await fixture();
  const times = futureWindow();
  await booking(artist, client, 'in_progress', times);
  const pending = await booking(artist, client, 'pending', times);
  await expect(pending.update({ status: 'confirmed' })).rejects.toHaveProperty('original.code', '23P01');
  await pending.reload();
  expect(pending.getDataValue('status')).toBe('pending');
});

test('reviews filter before pagination and compute a global summary with deterministic ordering', async () => {
  const { artist, client, clientToken } = await fixture();
  const created = new Date('2025-01-01T12:00:00Z');
  const reviews = [];
  for (const [index, score] of [5, 4, 1].entries()) {
    const item = await booking(artist, client, 'completed', {
      event_start: new Date(Date.now() - (20 - index) * 3600000),
      event_end: new Date(Date.now() - (19 - index) * 3600000)
    });
    reviews.push(await container.models.Review.create({ booking_id: item.getDataValue('id'), score, comment: 'Verified review', created_at: created }));
  }
  const hidden = await booking(artist, client, 'pending');
  await container.models.Review.create({ booking_id: hidden.getDataValue('id'), score: 2, comment: 'Must be excluded' });
  const path = '/api/v1/artists/' + artist.getDataValue('id') + '/reviews';
  const response = await request(app).get(path + '?page=1&limit=1').auth(clientToken, { type: 'bearer' }).expect(200);
  expect(response.body.data.reviews.length).toBe(1);
  expect(response.body.data.reviews[0].id).toBe(reviews.map(review => review.getDataValue('id')).sort().reverse()[0]);
  expect(response.body.data.reviews[0].created_at).toBe(created.toISOString());
  expect(response.body.data.summary).toStrictEqual({ average_score: '3.33', total_count: 3, score_distribution: { '1': 1, '2': 0, '3': 0, '4': 1, '5': 1 } });
  expect(response.body.data.pagination).toStrictEqual({ page: 1, limit: 1, total_pages: 3 });
  const emptyPage = await request(app).get(path + '?page=99&limit=1').auth(clientToken, { type: 'bearer' }).expect(200);
  expect(emptyPage.body.data.reviews).toStrictEqual([]);
  expect(emptyPage.body.data.summary).toStrictEqual(response.body.data.summary);
});

test('empty reviews, nonexistent artists and strict pagination have explicit behavior', async () => {
  const { artist, client, clientToken } = await fixture();
  const path = '/api/v1/artists/' + artist.getDataValue('id') + '/reviews';
  const get = (suffix: string) => request(app).get(path + suffix).auth(clientToken, { type: 'bearer' });
  const empty = await get('').expect(200);
  expect(empty.body.data.reviews).toStrictEqual([]);
  expect(empty.body.data.summary.average_score).toBe('0.00');
  expect(empty.body.data.pagination.total_pages).toBe(0);
  expect(empty.body.data.summary.score_distribution).toStrictEqual({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
  for (const suffix of ['?page=0', '?page=-1', '?page=1.5', '?page=2abc', '?page=', '?page=1&page=2', '?limit=101', '?limit=0', '?page=9007199254740991&limit=100', '?sort=asc']) {
    errorShape(await get(suffix), 400);
  }
  for (const id of [randomUUID(), client.getDataValue('id')]) {
    errorShape(await request(app).get('/api/v1/artists/' + id + '/reviews').auth(clientToken, { type: 'bearer' }), 404);
  }
});

test('HTTP access, authentication, booking, review and rate-limit logs share response request IDs', async () => {
  const entries: Array<Record<string, unknown>> = [];
  const logger = pino({ level: 'debug' }, { write(line: string) { entries.push(JSON.parse(line)); } });
  const loggedApp = createApp(config, container, { logger });
  const { artist, client, clientToken, artistToken } = await fixture();
  const signin = await request(loggedApp).post('/api/v1/auth/login').send({ email: client.getDataValue('email_normalized'), password }).expect(200);
  const created = await request(loggedApp).post('/api/v1/bookings').auth(clientToken, { type: 'bearer' })
    .send({ ...bookingBody(artist), notes: 'private-booking-notes' }).expect(201);
  const id = created.body.data.booking.id;
  ownedBookings.push(id);
  const confirmed = await patch(id, artistToken, 'confirmed', loggedApp).expect(200);
  const rejected = await patch(id, artistToken, 'completed', loggedApp).expect(422);
  const reviews = await request(loggedApp).get('/api/v1/artists/' + artist.getDataValue('id') + '/reviews')
    .auth(clientToken, { type: 'bearer' }).expect(200);
  const unauthorized = await request(loggedApp).post('/api/v1/bookings').send({}).expect(401);
  const missing = await request(loggedApp).get('/private-path?token=private-query').expect(404);
  const limitedApp = createApp(config, container, { logger, limits: { loginMax: 1 } });
  await request(limitedApp).post('/api/v1/auth/login').send({}).expect(400);
  const limited = await request(limitedApp).post('/api/v1/auth/login').send({}).expect(429);
  const expectations = [
    [signin, 'login_succeeded'], [created, 'booking_created'], [confirmed, 'booking_status_updated'],
    [rejected, 'request_rejected'], [reviews, 'reviews_listed'], [unauthorized, 'request_rejected'],
    [missing, 'request_rejected'], [limited, 'rate_limit_exceeded']
  ] as const;
  for (const [response, event] of expectations) {
    const related = entries.filter(entry => entry.request_id === response.headers['x-request-id']);
    expect(related.some(entry => entry.event === event)).toBeTruthy();
    const completed = related.filter(entry => entry.event === 'http_request_completed');
    expect(completed.length).toBe(1);
    expect(completed[0]!.status).toBe(response.status);
  }
  const creation = entries.find(entry => entry.event === 'booking_created')!;
  expect(creation.route).toBe('/api/v1/bookings');
  expect(creation.api_version).toBe('v1');
  expect(creation.user_id).toBe(client.getDataValue('id'));
  expect(creation.booking_id).toBe(id);
  const approval = entries.find(entry => entry.event === 'booking_status_updated')!;
  expect(approval.user_id).toBe(artist.getDataValue('id'));
  expect(approval.booking_status).toBe('confirmed');
  expect(approval.route).toBe('/api/v1/bookings/:id/status');
  for (const response of [signin, created, confirmed, rejected, reviews, unauthorized, limited]) {
    const related = entries.filter(entry => entry.request_id === response.headers['x-request-id']);
    expect(related.every(entry => entry.api_version === 'v1')).toBeTruthy();
    expect(related.every(entry => String(entry.route).startsWith('/api/v1/'))).toBeTruthy();
  }
  expect(!entries.some(entry => entry.request_id === rejected.headers['x-request-id'] && entry.event === 'booking_status_updated')).toBeTruthy();
  expect(entries.every(entry => typeof entry.request_id === 'string' && entry.log_scope === 'http')).toBeTruthy();
  const serialized = JSON.stringify(entries);
  for (const sensitive of [password, hash, clientToken, artistToken, signin.body.data.access_token, client.getDataValue('email_normalized'), 'private-booking-notes', 'private-path', 'private-query']) {
    expect(!serialized.includes(sensitive)).toBeTruthy();
  }
});

test('malformed JSON, content types, body limits, unknown routes and rate limits preserve the error envelope', async () => {
  errorShape(await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":'), 400);
  errorShape(await request(app).post('/api/v1/auth/login').send('plain text'), 415);
  errorShape(await request(app).post('/api/v1/auth/login').send({ email: 'a'.repeat(40000), password }), 413);
  errorShape(await request(app).get('/missing'), 404);
  const unsupported = await request(app).get('/api/v1/auth/login');
  errorShape(unsupported, 405);
  expect(unsupported.headers.allow).toBe('POST');
  const limited = createApp(config, container, { limits: { globalMax: 1, loginMax: 1 } });
  await request(limited).get('/health').expect(200);
  errorShape(await request(limited).get('/health'), 429);
});

