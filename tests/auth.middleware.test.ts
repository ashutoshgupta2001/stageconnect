import { expect, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { createAuthMiddleware } from '../app/middleware/auth.middleware.js';
import { AppError, errorHandler, success } from '../app/shared/errors.js';
import { createRequestLoggingMiddleware } from '../app/middleware/request-logging.middleware.js';

test('authentication failures stop controller execution and preserve infrastructure error handling', async () => {
  const cases = [
    { error: new AppError(401, 'Invalid or expired authentication token.'), status: 401, message: 'Invalid or expired authentication token.' },
    { error: Object.assign(new Error('Private database details'), { name: 'SequelizeConnectionError' }), status: 503, message: 'Service temporarily unavailable. Please retry.' },
    { error: new Error('Private internal details'), status: 500, message: 'An unexpected error occurred.' }
  ];
  for (const { error, status, message } of cases) {
    const app = express();
    app.use(createRequestLoggingMiddleware(pino({ level: 'silent' })));
    let controllerCalls = 0;
    app.get('/protected', createAuthMiddleware({ authenticate: async () => { throw error; } }), (_req, res) => {
      controllerCalls++;
      success(res, { reached: true });
    });
    app.use(errorHandler(pino({ level: 'silent' })));
    const response = await request(app).get('/protected').set('Authorization', 'Bearer example');
    expect(controllerCalls).toBe(0);
    expect(response.status).toBe(status);
    expect(response.body).toStrictEqual({ success: false, data: {}, error: message });
    if (status === 401) expect(response.headers['www-authenticate']).toBe('Bearer');
    if (status === 503) expect(response.headers['retry-after']).toBe('1');
  }
});
