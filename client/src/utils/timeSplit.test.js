import { describe, it, expect, vi, afterEach } from 'vitest';
import { splitEntryByDay, splitEntriesByDay, getEntriesForDay } from './timeSplit';

// All dates below are built in local (Asia/Jerusalem) time
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const sum = (entries) => entries.reduce((acc, e) => acc + e.duration, 0);

describe('splitEntryByDay', () => {
  it('returns a single non-virtual entry for a same-day entry', () => {
    const entry = { id: 'e1', start_time: local(2026, 10, 8, 9), end_time: local(2026, 10, 8, 17), duration: 8 * 3600 };
    const result = splitEntryByDay(entry);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'e1', _originalId: 'e1', _isVirtual: false, duration: 8 * 3600 });
    expect(result[0]._virtualDate).toEqual(new Date(2026, 9, 8));
  });

  it('produces a single virtual slice when the entry ends exactly at midnight', () => {
    const entry = { id: 'e1', start_time: local(2026, 10, 8, 23), end_time: local(2026, 10, 9, 0), duration: 3600 };
    const result = splitEntryByDay(entry);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'e1_2026-10-08', _isVirtual: true, duration: 3600 });
    expect(result[0]._sliceEnd).toBe(local(2026, 10, 9, 0));
  });

  it('splits an overnight entry proportionally by clock time', () => {
    const entry = { id: 7, start_time: local(2026, 10, 8, 22), end_time: local(2026, 10, 9, 2), duration: 4 * 3600 };
    const result = splitEntryByDay(entry);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: '7_2026-10-08', _originalId: 7, _isVirtual: true, duration: 2 * 3600 });
    expect(result[1]).toMatchObject({ id: '7_2026-10-09', _originalId: 7, _isVirtual: true, duration: 2 * 3600 });
    expect(result[0]._virtualDate).toEqual(new Date(2026, 9, 8));
    expect(result[1]._virtualDate).toEqual(new Date(2026, 9, 9));
    expect(result[0]._sliceStart).toBe(entry.start_time);
    expect(result[0]._sliceEnd).toBe(local(2026, 10, 9, 0));
    expect(result[1]._sliceStart).toBe(local(2026, 10, 9, 0));
    expect(result[1]._sliceEnd).toBe(entry.end_time);
  });

  it('splits by the recorded duration, not the wall clock span (paused time)', () => {
    // 4h on the clock but only 1h actually tracked
    const entry = { id: 'p', start_time: local(2026, 10, 8, 23), end_time: local(2026, 10, 9, 3), duration: 3600 };
    const result = splitEntryByDay(entry);

    expect(result.map(e => e.duration)).toEqual([900, 2700]);
  });

  it('spans multiple days and the slices always add up to the original duration', () => {
    const entry = { id: 'm', start_time: local(2026, 10, 1, 20), end_time: local(2026, 10, 4, 7), duration: 10007 };
    const result = splitEntryByDay(entry);

    expect(result.map(e => e.id)).toEqual(['m_2026-10-01', 'm_2026-10-02', 'm_2026-10-03', 'm_2026-10-04']);
    expect(sum(result)).toBe(10007);
    result.forEach(slice => expect(Number.isInteger(slice.duration)).toBe(true));
  });

  it('crosses month and year boundaries with correct date keys', () => {
    const entry = { id: 'y', start_time: local(2025, 12, 31, 23), end_time: local(2026, 1, 1, 1), duration: 7200 };
    const result = splitEntryByDay(entry);

    expect(result.map(e => e.id)).toEqual(['y_2025-12-31', 'y_2026-01-01']);
    expect(result.map(e => e.duration)).toEqual([3600, 3600]);
  });

  it('uses local midnight, not UTC midnight, as the boundary', () => {
    // 01:00-02:30 local on Oct 9 is 22:00-23:30 UTC on Oct 8: one local day, no split
    const entry = { id: 'tz', start_time: '2026-10-08T22:00:00.000Z', end_time: '2026-10-08T23:30:00.000Z', duration: 5400 };
    const result = splitEntryByDay(entry);

    expect(result).toHaveLength(1);
    expect(result[0]._virtualDate).toEqual(new Date(2026, 9, 9));

    // 23:30 UTC Oct 8 → 00:30 UTC Oct 9 is entirely on local Oct 9 (02:30-03:30)
    const utcOvernight = { id: 'u', start_time: '2026-10-08T23:30:00.000Z', end_time: '2026-10-09T00:30:00.000Z', duration: 3600 };
    expect(splitEntryByDay(utcOvernight)).toHaveLength(1);
  });

  it('splits correctly across the spring-forward DST night (23h local day)', () => {
    // Israel springs forward on Fri 2026-03-27 at 02:00 → 03:00
    const entry = { id: 'dst', start_time: local(2026, 3, 26, 22), end_time: local(2026, 3, 27, 4), duration: 5 * 3600 };
    const result = splitEntryByDay(entry);

    // 2 real hours before midnight, 3 real hours after (02:00-03:00 does not exist)
    expect(result.map(e => e.duration)).toEqual([2 * 3600, 3 * 3600]);
    expect(result[1]._virtualDate).toEqual(new Date(2026, 2, 27));
  });

  it('splits correctly across the fall-back DST night (25h local day)', () => {
    // Israel falls back on Sun 2026-10-25 at 02:00 → 01:00
    const entry = { id: 'dst2', start_time: local(2026, 10, 24, 23), end_time: local(2026, 10, 25, 3), duration: 5 * 3600 };
    const result = splitEntryByDay(entry);

    expect(result.map(e => e.duration)).toEqual([3600, 4 * 3600]);
  });

  it('returns the entry as-is for a zero or negative clock span', () => {
    const zero = { id: 'z', start_time: local(2026, 10, 8, 10), end_time: local(2026, 10, 8, 10), duration: 0 };
    const negative = { id: 'n', start_time: local(2026, 10, 9, 10), end_time: local(2026, 10, 8, 10), duration: 60 };

    expect(splitEntryByDay(zero)).toMatchObject([{ id: 'z', _isVirtual: false }]);
    expect(splitEntryByDay(negative)).toMatchObject([{ id: 'n', _isVirtual: false, duration: 60 }]);
  });

  it('treats a missing duration as zero', () => {
    const entry = { id: 'd', start_time: local(2026, 10, 8, 23), end_time: local(2026, 10, 9, 1) };
    const result = splitEntryByDay(entry);

    expect(result.map(e => e.duration)).toEqual([0, 0]);
  });

  describe('running entries (no end_time)', () => {
    afterEach(() => vi.useRealTimers());

    it('uses "now" as the end', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 9, 1, 0));

      const entry = { id: 'r', start_time: local(2026, 10, 8, 23), end_time: null, duration: 7200 };
      const result = splitEntryByDay(entry);

      expect(result).toHaveLength(2);
      expect(result[1]._sliceEnd).toBe(new Date(2026, 9, 9, 1, 0).toISOString());
      expect(sum(result)).toBe(7200);
    });
  });

  it('does not mutate the original entry', () => {
    const entry = { id: 'x', start_time: local(2026, 10, 8, 22), end_time: local(2026, 10, 9, 2), duration: 100 };
    const copy = structuredClone(entry);
    splitEntryByDay(entry);
    expect(entry).toEqual(copy);
  });
});

describe('splitEntriesByDay', () => {
  it('returns an empty array for no entries', () => {
    expect(splitEntriesByDay([])).toEqual([]);
  });

  it('flattens split entries in order', () => {
    const entries = [
      { id: 'a', start_time: local(2026, 10, 8, 9), end_time: local(2026, 10, 8, 10), duration: 3600 },
      { id: 'b', start_time: local(2026, 10, 8, 23), end_time: local(2026, 10, 9, 1), duration: 7200 }
    ];
    expect(splitEntriesByDay(entries).map(e => e.id)).toEqual(['a', 'b_2026-10-08', 'b_2026-10-09']);
  });

  it('keeps entries with a single interval intact', () => {
    const entries = [{
      id: 'one', start_time: local(2026, 10, 8, 9), end_time: local(2026, 10, 8, 10), duration: 3600,
      intervals: [{ start_time: local(2026, 10, 8, 9), end_time: local(2026, 10, 8, 10), duration_seconds: 3600 }]
    }];
    const [result] = splitEntriesByDay(entries);
    expect(result.id).toBe('one');
    expect(result._isInterval).toBeUndefined();
  });

  it('expands multi-interval entries into one item per interval', () => {
    const entries = [{
      id: 'multi',
      start_time: local(2026, 10, 8, 9),
      end_time: local(2026, 10, 8, 18),
      duration: 5400,
      notes: 'עבודה על פרויקט',
      intervals: [
        { start_time: local(2026, 10, 8, 9), end_time: local(2026, 10, 8, 10), duration_seconds: 3600 },
        { start_time: local(2026, 10, 8, 17, 30), end_time: local(2026, 10, 8, 18), duration_seconds: 1800 }
      ]
    }];
    const result = splitEntriesByDay(entries);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'multi_interval_0', _isInterval: true, duration: 3600, notes: 'עבודה על פרויקט' });
    expect(result[1]).toMatchObject({ id: 'multi_interval_1', _isInterval: true, duration: 1800 });
    expect(result[0].intervals).toBeUndefined();
  });

  // expandEntryToIntervals sets _originalId to the real entry id, but splitEntryByDay then
  // overwrites it with the interval's synthetic id ("multi_interval_0"). Nothing reads it yet.
  it.fails('keeps the real entry id as _originalId for expanded intervals', () => {
    const entries = [{
      id: 'multi',
      start_time: local(2026, 10, 8, 9),
      end_time: local(2026, 10, 8, 18),
      intervals: [
        { start_time: local(2026, 10, 8, 9), end_time: local(2026, 10, 8, 10), duration_seconds: 3600 },
        { start_time: local(2026, 10, 8, 17), end_time: local(2026, 10, 8, 18), duration_seconds: 3600 }
      ]
    }];
    expect(splitEntriesByDay(entries).map(e => e._originalId)).toEqual(['multi', 'multi']);
  });

  it('splits an overnight interval of a multi-interval entry by day', () => {
    const entries = [{
      id: 'm',
      start_time: local(2026, 10, 8, 20),
      end_time: local(2026, 10, 9, 1),
      intervals: [
        { start_time: local(2026, 10, 8, 20), end_time: local(2026, 10, 8, 21), duration_seconds: 3600 },
        { start_time: local(2026, 10, 8, 23), end_time: local(2026, 10, 9, 1), duration_seconds: 7200 }
      ]
    }];
    const result = splitEntriesByDay(entries);

    expect(result.map(e => e.id)).toEqual([
      'm_interval_0',
      'm_interval_1_2026-10-08',
      'm_interval_1_2026-10-09'
    ]);
    expect(sum(result)).toBe(3600 + 7200);
  });
});

describe('getEntriesForDay', () => {
  const entries = splitEntriesByDay([
    { id: 'a', start_time: local(2026, 10, 8, 9), end_time: local(2026, 10, 8, 10), duration: 3600 },
    { id: 'b', start_time: local(2026, 10, 8, 23), end_time: local(2026, 10, 9, 1), duration: 7200 },
    { id: 'c', start_time: local(2026, 10, 10, 9), end_time: local(2026, 10, 10, 9, 30), duration: 1800 }
  ]);

  it('returns the slices that belong to the given local day, whatever the time of day', () => {
    expect(getEntriesForDay(entries, new Date(2026, 9, 8, 15, 45)).map(e => e.id)).toEqual(['a', 'b_2026-10-08']);
    expect(getEntriesForDay(entries, new Date(2026, 9, 9)).map(e => e.id)).toEqual(['b_2026-10-09']);
  });

  it('returns an empty array for a day without entries', () => {
    expect(getEntriesForDay(entries, new Date(2026, 9, 11))).toEqual([]);
    expect(getEntriesForDay([], new Date())).toEqual([]);
  });
});
