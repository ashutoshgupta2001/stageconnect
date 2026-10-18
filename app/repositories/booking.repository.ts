import { Op, QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { BookingModel, Models } from '../models/index.js';
import { RESERVED_STATUSES, type BookingStatus, type CreateBookingInput, type Principal } from '../domain/types.js';
export class BookingRepository {
  constructor(private readonly models: Models, private readonly db: Sequelize) {}
  findOwned(id: string, actor: Principal, transaction?: Transaction, lock = false) {
    return this.models.Booking.findOne({
      where: { id, [actor.role === 'artist' ? 'artist_id' : 'client_id']: actor.id },
      transaction, ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {})
    });
  }
  async now(transaction: Transaction): Promise<Date> {
    const rows = await this.db.query<{ now: Date }>("SELECT date_trunc('milliseconds', clock_timestamp()) AS now",
      { type: QueryTypes.SELECT, transaction });
    return rows[0]!.now;
  }
  findConflict(artistId: string, start: Date, end: Date, transaction: Transaction, excludeId?: string) {
    return this.models.Booking.findOne({
      attributes: ['id'], transaction,
      where: {
        artist_id: artistId, status: { [Op.in]: RESERVED_STATUSES },
        event_start: { [Op.lt]: end }, event_end: { [Op.gt]: start },
        ...(excludeId ? { id: { [Op.ne]: excludeId } } : {})
      }
    });
  }
  create(clientId: string, input: CreateBookingInput, transaction: Transaction) {
    return this.models.Booking.create({ ...input, client_id: clientId, status: 'pending' }, { transaction });
  }
  async changeStatus(booking: BookingModel, target: BookingStatus, actorId: string, now: Date, transaction: Transaction) {
    const previous = booking.getDataValue('status');
    await booking.update({ status: target, updated_at: now }, { transaction });
    await this.models.BookingStatusHistory.create({
      booking_id: booking.getDataValue('id'), from_status: previous, to_status: target, changed_by: actorId, changed_at: now
    }, { transaction });
    return booking;
  }
}

