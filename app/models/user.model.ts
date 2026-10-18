import { DataTypes, type Sequelize } from 'sequelize';
import type { UserModel } from './model.types.js';
import { id, timestampFields, timestamps } from './model.helpers.js';
import { ROLES } from '../domain/types.js';

export function defineUser(db: Sequelize) {
  const User = db.define<UserModel>('User', {
    ...timestampFields(),
    id: id(), email_normalized: { type: DataTypes.STRING(254), allowNull: false, unique: true },
    password_hash: { type: DataTypes.TEXT, allowNull: false },
    role: { type: DataTypes.STRING(16), allowNull: false, validate: { isIn: [[...ROLES]] } },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, { tableName: 'users', ...timestamps });
  return User;
}
