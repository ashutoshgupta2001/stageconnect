import { ZodError } from 'zod';
import type { ErrorRequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import { createRequestLogger, routeTemplate, safeDatabaseCode } from './logger.js';

export class AppError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}
export function success(res: Response, data: object, status = 200): void {
  res.status(status).json({ success: true, data, error: '' });
}
export function failure(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, data: {}, error: message });
}
export function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { original?: { code?: string }; parent?: { code?: string }; code?: string };
  return e.original?.code ?? e.parent?.code ?? e.code;
}
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    // The fallback also keeps this handler safe when mounted independently.
    const log: Logger = res.locals.logger ?? createRequestLogger(logger, res.locals.requestId ?? randomUUID(), req.method);
    if (res.headersSent) {
      log.error({ event: 'response_failed', route: routeTemplate(req), code: safeDatabaseCode(databaseCode(error)) }, 'Response failed after headers were sent');
      res.destroy();
      return;
    }
    let status = 500;
    let message = 'An unexpected error occurred.';
    if (error instanceof AppError) {
      status = error.status; message = error.message;
    } else if (error instanceof ZodError) {
      status = 400;
      const issue = error.issues[0];
      message = issue ? (issue.path.length ? issue.path.join('.') + ': ' : '') + issue.message : 'Invalid request.';
    } else {
      const bodyError = error as { type?: string; name?: string };
      if (bodyError?.type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON body.'; }
      else if (bodyError?.type === 'entity.too.large') { status = 413; message = 'Request body is too large.'; }
      else if (bodyError?.type === 'charset.unsupported' || bodyError?.type === 'encoding.unsupported') {
        status = 415; message = 'Unsupported request encoding.';
      } else if (databaseCode(error) === '23P01') {
        status = 409; message = 'Artist is unavailable during the requested time window.';
      } else if (['55P03', '57014', '40P01', '40001', '53300', '57P01'].includes(databaseCode(error) ?? '')
        || bodyError?.name?.startsWith('SequelizeConnection')) {
        status = 503; message = 'Service temporarily unavailable. Please retry.';
      }
    }
    // Error objects/messages can contain tokens, validation input or SQL parameters.
    const fields = { event: status >= 500 ? 'request_failed' : 'request_rejected', route: routeTemplate(req), code: safeDatabaseCode(databaseCode(error)), status };
    if (status >= 500) log.error(fields, 'Request failed');
    else log.warn(fields, 'Request rejected');
    if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    if (status === 503) res.setHeader('Retry-After', '1');
    failure(res, status, message);
  };
}

