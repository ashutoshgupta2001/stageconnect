import { QueryTypes, type Sequelize } from 'sequelize';
import type { Pagination } from '../domain/types.js';
interface ReviewResult {
  reviews: Array<{ id: string; score: number; comment: string | null; created_at: string }>;
  total_count: string; average_score: string;
  one: string; two: string; three: string; four: string; five: string;
}
export class ReviewRepository {
  constructor(private readonly db: Sequelize) {}
  async list(artistId: string, pagination: Pagination) {
    // One statement gives the page and global summary the exact same MVCC snapshot.
    const rows = await this.db.query<ReviewResult>(`
      WITH eligible AS MATERIALIZED (
        SELECT r.id, r.score, r.comment, r.created_at
        FROM reviews r JOIN bookings b ON b.id = r.booking_id
        WHERE b.artist_id = $artistId AND b.status = 'completed'
      ), page AS (
        SELECT * FROM eligible ORDER BY created_at DESC, id DESC LIMIT $limit OFFSET $offset
      )
      SELECT
        COALESCE((SELECT jsonb_agg(
          jsonb_build_object('id', id, 'score', score, 'comment', comment, 'created_at', created_at)
          ORDER BY created_at DESC, id DESC) FROM page), '[]'::jsonb) AS reviews,
        count(*)::text AS total_count,
        COALESCE(round(avg(score)::numeric, 2), 0.00)::numeric(3,2)::text AS average_score,
        count(*) FILTER (WHERE score = 1)::text AS one,
        count(*) FILTER (WHERE score = 2)::text AS two,
        count(*) FILTER (WHERE score = 3)::text AS three,
        count(*) FILTER (WHERE score = 4)::text AS four,
        count(*) FILTER (WHERE score = 5)::text AS five
      FROM eligible
    `, {
      type: QueryTypes.SELECT,
      bind: { artistId, limit: pagination.limit, offset: (pagination.page - 1) * pagination.limit }
    });
    const result = rows[0]!;
    const total = Number(result.total_count);
    if (!Number.isSafeInteger(total)) throw new Error('Review count exceeds the supported JSON integer range.');
    return {
      artist_id: artistId,
      reviews: result.reviews.map(review => ({ ...review, created_at: new Date(review.created_at).toISOString() })),
      summary: {
        average_score: result.average_score, total_count: total,
        score_distribution: { '1': Number(result.one), '2': Number(result.two), '3': Number(result.three), '4': Number(result.four), '5': Number(result.five) }
      },
      pagination: { ...pagination, total_pages: Math.ceil(total / pagination.limit) }
    };
  }
}

