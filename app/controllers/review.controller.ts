import type { Request, Response } from 'express';
import { idSchema, paginationSchema } from '../shared/validation.js';
import { success } from '../shared/errors.js';
import type { ReviewService } from '../services/review.service.js';
import { requestLogger, routeTemplate } from '../shared/logger.js';
export class ReviewController {
  constructor(private readonly service: ReviewService) {}
  list = async (req: Request, res: Response): Promise<void> => {
    const { id } = idSchema.parse(req.params);
    const pagination = paginationSchema.parse(req.query);
    const result = await this.service.list(id, pagination);
    requestLogger(res).debug({ event: 'reviews_listed', route: routeTemplate(req), artist_id: id, ...pagination, returned_count: result.reviews.length }, 'Artist reviews listed');
    success(res, result);
  };
}

