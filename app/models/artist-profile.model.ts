import { DataTypes, type Sequelize, type ModelStatic } from 'sequelize';
import type { ProfileModel, UserModel } from './model.types.js';
import { timestampFields, timestamps } from './model.helpers.js';

export function defineArtistProfile(db: Sequelize, User: ModelStatic<UserModel>) {
  const ArtistProfile = db.define<ProfileModel>('ArtistProfile', {
    ...timestampFields(),
    user_id: { type: DataTypes.UUID, primaryKey: true, references: { model: User, key: 'id' } },
    display_name: { type: DataTypes.STRING(150), allowNull: false },
    bio: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    location: { type: DataTypes.STRING(200), allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { tableName: 'artist_profiles', ...timestamps });
  return ArtistProfile;
}
