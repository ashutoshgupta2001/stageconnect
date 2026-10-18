import type { Model, Optional } from 'sequelize';
import type { BookingStatus, Role } from '../domain/types.js';
interface Timestamps { created_at: Date; updated_at: Date }
export interface UserAttributes extends Timestamps {
  id: string; email_normalized: string; password_hash: string; role: Role; is_active: boolean;
}
export interface BookingAttributes extends Timestamps {
  id: string; client_id: string; artist_id: string; event_start: Date; event_end: Date; notes: string; status: BookingStatus;
}
export interface ReviewAttributes { id: string; booking_id: string; score: number; comment: string | null; created_at: Date }
export interface ProfileAttributes extends Timestamps { user_id: string; display_name: string; bio: string; location: string | null; metadata: Record<string, unknown> }
export interface HistoryAttributes { id: string; booking_id: string; from_status: BookingStatus; to_status: BookingStatus; changed_by: string; changed_at: Date }
export type UserModel = Model<UserAttributes, Optional<UserAttributes, 'id' | 'created_at' | 'updated_at' | 'is_active'>>;
export type BookingModel = Model<BookingAttributes, Optional<BookingAttributes, 'id' | 'created_at' | 'updated_at' | 'status'>>;
export type ReviewModel = Model<ReviewAttributes, Optional<ReviewAttributes, 'id' | 'created_at' | 'comment'>>;
export type ProfileModel = Model<ProfileAttributes, Optional<ProfileAttributes, 'created_at' | 'updated_at' | 'bio' | 'location' | 'metadata'>>;
export type HistoryModel = Model<HistoryAttributes, Optional<HistoryAttributes, 'id' | 'changed_at'>>;
