import { type Transaction } from 'sequelize';
import type { Models } from '../models/index.js';
export class UserRepository {
  constructor(private readonly models: Models) {}
  findByEmail(email: string) {
    return this.models.User.findOne({ where: { email_normalized: email } });
  }
  findById(id: string) {
    return this.models.User.findByPk(id, { attributes: ['id', 'role', 'is_active'] });
  }
  findArtist(id: string, transaction?: Transaction, lock = false) {
    return this.models.User.findOne({
      attributes: ['id', 'role', 'is_active'],
      where: { id, role: 'artist' }, transaction,
      ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {})
    });
  }
}

