import type { Request, Response } from 'express';
import type { AuthService } from '../services/auth.service.js';
import { loginSchema } from '../shared/validation.js';
import { success } from '../shared/errors.js';
import { requestLogger, routeTemplate } from '../shared/logger.js';
export class AuthController {
  constructor(private readonly service: AuthService) {}
  login = async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    const result = await this.service.login(loginSchema.parse(req.body));
    res.locals.logger = requestLogger(res).child({ user_id: result.user.id, role: result.user.role });
    requestLogger(res).info({ event: 'login_succeeded', route: routeTemplate(req) }, 'Login succeeded');
    success(res, result);
  };
}

