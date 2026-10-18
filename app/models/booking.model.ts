import { DataTypes, type Sequelize, type ModelStatic } from 'sequelize';
import type { BookingModel, UserModel } from './model.types.js';
import { id, timestampFields, timestamps } from './model.helpers.js';
import { BOOKING_STATUSES } from '../domain/types.js';

export function defineBooking(db: Sequelize, User: ModelStatic<UserModel>) {
  const Booking = db.define<BookingModel>('Booking', {
    ...timestampFields(),
    id: id(), client_id: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    artist_id: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    event_start: { type: DataTypes.DATE, allowNull: false }, event_end: { type: DataTypes.DATE, allowNull: false },
    notes: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending', validate: { isIn: [[...BOOKING_STATUSES]] } }
  }, { tableName: 'bookings', ...timestamps });
  return Booking;
}
