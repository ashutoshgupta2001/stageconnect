import { DataTypes, type Sequelize, type ModelStatic } from 'sequelize';
import type { HistoryModel, UserModel, BookingModel } from './model.types.js';
import { id } from './model.helpers.js';

export function defineBookingStatusHistory(db: Sequelize, User: ModelStatic<UserModel>, Booking: ModelStatic<BookingModel>) {
  const BookingStatusHistory = db.define<HistoryModel>('BookingStatusHistory', {
    id: id(), booking_id: { type: DataTypes.UUID, allowNull: false, references: { model: Booking, key: 'id' } },
    from_status: { type: DataTypes.STRING(20), allowNull: false },
    to_status: { type: DataTypes.STRING(20), allowNull: false },
    changed_by: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    changed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  }, { tableName: 'booking_status_history', timestamps: false });
  return BookingStatusHistory;
}
