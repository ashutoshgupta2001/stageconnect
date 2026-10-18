import type { Request, Response } from 'express';
import type { Logger } from 'pino';

// Logs use explicit fields. Redaction also protects against accidental additions.
const redact = {
  paths: [
    'req', 'res', 'headers', 'body', 'query', 'err', 'error', 'stack',
    'password', 'password_hash', 'access_token', 'token', 'authorization', 'cookie',
    'email', 'email_normalized', 'notes', 'comment', 'DATABASE_URL', 'JWT_SECRET', 'SEED_PASSWORD',
    '*.password', '*.password_hash', '*.access_token', '*.token', '*.authorization',
    '*.cookie', '*.email', '*.email_normalized', '*.notes', '*.comment'
  ],
  censor: '[REDACTED]'
};

export function createRequestLogger(logger: Logger, requestId: string, method: string): Logger {
  return logger.child({ request_id: requestId, method, log_scope: 'http' }, { redact });
}

export function requestLogger(res: Response): Logger {
  return res.locals.logger as Logger;
}

export function routeTemplate(req: Request): string {
  // Raw URLs, query strings and unmatched paths can contain personal data.
  return typeof req.route?.path === 'string'
    ? (req.res?.locals.apiBasePath ?? '') + req.route.path
    : 'unmatched';
}

export function safeDatabaseCode(code: unknown): string | undefined {
  return typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : undefined;
}
