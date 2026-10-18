import type { Request, Response } from 'express';
import type { Principal } from '../domain/types.js';
import { createBookingSchema, idSchema, statusSchema } from '../shared/validation.js';
import { success } from '../shared/errors.js';
import type { BookingService } from '../services/booking.service.js';
import { bookingDto } from '../dto/booking.dto.js';
import { requestLogger, routeTemplate } from '../shared/logger.js';
export class BookingController {
  constructor(private readonly service: BookingService) {}
  create = async (req: Request, res: Response): Promise<void> => {
    const booking = await this.service.create(res.locals.principal as Principal, createBookingSchema.parse(req.body));
    // Services return only after the transaction commits.
    requestLogger(res).info({ event: 'booking_created', route: routeTemplate(req), booking_id: booking.id, artist_id: booking.artist_id, booking_status: booking.status }, 'Booking created');
    success(res, { booking: bookingDto(booking) }, 201);
  };
  updateStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = idSchema.parse(req.params);
    const { status } = statusSchema.parse(req.body);
    const booking = await this.service.updateStatus(res.locals.principal as Principal, id, status);
    requestLogger(res).info({ event: 'booking_status_updated', route: routeTemplate(req), booking_id: booking.id, artist_id: booking.artist_id, booking_status: booking.status }, 'Booking status updated');
    success(res, { booking: bookingDto(booking) });
  };
}

