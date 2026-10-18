import 'dotenv/config';
import { createDatabase } from '../app/db/connection.js';
import { migrate } from '../app/db/migrator.js';
const direction = process.argv[2] ?? 'up';
if (direction !== 'up' && direction !== 'down') throw new Error('Usage: migrate.ts up|down');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (direction === 'down' && process.env.NODE_ENV === 'production') throw new Error('Production rollback requires a separately reviewed migration.');
const db = createDatabase(process.env.DATABASE_URL);
try {
  const applied = await migrate(db, direction);
  console.log(applied.length ? 'Migrations ' + direction + ': ' + applied.join(', ') : 'Schema is up to date.');
} finally { await db.close(); }

