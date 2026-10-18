import type { Pagination } from '../domain/types.js';
import { AppError } from '../shared/errors.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { ReviewRepository } from '../repositories/review.repository.js';
export class ReviewService {
  constructor(private readonly users: UserRepository, private readonly reviews: ReviewRepository) {}
  async list(artistId: string, pagination: Pagination) {
    if (!await this.users.findArtist(artistId)) throw new AppError(404, 'Artist not found.');
    return this.reviews.list(artistId, pagination);
  }
}

