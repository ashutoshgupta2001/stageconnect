import type { Sequelize } from 'sequelize';
import { defineUser } from './user.model.js';
import { defineArtistProfile } from './artist-profile.model.js';
import { defineBooking } from './booking.model.js';
import { defineReview } from './review.model.js';
import { defineBookingStatusHistory } from './booking-status-history.model.js';
export type * from './model.types.js';

export function defineModels(db: Sequelize) {
  const User = defineUser(db);
  const ArtistProfile = defineArtistProfile(db, User);
  const Booking = defineBooking(db, User);
  const Review = defineReview(db, Booking);
  const BookingStatusHistory = defineBookingStatusHistory(db, User, Booking);
  User.hasOne(ArtistProfile, { foreignKey: 'user_id', as: 'profile' });
  ArtistProfile.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  Booking.belongsTo(User, { foreignKey: 'artist_id', as: 'artist' });
  Booking.belongsTo(User, { foreignKey: 'client_id', as: 'client' });
  Booking.hasOne(Review, { foreignKey: 'booking_id', as: 'review' });
  Review.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
  Booking.hasMany(BookingStatusHistory, { foreignKey: 'booking_id', as: 'history' });
  return { User, ArtistProfile, Booking, Review, BookingStatusHistory };
}
export type Models = ReturnType<typeof defineModels>;

