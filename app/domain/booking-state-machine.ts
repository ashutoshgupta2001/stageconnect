import { AppError } from '../shared/errors.js';
import { BOOKING_STATUSES, type BookingStatus, type Principal, type Role } from './types.js';

interface Transition { roles: readonly Role[]; timeGate?: 'start' | 'end' }
const transitions: Record<BookingStatus, Partial<Record<BookingStatus, Transition>>> = {
  pending: { confirmed: { roles: ['artist'] }, cancelled: { roles: ['artist', 'client'] } },
  confirmed: { in_progress: { roles: ['artist'], timeGate: 'start' }, cancelled: { roles: ['artist', 'client'] } },
  in_progress: { completed: { roles: ['artist'], timeGate: 'end' } },
  completed: {},
  cancelled: {}
};
export function assertTransition(
  booking: { status: BookingStatus; event_start: Date; event_end: Date },
  target: string,
  actor: Principal,
  now: Date
): BookingStatus {
  const allowed = transitions[booking.status];
  const known = (BOOKING_STATUSES as readonly string[]).includes(target);
  const rule = known ? allowed[target as BookingStatus] : undefined;
  if (!rule) {
    const next = Object.keys(allowed).join(', ') || 'none (terminal state)';
    throw new AppError(422, 'Cannot transition booking from ' + booking.status + ' to ' + target.slice(0, 80) + '. Allowed next statuses: ' + next + '.');
  }
  if (!rule.roles.includes(actor.role)) throw new AppError(403, 'Clients can only cancel their own bookings.');
  if (rule.timeGate === 'start' && now < booking.event_start) throw new AppError(422, 'The event cannot start before its scheduled start time.');
  if (rule.timeGate === 'end' && now < booking.event_end) throw new AppError(422, 'The event cannot complete before its scheduled end time.');
  return target as BookingStatus;
}

