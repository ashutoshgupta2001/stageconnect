import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { createRequestLogger, requestLogger, routeTemplate } from '../shared/logger.js';

export function createRequestLoggingMiddleware(logger: Logger): RequestHandler {
  return (req, res, next) => {
    // Generate our own ID; never trust client-supplied IDs for correlation.
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.locals.logger = createRequestLogger(logger, requestId, req.method);
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('Cache-Control', 'no-store');
    const started = performance.now();
    let recorded = false;
    const record = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      const log = requestLogger(res);
      const fields = {
        event: aborted ? 'http_request_aborted' : 'http_request_completed',
        route: routeTemplate(req),
        status: aborted ? undefined : res.statusCode,
        duration_ms: Math.round(performance.now() - started)
      };
      if (aborted) log.warn(fields, 'HTTP request aborted');
      else if (res.statusCode >= 500) log.error(fields, 'HTTP request completed');
      else if (res.statusCode >= 400) log.warn(fields, 'HTTP request completed');
      else log.info(fields, 'HTTP request completed');
    };
    res.once('finish', () => record(false));
    res.once('close', () => record(!res.writableFinished));
    next();
  };
}
