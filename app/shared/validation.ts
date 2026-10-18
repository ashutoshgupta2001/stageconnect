import { z } from 'zod';
export const uuid = z.string().uuid('Must be a valid UUID.').transform(value => value.toLowerCase());
const nonNul = (value: string) => !value.includes('\0');
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).refine(nonNul, 'Password contains an unsupported character.')
    .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.')
}).strict();

export function isTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0) || hour > 23 || minute > 59 || second > 59) return false;
  const offset = match[8]!;
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999;
}
const timestamp = z.string().refine(isTimestamp, 'Must be a real RFC 3339 timestamp with timezone and at most millisecond precision.')
  .transform(value => new Date(value));
export const createBookingSchema = z.object({
  artist_id: uuid,
  event_start: timestamp,
  event_end: timestamp,
  notes: z.string().trim().min(1).refine(value => [...value].length <= 5000, 'Must be at most 5000 characters.')
    .refine(nonNul, 'Contains an unsupported character.')
}).strict();
export const statusSchema = z.object({ status: z.string() }).strict();
export const idSchema = z.object({ id: uuid });
const positiveInteger = (fallback: string, max: number) => z.string().regex(/^[1-9]\d*$/, 'Must be a positive integer.')
  .default(fallback).transform(Number).refine(value => Number.isSafeInteger(value) && value <= max, 'Value exceeds the supported limit.');
export const paginationSchema = z.object({
  page: positiveInteger('1', Number.MAX_SAFE_INTEGER),
  limit: positiveInteger('20', 100)
}).strict().refine(value => Number.isSafeInteger((value.page - 1) * value.limit), 'Pagination offset exceeds the supported limit.');

