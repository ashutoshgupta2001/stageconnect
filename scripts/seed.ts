import bcrypt from 'bcrypt';
import { loadConfig } from '../app/config.js';
import { createDatabase } from '../app/db/connection.js';
import { defineModels } from '../app/models/index.js';
const config = loadConfig();
if (config.NODE_ENV !== 'development') throw new Error('Demo seeding is restricted to development.');
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || password.includes('\0')) {
  throw new Error('Set SEED_PASSWORD to a development-only password of at least 12 characters and at most 72 UTF-8 bytes.');
}
const db = createDatabase(config.DATABASE_URL);
const models = defineModels(db);
try {
  const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  await db.transaction(async transaction => {
    for (const role of ['artist', 'client'] as const) {
      const [user, created] = await models.User.findOrCreate({
        where: { email_normalized: role + '@stageconnect.test' },
        defaults: { email_normalized: role + '@stageconnect.test', password_hash: hash, role },
        transaction
      });
      if (created && role === 'artist') await models.ArtistProfile.create({
        user_id: user.getDataValue('id'), display_name: 'Demo Artist', bio: 'Acoustic performer',
        metadata: { equipment: ['Acoustic guitar'], social_links: {} }
      }, { transaction });
      console.log(role + ': ' + user.getDataValue('id') + (created ? ' created' : ' already exists; credentials unchanged'));
    }
  });
} finally { await db.close(); }

