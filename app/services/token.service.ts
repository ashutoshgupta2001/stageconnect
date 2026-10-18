import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Config } from '../config.js';
import { AppError } from '../shared/errors.js';
import { ROLES, type Principal } from '../domain/types.js';
const claimsSchema = z.object({
  sub: z.string().uuid(), role: z.enum(ROLES), iat: z.number().int().nonnegative(), exp: z.number().int().positive()
});
export class TokenService {
  constructor(private readonly config: Config) {}
  issue(user: Principal): string {
    return jwt.sign({ role: user.role }, this.config.JWT_SECRET, {
      algorithm: 'HS256', subject: user.id, expiresIn: this.config.JWT_TTL_SECONDS,
      issuer: this.config.JWT_ISSUER, audience: this.config.JWT_AUDIENCE
    });
  }
  verify(token: string): Principal {
    try {
      const decoded = jwt.verify(token, this.config.JWT_SECRET, {
        algorithms: ['HS256'], issuer: this.config.JWT_ISSUER, audience: this.config.JWT_AUDIENCE,
        clockTolerance: 5
      });
      const claims = claimsSchema.parse(decoded);
      if (claims.iat > Math.floor(Date.now() / 1000) + 5 || claims.exp <= claims.iat) throw new Error('Invalid token times.');
      return { id: claims.sub.toLowerCase(), role: claims.role };
    } catch {
      throw new AppError(401, 'Invalid or expired authentication token.');
    }
  }
}

