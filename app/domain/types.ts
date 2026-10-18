export const ROLES = ['artist', 'client'] as const;
export type Role = typeof ROLES[number];
export const BOOKING_STATUSES = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'] as const;
export type BookingStatus = typeof BOOKING_STATUSES[number];
// Progression preserves the originally reserved interval, including historical bookings.
export const RESERVED_STATUSES: BookingStatus[] = ['confirmed', 'in_progress', 'completed'];
export interface Principal { id: string; role: Role }
export interface CreateBookingInput { artist_id: string; event_start: Date; event_end: Date; notes: string }
export interface Pagination { page: number; limit: number }

