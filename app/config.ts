import 'dotenv/config';
// Local port and database settings are loaded from the private .env file at startup.
import { z } from 'zod';
const postgresUrl = z.string().url().refine(value => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), 'Must be a PostgreSQL URL.');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: postgresUrl,
  JWT_SECRET: z.string().refine(value => Buffer.byteLength(value, 'utf8') >= 32, 'JWT_SECRET must contain at least 32 bytes.'),
  JWT_ISSUER: z.string().min(1).default('stageconnect'),
  JWT_AUDIENCE: z.string().min(1).default('stageconnect-api'),
  JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  CORS_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}

