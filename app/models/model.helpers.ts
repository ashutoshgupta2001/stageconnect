import { DataTypes } from 'sequelize';
export const id = () => ({ type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 });
export const timestampFields = () => ({ created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW } });
export const timestamps = { createdAt: 'created_at', updatedAt: 'updated_at', timestamps: true };
