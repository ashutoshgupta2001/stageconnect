import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { createRequestLoggingMiddleware } from '../app/middleware/request-logging.middleware.js';
import { createRequestLogger, requestLogger } from '../app/shared/logger.js';
import { errorHandler, success } from '../app/shared/errors.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Log = Record<string, unknown>;
function capture(onEntry?: (entry: Log) => void) {
  const entries: Log[] = [];
  const logger = pino({ level: 'debug' }, { write(line: string) {
    const entry: Log = JSON.parse(line);
    entries.push(entry);
    onEntry?.(entry);
  } });
  return { logger, entries };
}

test('HTTP logs use the response request ID and isolate concurrent requests without exposing URLs or credentials', async () => {
  const { logger, entries } = capture();
  const app = express();
  app.use(createRequestLoggingMiddleware(logger));
  app.get('/work/:id', async (_req, res) => {
    await setImmediate();
    requestLogger(res).info({ event: 'work_done' }, 'Work done');
    success(res, {});
  });
  const responses = await Promise.all(['private-first', 'private-second'].map(id => request(app)
    .get('/work/' + id + '?token=private-query')
    .set('Authorization', 'Bearer private-authorization')
    .set('X-Request-ID', 'untrusted-request-id')));
  const ids = responses.map(response => response.headers['x-request-id']);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) {
    assert.ok(typeof id === 'string');
    assert.match(id, uuid);
    const related = entries.filter(entry => entry.request_id === id);
    assert.deepEqual(related.map(entry => entry.event), ['work_done', 'http_request_completed']);
    assert.ok(related.every(entry => entry.method === 'GET' && entry.log_scope === 'http'));
    const completed = related[1]!;
    assert.equal(completed.route, '/work/:id');
    assert.equal(completed.status, 200);
    assert.equal(completed.level, 30);
    assert.ok(Number(completed.duration_ms) >= 0);
  }
  assert.equal(entries.length, 4);
  const serialized = JSON.stringify(entries);
  for (const sensitive of ['private-first', 'private-second', 'private-query', 'private-authorization', 'untrusted-request-id']) {
    assert.ok(!serialized.includes(sensitive));
  }
});

test('parser failures and database errors keep request IDs and omit raw error details', async () => {
  const { logger, entries } = capture();
  const app = express();
  app.use(createRequestLoggingMiddleware(logger));
  app.use(express.json());
  app.post('/work', () => {
    throw Object.assign(new Error('private-database-password'), {
      original: { code: '55P03', sql: 'private-sql-parameters' }
    });
  });
  app.use(errorHandler(logger));
  const malformed = await request(app).post('/work').set('Content-Type', 'application/json').send('{"password":"private-body"');
  const unavailable = await request(app).post('/work').send({});
  for (const [response, status, level] of [[malformed, 400, 40], [unavailable, 503, 50]] as const) {
    assert.equal(response.status, status);
    const related = entries.filter(entry => entry.request_id === response.headers['x-request-id']);
    assert.equal(related.length, 2);
    assert.ok(related.every(entry => entry.level === level && entry.status === status));
    assert.equal(related[1]!.event, 'http_request_completed');
  }
  assert.equal(entries.find(entry => entry.event === 'request_failed')!.code, '55P03');
  assert.ok(entries.every(entry => uuid.test(String(entry.request_id))));
  assert.ok(!JSON.stringify(entries).includes('private-'));
});

test('request child loggers redact accidentally supplied credentials and request bodies', () => {
  const { logger, entries } = capture();
  const log = createRequestLogger(logger, 'test-correlation-id', 'POST');
  log.info({
    event: 'redaction_check', password: 'private-password', token: 'private-token',
    body: { notes: 'private-notes' }, headers: { authorization: 'private-header' },
    user: { password_hash: 'private-hash', email: 'private-email' },
    err: new Error('private-error'), JWT_SECRET: 'private-secret'
  }, 'Safe static message');
  assert.equal(entries[0]!.request_id, 'test-correlation-id');
  assert.equal(entries[0]!.password, '[REDACTED]');
  assert.equal(entries[0]!.body, '[REDACTED]');
  assert.ok(!JSON.stringify(entries).includes('private-'));
});

test('an interrupted HTTP response produces one aborted access log with its request ID', { timeout: 5000 }, async () => {
  let resolveAborted!: (entry: Log) => void;
  const aborted = new Promise<Log>(resolve => { resolveAborted = resolve; });
  const { logger, entries } = capture(entry => {
    if (entry.event === 'http_request_aborted') resolveAborted(entry);
  });
  const app = express();
  app.use(createRequestLoggingMiddleware(logger));
  app.get('/slow', (_req, res) => { res.flushHeaders(); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const id = await new Promise<string>((resolve, reject) => {
      const call = get({ host: '127.0.0.1', port: address.port, path: '/slow' }, response => {
        resolve(String(response.headers['x-request-id']));
        response.destroy();
      });
      call.on('error', reject);
    });
    const entry = await aborted;
    assert.equal(entry.request_id, id);
    assert.match(id, uuid);
    assert.equal(entry.route, '/slow');
    assert.equal(entry.level, 40);
    assert.equal(entry.status, undefined);
    assert.equal(entries.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
