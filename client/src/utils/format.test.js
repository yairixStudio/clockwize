import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatDurationHuman,
  formatCurrency,
  formatDate,
  formatDateTime,
  secondsToHours,
  formatTimeOnly,
  calculateEndTime
} from './format';

describe('test environment', () => {
  it('runs in the Israel timezone (set in vitest.config.js)', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Jerusalem');
  });
});

describe('formatDuration', () => {
  it('formats zero as 00:00:00', () => {
    expect(formatDuration(0)).toBe('00:00:00');
  });

  it('pads hours, minutes and seconds', () => {
    expect(formatDuration(1)).toBe('00:00:01');
    expect(formatDuration(59)).toBe('00:00:59');
    expect(formatDuration(60)).toBe('00:01:00');
    expect(formatDuration(3599)).toBe('00:59:59');
    expect(formatDuration(3600)).toBe('01:00:00');
    expect(formatDuration(3661)).toBe('01:01:01');
  });

  it('does not wrap hours at 24 (multi-day totals)', () => {
    expect(formatDuration(25 * 3600)).toBe('25:00:00');
    expect(formatDuration(100 * 3600 + 5)).toBe('100:00:05');
  });

  it('handles very large values without exponent notation', () => {
    expect(formatDuration(10_000 * 3600 + 59 * 60 + 59)).toBe('10000:59:59');
  });

  // Callers floor elapsed time, but a start_time slightly in the future (clock skew)
  // produces a negative value and the output becomes "-1:-1:-1"
  it.fails('never renders negative components for negative input', () => {
    expect(formatDuration(-1)).toMatch(/^-?\d{2}:\d{2}:\d{2}$/);
  });
});

describe('formatDurationHuman', () => {
  it('returns "0 דקות" for zero', () => {
    expect(formatDurationHuman(0)).toBe('0 דקות');
  });

  it('returns "0 דקות" for less than a minute', () => {
    expect(formatDurationHuman(59)).toBe('0 דקות');
  });

  it('uses singular forms for exactly one hour / one minute', () => {
    expect(formatDurationHuman(60)).toBe('1 דקה');
    expect(formatDurationHuman(3600)).toBe('1 שעה');
    expect(formatDurationHuman(3660)).toBe('1 שעה ו-1 דקה');
  });

  it('uses plural forms and joins with "ו-"', () => {
    expect(formatDurationHuman(2 * 3600 + 30 * 60)).toBe('2 שעות ו-30 דקות');
    expect(formatDurationHuman(5 * 60)).toBe('5 דקות');
    expect(formatDurationHuman(3 * 3600)).toBe('3 שעות');
  });

  it('drops leftover seconds', () => {
    expect(formatDurationHuman(3600 + 59)).toBe('1 שעה');
  });

  it('falls back to "0 דקות" for negative or NaN input', () => {
    expect(formatDurationHuman(-120)).toBe('0 דקות');
    expect(formatDurationHuman(NaN)).toBe('0 דקות');
  });

  it('handles large totals', () => {
    expect(formatDurationHuman(1000 * 3600)).toBe('1000 שעות');
  });
});

describe('formatCurrency', () => {
  it('prefixes the shekel sign and groups thousands', () => {
    expect(formatCurrency(0)).toBe('₪0');
    expect(formatCurrency(1000)).toBe('₪1,000');
    expect(formatCurrency(1234567)).toBe('₪1,234,567');
  });

  it('accepts a custom currency symbol', () => {
    expect(formatCurrency(50, '$')).toBe('$50');
    expect(formatCurrency(50, '')).toBe('50');
  });

  it('keeps the he-IL bidi mark in front of negative amounts', () => {
    // he-IL puts a LEFT-TO-RIGHT MARK before the minus sign so it renders correctly in RTL
    expect(formatCurrency(-500)).toBe('₪‎-500');
  });

  it('keeps up to two decimals', () => {
    expect(formatCurrency(12.5)).toBe('₪12.5');
    expect(formatCurrency(99.99)).toBe('₪99.99');
  });

  // Hourly earnings (e.g. 4000s × ₪250) come out as ₪277.778 - money should not show 3 decimals
  it.fails('rounds amounts to at most two decimals', () => {
    expect(formatCurrency((4000 / 3600) * 250)).toMatch(/^₪[\d,]+(\.\d{1,2})?$/);
  });

  // Missing amounts (null from the DB) throw instead of rendering a placeholder
  it.fails('does not throw for null / undefined amounts', () => {
    expect(() => formatCurrency(null)).not.toThrow();
    expect(() => formatCurrency(undefined)).not.toThrow();
  });
});

describe('formatDate / formatDateTime / formatTimeOnly', () => {
  it('formats a date in Hebrew with a short month', () => {
    expect(formatDate('2026-10-08T10:05:00Z')).toBe('8 באוק׳ 2026');
  });

  it('uses the local (Israel) calendar day, not the UTC one', () => {
    // 22:30 UTC on Oct 8 is already Oct 9 in Israel (UTC+3 in October)
    expect(formatDate('2026-10-08T22:30:00Z')).toBe('9 באוק׳ 2026');
    // New year's eve in UTC is already Jan 1 locally
    expect(formatDate('2025-12-31T23:00:00Z')).toBe('1 בינו׳ 2026');
  });

  it('accepts Date objects and timestamps', () => {
    expect(formatDate(new Date(2026, 0, 15))).toBe('15 בינו׳ 2026');
    expect(formatDate(new Date(2026, 0, 15).getTime())).toBe('15 בינו׳ 2026');
  });

  it('returns "Invalid Date" for unparseable input', () => {
    expect(formatDate('not a date')).toBe('Invalid Date');
    expect(formatDateTime('')).toBe('Invalid Date');
    expect(formatTimeOnly(undefined)).toBe('Invalid Date');
  });

  // Nullable DB date columns rendered without a guard show 1 Jan 1970
  it.fails('does not render the Unix epoch for a null date', () => {
    expect(formatDate(null)).not.toContain('1970');
  });

  it('formats date + 24h time in local time', () => {
    expect(formatDateTime('2026-10-08T10:05:00Z')).toBe('8 באוק׳ 2026, 13:05');
  });

  it('formats time only, 24h, zero padded', () => {
    expect(formatTimeOnly('2026-10-08T10:05:00Z')).toBe('13:05');
    expect(formatTimeOnly('2026-10-08T21:30:00Z')).toBe('00:30');
  });

  it('follows the DST offset change (winter UTC+2)', () => {
    expect(formatTimeOnly('2026-01-15T10:00:00Z')).toBe('12:00');
    expect(formatTimeOnly('2026-07-15T10:00:00Z')).toBe('13:00');
  });
});

describe('secondsToHours', () => {
  it('converts and rounds to two decimals', () => {
    expect(secondsToHours(0)).toBe(0);
    expect(secondsToHours(3600)).toBe(1);
    expect(secondsToHours(5400)).toBe(1.5);
    expect(secondsToHours(1000)).toBe(0.28);
    expect(secondsToHours(1)).toBe(0);
  });

  it('handles negative and huge values', () => {
    expect(secondsToHours(-3600)).toBe(-1);
    expect(secondsToHours(3600 * 1_000_000)).toBe(1_000_000);
  });

  it('propagates NaN', () => {
    expect(secondsToHours(NaN)).toBeNaN();
  });
});

describe('calculateEndTime', () => {
  it('adds the duration and returns an ISO string', () => {
    expect(calculateEndTime('2026-10-08T10:00:00.000Z', 90)).toBe('2026-10-08T10:01:30.000Z');
  });

  it('crosses midnight and month boundaries', () => {
    expect(calculateEndTime('2026-10-31T23:30:00.000Z', 3600)).toBe('2026-11-01T00:30:00.000Z');
  });

  it('returns the start for a zero duration and goes backwards for negative ones', () => {
    expect(calculateEndTime('2026-10-08T10:00:00.000Z', 0)).toBe('2026-10-08T10:00:00.000Z');
    expect(calculateEndTime('2026-10-08T10:00:00.000Z', -60)).toBe('2026-10-08T09:59:00.000Z');
  });

  it('throws on an invalid start time', () => {
    expect(() => calculateEndTime('garbage', 60)).toThrow(RangeError);
  });

  it('is not affected by the local DST change (pure UTC arithmetic)', () => {
    // Israel falls back on 2026-10-25 at 02:00 local
    expect(calculateEndTime('2026-10-24T22:00:00.000Z', 2 * 3600)).toBe('2026-10-25T00:00:00.000Z');
  });
});
