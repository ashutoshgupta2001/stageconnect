import type { BookingAttributes } from '../models/index.js';

// Explicit response allowlist keeps future internal columns out of the public contract.
export function bookingDto(booking: BookingAttributes) {
  return {
    id: booking.id,
    artist_id: booking.artist_id,
    client_id: booking.client_id,
    event_start: booking.event_start.toISOString(),
    event_end: booking.event_end.toISOString(),
    notes: booking.notes,
    status: booking.status,
    created_at: booking.created_at.toISOString(),
    updated_at: booking.updated_at.toISOString()
  };
}
