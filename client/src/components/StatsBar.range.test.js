import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildLocalDayRange, buildLocalMonthRange, buildDashboardStatsParams } from './StatsBar';
import { statsAPI } from '../services/api';

// vitest.config.js pins TZ to Asia/Jerusalem (UTC+2 in winter, UTC+3 in summer)
describe('buildLocalDayRange', () => {
  it('covers whole local calendar days, from 00:00:00.000 to 23:59:59.999', () => {
    const { start, end } = buildLocalDayRange('2026-10-01', '2026-10-08');
    expect(start).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 9, 8, 23, 59, 59, 999));
  });

  it('a single day in Israel summer time is 21:00 UTC of the day before to 20:59:59.999 UTC', () => {
    const { start, end } = buildLocalDayRange('2026-10-08', '2026-10-08');
    expect(start.toISOString()).toBe('2026-10-07T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-08T20:59:59.999Z');
    // 01:00 on the 8th in Israel (22:00 UTC on the 7th) falls inside the 8th
    const oneAm = new Date('2026-10-07T22:00:00.000Z');
    expect(oneAm >= start && oneAm <= end).toBe(true);
  });

  it('follows the local offset in winter and across the DST switch', () => {
    const winter = buildLocalDayRange('2026-01-15', '2026-01-15');
    expect(winter.start.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(winter.end.toISOString()).toBe('2026-01-15T21:59:59.999Z');

    // Israel moves to summer time on Friday 27 March 2026 - a 23-hour day
    const dstDay = buildLocalDayRange('2026-03-27', '2026-03-27');
    expect(dstDay.start.toISOString()).toBe('2026-03-26T22:00:00.000Z');
    expect(dstDay.end.toISOString()).toBe('2026-03-27T20:59:59.999Z');
  });

  it('handles month and year ends without rolling over', () => {
    const { start, end } = buildLocalDayRange('2025-12-31', '2026-02-28');
    expect(start).toEqual(new Date(2025, 11, 31));
    expect(end).toEqual(new Date(2026, 1, 28, 23, 59, 59, 999));
  });

  it('an end before the start stays detectable (start > end)', () => {
    const { start, end } = buildLocalDayRange('2026-10-05', '2026-10-01');
    expect(start > end).toBe(true);
  });
});

describe('buildLocalMonthRange', () => {
  it('covers the local month, from the 1st at 00:00 to the last day at 23:59:59.999', () => {
    const { start, end } = buildLocalMonthRange(new Date(2026, 9, 8, 12, 0));
    expect(start).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 9, 31, 23, 59, 59, 999));
    // October in Israel starts at +03:00 and ends at +02:00 (summer time ends on Oct 25)
    expect(start.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-31T21:59:59.999Z');
  });

  it('01:00 on the 1st in Israel belongs to that month, not the previous one', () => {
    const oneAm = new Date('2026-10-31T23:00:00.000Z'); // Nov 1, 01:00 (+02:00)
    const nov = buildLocalMonthRange(new Date(2026, 10, 15));
    const oct = buildLocalMonthRange(new Date(2026, 9, 15));
    expect(oneAm >= nov.start && oneAm <= nov.end).toBe(true);
    expect(oneAm >= oct.start && oneAm <= oct.end).toBe(false);
  });

  it('uses the right last day (leap February, December)', () => {
    expect(buildLocalMonthRange(new Date(2028, 1, 10)).end).toEqual(new Date(2028, 1, 29, 23, 59, 59, 999));
    expect(buildLocalMonthRange(new Date(2026, 1, 10)).end).toEqual(new Date(2026, 1, 28, 23, 59, 59, 999));
    const dec = buildLocalMonthRange(new Date(2026, 11, 31, 23, 0));
    expect(dec.start).toEqual(new Date(2026, 11, 1));
    expect(dec.end).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999));
  });
});

describe('buildDashboardStatsParams', () => {
  it('month view: month/year plus the local month as instants', () => {
    expect(buildDashboardStatsParams({ selectedMonth: new Date(2026, 10, 20, 9, 0) })).toEqual({
      month: 10,
      year: 2026,
      startDate: '2026-10-31T22:00:00.000Z',
      endDate: '2026-11-30T21:59:59.999Z'
    });
  });

  it('a custom range wins over the selected month and is sent as instants only', () => {
    const dateRange = buildLocalDayRange('2026-10-08', '2026-10-08');
    expect(buildDashboardStatsParams({ dateRange, selectedMonth: new Date(2026, 9, 1) })).toEqual({
      startDate: '2026-10-07T21:00:00.000Z',
      endDate: '2026-10-08T20:59:59.999Z'
    });
  });

  it('sends nothing without a range or a month (server default)', () => {
    expect(buildDashboardStatsParams({})).toEqual({});
    expect(buildDashboardStatsParams()).toEqual({});
  });
});

describe('dashboard stats request for a local range', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('{}') }));
  });

  it('sends the range as exact UTC instants, URL-encoded', async () => {
    const range = buildLocalDayRange('2026-10-08', '2026-10-08');
    // The same conversion the Dashboard does with the range it gets from StatsBar
    await statsAPI.getDashboard({ startDate: range.start.toISOString(), endDate: range.end.toISOString() });

    const url = new URL(fetch.mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/api/stats/dashboard');
    expect(url.searchParams.get('startDate')).toBe('2026-10-07T21:00:00.000Z');
    expect(url.searchParams.get('endDate')).toBe('2026-10-08T20:59:59.999Z');
  });

  it('sends the month view with month/year and the local month instants', async () => {
    await statsAPI.getDashboard(buildDashboardStatsParams({ selectedMonth: new Date(2026, 10, 1) }));

    const url = new URL(fetch.mock.calls[0][0], 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      month: '10',
      year: '2026',
      startDate: '2026-10-31T22:00:00.000Z',
      endDate: '2026-11-30T21:59:59.999Z'
    });
  });
});
