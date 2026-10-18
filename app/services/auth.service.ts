import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import { AppError } from '../shared/errors.js';
import type { Principal } from '../domain/types.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { TokenService } from './token.service.js';
export class AuthService {
  private constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
    private readonly config: Config,
    private readonly dummyHash: string
  ) {}
  static async create(users: UserRepository, tokens: TokenService, config: Config) {
    const dummyHash = await bcrypt.hash(randomBytes(24).toString('hex'), config.BCRYPT_ROUNDS);
    return new AuthService(users, tokens, config, dummyHash);
  }
  async login(input: { email: string; password: string }) {
    const user = await this.users.findByEmail(input.email);
    const matched = await bcrypt.compare(input.password, user?.getDataValue('password_hash') ?? this.dummyHash);
    if (!user || !matched || !user.getDataValue('is_active')) throw new AppError(401, 'Invalid email or password.');
    const principal: Principal = { id: user.getDataValue('id'), role: user.getDataValue('role') };
    return {
      access_token: this.tokens.issue(principal),
      token_type: 'Bearer', expires_in: this.config.JWT_TTL_SECONDS, user: principal
    };
  }
  async authenticate(header: string | undefined): Promise<Principal> {
    const match = /^Bearer ([^\s,]+)$/i.exec(header ?? '');
    if (!match) throw new AppError(401, 'A Bearer authentication token is required.');
    const principal = this.tokens.verify(match[1]!);
    const user = await this.users.findById(principal.id);
    if (!user || !user.getDataValue('is_active') || user.getDataValue('role') !== principal.role) throw new AppError(401, 'Invalid or expired authentication token.');
    return principal;
  }
}

