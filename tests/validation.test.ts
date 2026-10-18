import { expect, test } from '@jest/globals';
import { isTimestamp } from '../app/shared/validation.js';
test('strict timestamps handle leap years, offsets, precision and invalid calendar dates', () => {
  for (const value of ['2028-02-29T12:00:00Z', '2027-01-01T12:00:00.123+05:30', '2027-01-01T12:00:00-04:00']) expect(isTimestamp(value)).toBe(true);
  for (const value of ['2027-02-29T12:00:00Z', '2027-04-31T12:00:00Z', '2027-01-01', '2027-01-01T12:00:00', '2027-01-01T24:00:00Z', '2027-01-01T12:00:60Z', '2027-01-01T12:00:00+25:00', '2027-01-01T12:00:00+05:99', '2027-01-01T12:00:00.1234Z', '0000-01-01T00:00:00Z']) expect(isTimestamp(value)).toBe(false);
});

