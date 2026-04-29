// Utility for splitting time entries across day boundaries

function startOfDayLocal(d) {
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfNextDayLocal(d) {
  const result = new Date(d);
  result.setDate(result.getDate() + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function isSameDayLocal(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function formatLocalDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Split a single time entry into virtual entries, one per calendar day.
 * Duration is divided proportionally based on clock span per day.
 */
export function splitEntryByDay(entry) {
  const start = new Date(entry.start_time);
  const end = entry.end_time ? new Date(entry.end_time) : new Date();
  const totalDuration = entry.duration || 0;
  const clockSpanMs = end.getTime() - start.getTime();

  // Same day or zero/negative span - return as-is
  if (clockSpanMs <= 0 || isSameDayLocal(start, end)) {
    return [{
      ...entry,
      _originalId: entry.id,
      _virtualDate: startOfDayLocal(start),
      _isVirtual: false
    }];
  }

  const slices = [];
  let cursor = new Date(start);
  let allocatedDuration = 0;

  while (cursor < end) {
    const dayStart = cursor.getTime() < start.getTime() ? start : new Date(cursor);
    const nextMidnight = startOfNextDayLocal(cursor);
    const dayEnd = nextMidnight.getTime() > end.getTime() ? end : nextMidnight;

    const dayClockSpanMs = dayEnd.getTime() - dayStart.getTime();
    const proportion = dayClockSpanMs / clockSpanMs;
    const sliceDuration = Math.round(totalDuration * proportion);

    slices.push({
      ...entry,
      _originalId: entry.id,
      id: `${entry.id}_${formatLocalDateKey(cursor)}`,
      _virtualDate: startOfDayLocal(cursor),
      _isVirtual: true,
      duration: sliceDuration,
      _sliceStart: dayStart.toISOString(),
      _sliceEnd: dayEnd.toISOString()
    });

    allocatedDuration += sliceDuration;
    cursor = nextMidnight;
  }

  // Fix rounding: adjust last slice so total matches exactly
  if (slices.length > 0 && allocatedDuration !== totalDuration) {
    slices[slices.length - 1].duration += (totalDuration - allocatedDuration);
  }

  return slices;
}

/**
 * Expand an entry into its individual intervals (if it has multiple).
 * Each interval becomes a separate virtual entry that can then be split by day.
 */
function expandEntryToIntervals(entry) {
  if (!entry.intervals || entry.intervals.length <= 1) {
    return [entry];
  }

  return entry.intervals.map((interval, idx) => ({
    ...entry,
    id: `${entry.id}_interval_${idx}`,
    _originalId: entry.id,
    _isInterval: true,
    start_time: interval.start_time,
    end_time: interval.end_time,
    duration: interval.duration_seconds || 0,
    intervals: undefined
  }));
}

/**
 * Split an array of entries by day boundaries.
 * First expands entries with multiple intervals into separate visual items.
 */
export function splitEntriesByDay(entries) {
  return entries.flatMap(entry => {
    const expanded = expandEntryToIntervals(entry);
    return expanded.flatMap(splitEntryByDay);
  });
}

/**
 * Filter pre-split virtual entries to those matching a specific date.
 */
export function getEntriesForDay(virtualEntries, date) {
  const target = startOfDayLocal(date).getTime();
  return virtualEntries.filter(e => e._virtualDate.getTime() === target);
}
