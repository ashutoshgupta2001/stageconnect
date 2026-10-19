# Task 3: Artist leaderboard

Write the SQL query for this endpoint: GET /artists/leaderboard
The query must return the top 10 artists by average review score over the last 90 days. 
Requirements:
• Only include artists with at least 5 reviews in the period
• Each row: artist name, category, average score (rounded to 2 decimal places), total review
count, total completed booking count
• Order by average score descending; use total completed booking count as the tiebreaker

## How I understand the requirement

We want to show the ten highest-rated artists based on reviews written in the last 90 days. An artist needs at least five eligible reviews in that window to appear. Each result should show the artist's name, category, average rating, review count, and completed booking count.

I am using the existing PostgreSQL schema in StageConnect:

- The artist's name comes from `artist_profiles.display_name`.
- A review belongs to a booking through `reviews.booking_id`. The booking identifies the artist through `bookings.artist_id`.
- Only reviews attached to completed bookings count, matching the existing reviews endpoint.
- The current schema has no dedicated category column. This query assumes the category is stored as a string at `artist_profiles.metadata.category`. If that key is missing, the result contains `NULL`. The query does not create or populate categories.

The 90-day period applies to the review's `created_at`, not the booking date. I interpret **total completed booking count** as the artist's all-time count because the requirement does not give that count a separate date restriction. This includes completed bookings that have no review. The review count is limited to the last 90 days.

## SQL query

```sql
WITH review_window AS (
    SELECT statement_timestamp() AS end_at
),
review_stats AS (
    SELECT
        b.artist_id,
        AVG(r.score) AS raw_average_score,
        COUNT(*) AS total_review_count
    FROM reviews AS r
    JOIN bookings AS b ON b.id = r.booking_id
    CROSS JOIN review_window AS w
    WHERE b.status = 'completed'
      AND r.created_at >= w.end_at - INTERVAL '90 days'
      AND r.created_at < w.end_at
    GROUP BY b.artist_id
    HAVING COUNT(*) >= 5
),
completed_booking_stats AS (
    SELECT
        artist_id,
        COUNT(*) AS total_completed_booking_count
    FROM bookings
    WHERE status = 'completed'
    GROUP BY artist_id
)
SELECT
    ap.display_name AS artist_name,
    ap.metadata ->> 'category' AS category,
    ROUND(rs.raw_average_score, 2) AS average_score,
    rs.total_review_count,
    cbs.total_completed_booking_count
FROM review_stats AS rs
JOIN artist_profiles AS ap ON ap.user_id = rs.artist_id
JOIN completed_booking_stats AS cbs ON cbs.artist_id = rs.artist_id
ORDER BY
    rs.raw_average_score DESC,
    cbs.total_completed_booking_count DESC,
    ap.user_id ASC
LIMIT 10;
```

## Which indexes I would add, and why

I would start with a date index on reviews and evaluate a smaller index for completed bookings. These match the two expensive parts of this query: finding recent reviews and counting completed bookings.

```sql
-- Find reviews in the requested date range and carry their join key and score.
CREATE INDEX CONCURRENTLY reviews_leaderboard_created_at_idx
    ON reviews (created_at)
    INCLUDE (booking_id, score);

-- Group and count only completed bookings by artist.
CREATE INDEX CONCURRENTLY bookings_completed_artist_idx
    ON bookings (artist_id)
    WHERE status = 'completed';
```

**The reviews index is the first addition.** The query filters by `reviews.created_at`, so that is the search key. `booking_id` is needed to join the booking, and `score` is needed for the average. Including those two columns can let PostgreSQL obtain the required review data from the index without reading every matching table row. Whether it can avoid those table reads depends on the visibility map and vacuum maintenance. Including large review comments would increase index size without helping this query. See [PostgreSQL covering indexes](https://www.postgresql.org/docs/current/indexes-index-only-scans.html).

**The completed-bookings index targets the separate booking total.** It contains only completed bookings and keeps them ordered by artist ID, which can help grouping and counting. The schema already has `bookings_artist_status_id_idx` on `(artist_id, status, id)`. I would compare the plan using that existing index before adding another one. The proposed partial index stores fewer columns and leaves out other statuses, but its benefit will be smaller if nearly all bookings are completed. See [PostgreSQL partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html).

The existing primary keys on `bookings.id` and `artist_profiles.user_id` already support the joins. The unique index on `reviews.booking_id` already enforces one review per booking. I would keep those indexes rather than add duplicate ones. If the plan shows that looking up each completed booking by ID is the main cost, I would also evaluate a partial index on `bookings(id) INCLUDE (artist_id) WHERE status = 'completed'`; it could cover that lookup, at the cost of another index to maintain.

A normal index on the review score would not directly provide the leaderboard order because we sort by a calculated average for each artist. The artist name and category are output fields here, so they do not need indexes for this query.

I would not put `NOW() - INTERVAL '90 days'` in a partial-index condition. PostgreSQL requires index expressions and predicates to use immutable functions, and a moving clock cutoff does not meet that requirement. The time condition belongs in the query. The `CONCURRENTLY` statements above are production deployment examples: they must run outside an explicit transaction block, so they cannot be placed directly inside this app's current transactional migration runner. See [CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html).

Before choosing the final indexes, I would use `EXPLAIN (ANALYZE, BUFFERS)` with realistic data and check execution time, rows scanned, table reads, sort spills, and index size. If most reviews fall within the last 90 days, PostgreSQL may reasonably choose a sequential scan. An index does not remove the work of calculating averages and counts. See [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html).

For a very large review table where rows are mostly inserted in timestamp order, a `BRIN(created_at)` index is another option to benchmark. It stores small summaries of ranges of table pages, so it uses less space, but it still needs to examine matching table pages and does not replace the covering-index behavior above. See [PostgreSQL BRIN indexes](https://www.postgresql.org/docs/current/brin.html).

## How I would handle tens of millions of rows

At that scale, I would maintain summary data in the background and publish a cached leaderboard. The HTTP request would read the published result instead of joining and aggregating the large tables each time.

### Keep small summaries

I would first build the summaries from existing data in a background job. For reviews, I would maintain one summary row per artist per UTC day, containing `artist_id`, the day, the sum of eligible scores, and the eligible review count. I would keep the all-time completed-booking count in a separate per-artist summary. That preserves the query's current meaning: recent review statistics plus all-time completed bookings.

The average must be calculated from the combined score sum divided by the combined review count, using numeric division. Averaging daily averages would give a day with one review the same weight as a day with a hundred reviews and could produce the wrong ranking.

I would record changes through a transactional outbox or database change capture. Review creation, edits, deletions, and booking status changes that affect review eligibility would update the summaries. In particular, an existing review may become eligible when its booking becomes completed. Each event must be processed idempotently so a retry does not count the same review or booking twice. I would periodically compare summaries with the source data to detect and repair drift.

### Preserve the rolling 90-day window

Daily summaries alone would change the calculation into a whole-calendar-day report. The query uses an exact rolling timestamp window. To preserve it, I would add together summaries for the complete UTC days inside the window and query raw reviews only for the partial days at its two boundaries. Hourly or smaller buckets can reduce that remaining work further.

A scheduled job must advance the window even when no new reviews arrive. Otherwise, reviews that become older than 90 days would stay in the score indefinitely. Each published snapshot would use one defined `window_end` and a consistent data watermark so its scores and counts can be understood together.

### Publish and serve the result

A worker would periodically rank the summaries, apply the five-review minimum, sort by the unrounded average and completed-booking tiebreaker, and save the final top ten. As an example, we could agree on up to one minute of staleness and refresh once a minute; the actual interval should follow the product's freshness requirement.

I would keep a durable snapshot in PostgreSQL and cache the final response in Redis under a key such as `artists:leaderboard:v1`. The snapshot would include `generated_at` and `window_end`. Publishing a complete snapshot atomically prevents readers from seeing half of an update. Profile name or category changes would also be reflected on refresh.

On a cache miss, the API would read the last saved snapshot and arrange one background refresh. A shared lock or a job with a unique key would prevent multiple API instances from launching the same rebuild. Cache expiry should allow time for the refresh to finish, and refresh failures should preserve the last successful snapshot while alerting on its age. This makes the normal request a small cache or snapshot read, rather than a full aggregation.

### Where a materialized view fits

A PostgreSQL materialized view is a useful earlier step if the original aggregation is still cheap enough to run periodically. Requests can read its saved results, and `REFRESH MATERIALIZED VIEW CONCURRENTLY` can keep it readable during a refresh when its unique-index and initial-population requirements are satisfied. A standard PostgreSQL materialized-view refresh still reruns the defining query; it is not an automatic incremental update. If that refresh becomes too expensive, the maintained summaries described above would be my next step. See [materialized views](https://www.postgresql.org/docs/current/rules-materializedviews.html) and [refreshing them](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html).

## Why the query is written this way

`review_window` captures the start time of the SQL statement once. We use that same point when checking both ends of the 90-day window. A review exactly at the lower boundary is included. Reviews at or after the upper boundary are excluded, including future-dated reviews. The app uses UTC database connections and stores these timestamps as `timestamptz`.

`review_stats` finds eligible reviews, groups them by artist ID, and calculates their average and count. `HAVING COUNT(*) >= 5` removes artists who do not have enough reviews after the date and booking-status filters have been applied. We group by ID because different artists can have the same name.

`completed_booking_stats` counts completed bookings separately. Joining every review directly to every completed booking for an artist would repeat rows and inflate the counts. Calculating both totals first gives us one row per artist on each side. An artist who qualifies through five completed-booking reviews necessarily has a completed-booking total, so the final inner join is appropriate.

For example, if an artist has six eligible recent reviews and twelve completed bookings overall, the result reports six reviews and twelve completed bookings. It does not count only the bookings that received a recent review.

The final query adds the profile name and category, rounds the displayed average to two decimal places, and returns up to ten artists. It ranks by the actual average before rounding. For example, 4.254 ranks above 4.251 even though both display as 4.25. The completed-booking count breaks ties when the actual averages are equal. If both values are equal, artist ID gives a stable final order.

## Edge cases and assumptions

- Exactly five eligible reviews qualifies; four does not, even if the artist has many older reviews.
- Pending, confirmed, in-progress, and cancelled bookings do not contribute eligible reviews or completed-booking totals.
- The current schema permits one review per booking and requires a score from 1 to 5, so a booking cannot contribute duplicate reviews or a missing score.
- An eligible artist needs a profile to supply the requested name. A missing category remains `NULL`; it does not remove the artist.
- If fewer than ten artists qualify, return those artists. If none qualify, the query returns no rows.
- Artists are ranked together across categories; the requirement asks for one top ten, not a separate top ten per category.

If the intended booking count is also limited to the last 90 days, that is a different interpretation to confirm before implementation. In this schema, use the `completed` entries in `booking_status_history.changed_at` to identify when bookings were completed. A booking's creation time or scheduled end time does not necessarily tell us when its status became completed.

For the current app, the versioned HTTP route would be `GET /api/v1/artists/leaderboard`. This document supplies the query and its reasoning; the query can be executed through `sequelize.query` when the endpoint is added.

## Query verification

I checked the SQL against PostgreSQL using sample data inside a read-only query. The checks covered the top-ten limit, the five-review minimum, reviews on the date boundaries, completed-booking filtering, unreviewed completed bookings, missing categories, artists with the same name, and the ranking and tiebreaker. No application records were changed.

PostgreSQL references: [aggregate functions](https://www.postgresql.org/docs/current/functions-aggregate.html), [grouping and HAVING](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-GROUP), and [current date/time functions](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).



# Schema Audit 
The schema below has 5 problems. For each one, write: what the problem is, why it matters, and the SQL to fix it.

```sql
CREATE TABLE artists (
 id INT PRIMARY KEY AUTO_INCREMENT,
 name VARCHAR(255),
 category VARCHAR(255),
 hourly_rate FLOAT,
 created_at DATETIME
);
CREATE TABLE bookings (
 id INT PRIMARY KEY AUTO_INCREMENT,
 artist_id INT,
 client_id INT,
 status VARCHAR(50),
 amount FLOAT,
 event_start DATETIME,
 event_end DATETIME,
 created_at DATETIME
);
CREATE TABLE reviews (
 id INT PRIMARY KEY AUTO_INCREMENT,
 booking_id INT,
 artist_id INT,
 score INT,
 comment TEXT,
 created_at DATETIME
);
```

## Schema audit answer

The supplied schema uses MySQL syntax (`AUTO_INCREMENT` and `DATETIME`). The fixes in this section target MySQL 8.0.16 or later with InnoDB tables and strict SQL mode. This is a separate audit of the supplied schema; the earlier leaderboard query targets the existing PostgreSQL app.

Before adding the constraints, check and repair existing rows with missing references, invalid values, or duplicate reviews. The `ALTER TABLE` statements are intended to reject bad data rather than guess how to repair it. Run the fixes in the order shown after that cleanup. The client foreign key has an explicit parent-table assumption below.

### 1. Money is stored using FLOAT

**What the problem is:** `artists.hourly_rate` and `bookings.amount` use `FLOAT`. This is an approximate numeric type, so some decimal amounts cannot be stored exactly. Both fields also allow missing or negative values.

**Why it matters:** Small rounding differences can become billing, refund, or reporting discrepancies. A booking should have a known, valid amount, and an artist's rate should have a defined monetary value.

**SQL to fix it:** Use `DECIMAL` for exact decimal storage, require a value, and reject negative amounts. Zero remains valid for a free event. Here, `DECIMAL(12,2)` assumes the billing currency uses two decimal places; choose the precision and scale to match the actual pricing limits and currency.

```sql
ALTER TABLE artists
    MODIFY COLUMN hourly_rate DECIMAL(12,2) NOT NULL,
    ADD CONSTRAINT chk_artists_hourly_rate
        CHECK (hourly_rate >= 0);

ALTER TABLE bookings
    MODIFY COLUMN amount DECIMAL(12,2) NOT NULL,
    ADD CONSTRAINT chk_bookings_amount
        CHECK (amount >= 0);
```

Changing the type prevents future approximate storage. It cannot recover precision already lost in old `FLOAT` values, so reconcile existing amounts with the original pricing or payment records first. See [MySQL exact numeric types](https://dev.mysql.com/doc/refman/8.4/en/fixed-point-types.html).

### 2. Relationships are not protected by foreign keys

**What the problem is:** `bookings.artist_id`, `bookings.client_id`, and `reviews.booking_id` are ordinary nullable integers. They do not require a matching parent record.

**Why it matters:** A booking could reference an artist or client who does not exist. A review could reference a missing booking. Deleting a parent could leave orphaned records, which makes ownership checks and reports unreliable.

**SQL to fix it:** Require the relationship fields and add foreign keys. I use `RESTRICT` to preserve booking and review history when a referenced record is still in use.

```sql
ALTER TABLE bookings
    MODIFY COLUMN artist_id INT NOT NULL,
    MODIFY COLUMN client_id INT NOT NULL,
    ADD CONSTRAINT fk_bookings_artist
        FOREIGN KEY (artist_id) REFERENCES artists(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE reviews
    MODIFY COLUMN booking_id INT NOT NULL,
    ADD CONSTRAINT fk_reviews_booking
        FOREIGN KEY (booking_id) REFERENCES bookings(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;
```

The screenshot does not include a client table. The following statement assumes the authoritative client table is called `clients`, uses InnoDB, and has an `id INT PRIMARY KEY` with matching signedness. Replace that reference with the actual client-account table if its name differs, and align the column types before adding the key.

```sql
-- Requires the existing client-account parent table described above.
ALTER TABLE bookings
    ADD CONSTRAINT fk_bookings_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;
```

The redundant `reviews.artist_id` is handled by removing it in problem 5. The review's artist will then come from its protected booking relationship. See [MySQL foreign keys](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html).

### 3. Booking rows can contain an invalid status or time window

**What the problem is:** `status` accepts arbitrary text or `NULL`. The start and end dates can also be missing, and nothing requires the end to be later than the start.

**Why it matters:** Values such as `approved`, misspellings, or a missing status can break the booking workflow. An event with no start time or an end before its start cannot be scheduled correctly and makes overlap checks unreliable.

**SQL to fix it:** Restrict the stored status values, give new requests a `pending` default, and require a valid interval.

```sql
ALTER TABLE bookings
    MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending',
    MODIFY COLUMN event_start DATETIME NOT NULL,
    MODIFY COLUMN event_end DATETIME NOT NULL,
    ADD CONSTRAINT chk_bookings_status
        CHECK (CAST(status AS BINARY) IN (
            'pending', 'confirmed', 'in_progress', 'completed', 'cancelled'
        )),
    ADD CONSTRAINT chk_bookings_event_window
        CHECK (event_end > event_start);
```

The binary comparison requires the exact lowercase status names even when the database's normal text collation is case-insensitive. `NOT NULL` is needed as well: a `CHECK` condition alone does not reject a result of `UNKNOWN` caused by a null value.

This validates the contents of one booking row. The service must still enforce allowed transitions, ownership, whether the event has started or finished, and concurrent overlap prevention. A list of valid statuses does not by itself prevent `pending` from jumping directly to `completed`.

### 4. Reviews are not limited to one valid rating per booking

**What the problem is:** `score` accepts any integer or `NULL`, and `booking_id` is not unique. The same booking could therefore receive several reviews, including scores outside the 1–5 scale.

**Why it matters:** Invalid scores and repeated reviews can distort an artist's average and the five-review leaderboard threshold. The current app's review model is one review per booking, so that rule should be enforced in the database too.

**SQL to fix it:** Require a score between 1 and 5 and make the booking reference unique. Problem 2 already makes `booking_id` mandatory.

```sql
ALTER TABLE reviews
    MODIFY COLUMN score SMALLINT NOT NULL,
    ADD CONSTRAINT chk_reviews_score
        CHECK (score BETWEEN 1 AND 5),
    ADD CONSTRAINT uq_reviews_booking
        UNIQUE (booking_id);
```

If duplicates already exist, decide which review is authoritative before adding the unique constraint. Do not silently delete records or average duplicates during the migration. These constraints protect rating values and review cardinality; the completed-booking filter remains part of the review and leaderboard queries.

### 5. The artist is stored twice for the same review

**What the problem is:** `reviews.artist_id` repeats information already available through `reviews.booking_id -> bookings.artist_id`. The two artist IDs can disagree.

**Why it matters:** A review could be credited to one artist even though the booking belongs to another. Different queries could then return different ratings for the same artist. Adding a foreign key to each artist ID would only prove that both artists exist; it would not prove that they are the same artist.

**SQL to fix it:** Check mismatches, resolve them against the verified booking, and remove the duplicate column. Read the artist through the booking when it is needed.

```sql
-- Investigate these rows before changing how existing reviews are attributed.
SELECT
    r.id AS review_id,
    r.artist_id AS review_artist_id,
    b.artist_id AS booking_artist_id
FROM reviews AS r
JOIN bookings AS b ON b.id = r.booking_id
WHERE r.artist_id IS NULL
   OR r.artist_id <> b.artist_id;

-- Apply after resolving mismatches and updating queries/writers that use it.
ALTER TABLE reviews
    DROP COLUMN artist_id;

-- Read the artist from the single authoritative relationship.
SELECT
    r.id,
    r.booking_id,
    b.artist_id,
    r.score,
    r.comment,
    r.created_at
FROM reviews AS r
JOIN bookings AS b ON b.id = r.booking_id;
```

Queries and application writes that currently reference `reviews.artist_id` must be updated before dropping it. Removing the redundant value makes the booking relationship the single source of truth for review ownership.

The SQL above is a proposed repair of the supplied MySQL schema. It has not been applied to the StageConnect database. MySQL references: [enforced CHECK constraints and their version requirements](https://dev.mysql.com/doc/refman/8.0/en/create-table-check-constraints.html), [binary casts](https://dev.mysql.com/doc/refman/8.4/en/cast-functions.html), and [ALTER TABLE syntax](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html).
