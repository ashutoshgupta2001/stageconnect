import { Sequelize, Transaction } from 'sequelize';
import { databaseCode } from '../shared/errors.js';

export function createDatabase(url: string): Sequelize {
  return new Sequelize(url, {
    dialect: 'postgres',
    logging: false,
    timezone: '+00:00',
    pool: { min: 0, max: 10, acquire: 10000, idle: 10000 },
    dialectOptions: { application_name: 'stageconnect', statement_timeout: 15000 }
  });
}
export async function writeTransaction<T>(db: Sequelize, operation: (transaction: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async transaction => {
        await db.query("SET LOCAL lock_timeout = '3s'", { transaction });
        await db.query("SET LOCAL statement_timeout = '5s'", { transaction });
        return operation(transaction);
      });
    } catch (error) {
      // Only these database errors prove the entire transaction aborted safely.
      if (attempt >= 2 || !['40001', '40P01'].includes(databaseCode(error) ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

