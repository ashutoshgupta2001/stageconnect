import type { RequestHandler } from 'express';
import type { AuthService } from '../services/auth.service.js';
import { requestLogger, routeTemplate } from '../shared/logger.js';

// Inject the service once; authenticate independently for every request.
export function createAuthMiddleware(auth: Pick<AuthService, 'authenticate'>): RequestHandler {
  return async (req, res, next): Promise<void> => {
    try {
      // Response locals belong to this request, never to the middleware closure.
      res.locals.principal = await auth.authenticate(req.get('authorization'));
      const { id, role } = res.locals.principal;
      res.locals.logger = requestLogger(res).child({ user_id: id, role });
      requestLogger(res).debug({ event: 'authentication_succeeded', route: routeTemplate(req) }, 'Request authenticated');
    } catch (error) {
      // Preserve credential and infrastructure errors for the central handler.
      next(error);
      return;
    }
    next();
  };
}
