import type { Sequelize, Transaction } from 'sequelize';
export const name = '001-initial-schema';
export async function up(db: Sequelize, transaction: Transaction): Promise<void> {
  await db.query(`
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email_normalized varchar(254) NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role varchar(16) NOT NULL CHECK (role IN ('artist','client')),
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (id, role),
      CHECK (email_normalized = lower(btrim(email_normalized)))
    );
    CREATE TABLE artist_profiles (
      user_id uuid PRIMARY KEY,
      artist_role varchar(16) GENERATED ALWAYS AS ('artist'::varchar(16)) STORED,
      display_name varchar(150) NOT NULL,
      bio text NOT NULL DEFAULT '',
      location varchar(200),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (user_id, artist_role) REFERENCES users(id, role) ON DELETE RESTRICT ON UPDATE RESTRICT
    );
    CREATE TABLE bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL,
      artist_id uuid NOT NULL,
      client_role varchar(16) GENERATED ALWAYS AS ('client'::varchar(16)) STORED,
      artist_role varchar(16) GENERATED ALWAYS AS ('artist'::varchar(16)) STORED,
      event_start timestamptz NOT NULL,
      event_end timestamptz NOT NULL,
      notes text NOT NULL CHECK (char_length(btrim(notes)) BETWEEN 1 AND 5000),
      status varchar(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (client_id, client_role) REFERENCES users(id, role) ON DELETE RESTRICT ON UPDATE RESTRICT,
      FOREIGN KEY (artist_id, artist_role) REFERENCES users(id, role) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CHECK (client_id <> artist_id),
      CHECK (event_end > event_start AND isfinite(event_start) AND isfinite(event_end)),
      CONSTRAINT bookings_no_reserved_overlap EXCLUDE USING gist (
        artist_id WITH =, tstzrange(event_start, event_end, '[)') WITH &&
      ) WHERE (status IN ('confirmed','in_progress','completed'))
    );
    CREATE INDEX bookings_artist_status_id_idx ON bookings(artist_id, status, id);
    CREATE INDEX bookings_client_id_idx ON bookings(client_id);
    CREATE TABLE reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
      score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
      comment text CHECK (char_length(comment) <= 5000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE booking_status_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
      from_status varchar(20) NOT NULL,
      to_status varchar(20) NOT NULL,
      changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((from_status, to_status) IN (
        ('pending','confirmed'), ('confirmed','in_progress'), ('in_progress','completed'),
        ('pending','cancelled'), ('confirmed','cancelled')
      ))
    );
    CREATE INDEX history_booking_changed_idx ON booking_status_history(booking_id, changed_at);
  `, { transaction });
}
export async function down(db: Sequelize, transaction: Transaction): Promise<void> {
  // Leave the shared extension installed; another application may use it.
  await db.query('DROP TABLE booking_status_history, reviews, bookings, artist_profiles, users', { transaction });
}

