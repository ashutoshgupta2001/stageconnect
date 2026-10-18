import { Router, type RequestHandler } from 'express';
import type { Container } from '../../container.js';
import { AuthController } from '../../controllers/auth.controller.js';
import { BookingController } from '../../controllers/booking.controller.js';
import { ReviewController } from '../../controllers/review.controller.js';
import { createAuthMiddleware } from '../../middleware/auth.middleware.js';
import { AppError } from '../../shared/errors.js';
import { requestLogger } from '../../shared/logger.js';

export const API_V1_PREFIX = '/api/v1';

export function createV1Router(container: Container, loginLimiter: RequestHandler): Router {
  const router = Router();
  const authenticate = createAuthMiddleware(container.auth);
  const auth = new AuthController(container.auth);
  const bookings = new BookingController(container.bookings);
  const reviews = new ReviewController(container.reviews);
  const methodNotAllowed = (methods: string): RequestHandler => (_req, res, next) => {
    res.setHeader('Allow', methods);
    next(new AppError(405, 'Method not allowed.'));
  };

  router.use((_req, res, next) => {
    // Retain trusted version metadata even after Express unwinds the router.
    res.locals.apiBasePath = API_V1_PREFIX;
    res.locals.logger = requestLogger(res).child({ api_version: 'v1' });
    next();
  });
  router.route('/auth/login').post(loginLimiter, auth.login).all(methodNotAllowed('POST'));
  router.route('/bookings').post(authenticate, bookings.create).all(methodNotAllowed('POST'));
  router.route('/bookings/:id/status').patch(authenticate, bookings.updateStatus).all(methodNotAllowed('PATCH'));
  router.route('/artists/:id/reviews').get(authenticate, reviews.list).all(methodNotAllowed('GET, HEAD'));
  return router;
}
