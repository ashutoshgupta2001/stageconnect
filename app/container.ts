import type { Sequelize } from 'sequelize';
import type { Config } from './config.js';
import { createDatabase } from './db/connection.js';
import { defineModels } from './models/index.js';
import { UserRepository } from './repositories/user.repository.js';
import { TokenService } from './services/token.service.js';
import { AuthService } from './services/auth.service.js';
import { BookingRepository } from './repositories/booking.repository.js';
import { BookingService } from './services/booking.service.js';
import { ReviewRepository } from './repositories/review.repository.js';
import { ReviewService } from './services/review.service.js';

// Composition root: dependencies are explicit; domain services never import global singletons.
export async function createContainer(config: Config, database?: Sequelize) {
  const db = database ?? createDatabase(config.DATABASE_URL);
  const models = defineModels(db);
  const users = new UserRepository(models);
  const tokens = new TokenService(config);
  const auth = await AuthService.create(users, tokens, config);
  const bookings = new BookingService(db, new BookingRepository(models, db), users);
  const reviews = new ReviewService(users, new ReviewRepository(db));
  return { db, models, users, tokens, auth, bookings, reviews };
}
export type Container = Awaited<ReturnType<typeof createContainer>>;

