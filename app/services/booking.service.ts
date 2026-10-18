import type { Sequelize } from 'sequelize';
import { writeTransaction } from '../db/connection.js';
import { assertTransition } from '../domain/booking-state-machine.js';
import type { CreateBookingInput, Principal } from '../domain/types.js';
import { AppError } from '../shared/errors.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { BookingRepository } from '../repositories/booking.repository.js';
export class BookingService {
  constructor(private readonly db: Sequelize, private readonly bookings: BookingRepository, private readonly users: UserRepository) {}
  async create(actor: Principal, input: CreateBookingInput) {
    if (actor.role !== 'client') throw new AppError(403, 'Only clients can create bookings.');
    if (input.event_end <= input.event_start) throw new AppError(422, 'event_end must be later than event_start.');
    return writeTransaction(this.db, async transaction => {
      const artist = await this.users.findArtist(input.artist_id, transaction, true);
      if (!artist || !artist.getDataValue('is_active')) throw new AppError(404, 'Artist not found.');
      const now = await this.bookings.now(transaction);
      if (input.event_start < now) throw new AppError(422, 'event_start must not be in the past.');
      if (await this.bookings.findConflict(input.artist_id, input.event_start, input.event_end, transaction)) {
        throw new AppError(409, 'Artist is unavailable during the requested time window.');
      }
      return (await this.bookings.create(actor.id, input, transaction)).get({ plain: true });
    });
  }
  async updateStatus(actor: Principal, id: string, target: string) {
    // Read only to discover the artist lock key. All decisions use the locked reload below.
    const initial = await this.bookings.findOwned(id, actor);
    if (!initial) throw new AppError(404, 'Booking not found.');
    return writeTransaction(this.db, async transaction => {
      await this.users.findArtist(initial.getDataValue('artist_id'), transaction, true);
      const booking = await this.bookings.findOwned(id, actor, transaction, true);
      if (!booking) throw new AppError(404, 'Booking not found.');
      const now = await this.bookings.now(transaction);
      const next = assertTransition(booking.get({ plain: true }), target, actor, now);
      if (next === 'confirmed' && await this.bookings.findConflict(booking.getDataValue('artist_id'), booking.getDataValue('event_start'), booking.getDataValue('event_end'), transaction, id)) {
        throw new AppError(409, 'Artist is unavailable during the requested time window.');
      }
      await this.bookings.changeStatus(booking, next, actor.id, now, transaction);
      return booking.get({ plain: true });
    });
  }
}

