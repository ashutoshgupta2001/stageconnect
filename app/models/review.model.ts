import { DataTypes, type Sequelize, type ModelStatic } from 'sequelize';
import type { ReviewModel, BookingModel } from './model.types.js';
import { id } from './model.helpers.js';

export function defineReview(db: Sequelize, Booking: ModelStatic<BookingModel>) {
  const Review = db.define<ReviewModel>('Review', {
    id: id(), booking_id: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: Booking, key: 'id' } },
    score: { type: DataTypes.SMALLINT, allowNull: false, validate: { isInt: true, min: 1, max: 5 } },
    comment: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  }, { tableName: 'reviews', timestamps: false });
  return Review;
}
