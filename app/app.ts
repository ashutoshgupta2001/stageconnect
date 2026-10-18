import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { pino, type Logger } from 'pino';
import type { Config } from './config.js';
import type { Container } from './container.js';
import { AppError, errorHandler, failure, success } from './shared/errors.js';
import { API_V1_PREFIX, createV1Router } from './routes/v1/index.js';
import { createRequestLoggingMiddleware } from './middleware/request-logging.middleware.js';
import { requestLogger, routeTemplate } from './shared/logger.js';
interface AppOptions {
  logger?: Logger;
  limits?: { globalMax?: number; loginMax?: number; windowMs?: number };
}
export function createApp(config: Config, container: Container, options: AppOptions = {}) {
  const app = express();
  const logger = options.logger ?? pino({ level: config.LOG_LEVEL });
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('query parser', 'simple');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use(createRequestLoggingMiddleware(logger));
  app.use(helmet());
  const origins = config.CORS_ORIGINS.split(',').map(value => value.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false, credentials: false, exposedHeaders: ['X-Request-ID'] }));
  const limiter = (max: number) => rateLimit({
    windowMs: options.limits?.windowMs ?? 15 * 60 * 1000,
    limit: max, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res) => {
      requestLogger(res).warn({ event: 'rate_limit_exceeded', route: routeTemplate(req), status: 429 }, 'Request rate limit exceeded');
      failure(res, 429, 'Too many requests. Please try again later.');
    }
  });
  app.use(limiter(options.limits?.globalMax ?? 300));
  app.use((req, _res, next) => {
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) {
      next(new AppError(415, 'Content-Type must be application/json.')); return;
    }
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(API_V1_PREFIX, createV1Router(container, limiter(options.limits?.loginMax ?? 20)));
  app.get('/health', async (_req, res) => {
    try { await container.db.authenticate(); success(res, { status: 'ok' }); }
    catch { throw new AppError(503, 'Service temporarily unavailable. Please retry.'); }
  });
  app.use((_req, _res, next) => next(new AppError(404, 'Route not found.')));
  app.use(errorHandler(logger));
  return app;
}

