import { QueryTypes, type Sequelize } from 'sequelize';
import * as initial from './migrations/001-initial-schema.js';
const migrations = [initial];
// Transactional migration ledger + DB lock: concurrent startup cannot apply a migration twice.
export async function migrate(db: Sequelize, direction: 'up' | 'down' = 'up'): Promise<string[]> {
  return db.transaction(async transaction => {
    await db.query("SET LOCAL lock_timeout = '5s'", { transaction });
    await db.query('SELECT pg_advisory_xact_lock(781155, 1)', { transaction });
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())', { transaction });
    const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name', { type: QueryTypes.SELECT, transaction });
    const applied = new Set(rows.map(row => row.name));
    if (rows.some(row => !migrations.some(item => item.name === row.name))) throw new Error('Database has unknown migrations; refusing to modify its schema.');
    const selected = direction === 'up' ? migrations.filter(item => !applied.has(item.name))
      : migrations.filter(item => applied.has(item.name)).slice(-1);
    for (const migration of selected) {
      await migration[direction](db, transaction);
      await db.query(direction === 'up' ? 'INSERT INTO schema_migrations(name) VALUES ($name)' : 'DELETE FROM schema_migrations WHERE name = $name',
        { bind: { name: migration.name }, transaction });
    }
    return selected.map(item => item.name);
  });
}

