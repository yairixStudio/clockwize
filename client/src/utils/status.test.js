import { describe, it, expect } from 'vitest';
import {
  PROJECT_STATUSES,
  TASK_STATUSES,
  CLIENT_STATUSES,
  getProjectStatus,
  getTaskStatus,
  getClientStatus,
  getStatusLabel,
  getStatusBadge
} from './status';

describe('status lists', () => {
  it.each([
    ['PROJECT_STATUSES', PROJECT_STATUSES],
    ['TASK_STATUSES', TASK_STATUSES],
    ['CLIENT_STATUSES', CLIENT_STATUSES]
  ])('%s has unique values and every entry has a Hebrew label and a badge class', (_, list) => {
    const values = list.map(s => s.value);
    expect(new Set(values).size).toBe(values.length);
    list.forEach(s => {
      expect(s.label).toMatch(/[֐-׿]/);
      expect(s.badge).toMatch(/^badge-/);
    });
  });
});

describe('getProjectStatus / getTaskStatus / getClientStatus', () => {
  it('finds a known status', () => {
    expect(getProjectStatus('on_hold')).toMatchObject({ value: 'on_hold', label: 'מוקפא' });
    expect(getTaskStatus('review')).toMatchObject({ value: 'review', label: 'בבדיקה' });
    expect(getClientStatus('lead')).toMatchObject({ value: 'lead', label: 'ליד' });
  });

  it('falls back to the default for unknown / empty statuses', () => {
    expect(getProjectStatus('nope').value).toBe('active');
    expect(getProjectStatus(undefined).value).toBe('active');
    expect(getTaskStatus(null).value).toBe('pending');
    expect(getTaskStatus('').value).toBe('pending');
    // Clients default to "active", not to the first item ("lead")
    expect(getClientStatus('nope').value).toBe('active');
    expect(getClientStatus(undefined).value).toBe('active');
  });

  it('is case sensitive', () => {
    expect(getTaskStatus('COMPLETED').value).toBe('pending');
  });

  it('does not treat a project-only status as a task status', () => {
    expect(getProjectStatus('on_hold').value).toBe('on_hold');
    expect(getTaskStatus('on_hold').value).toBe('pending');
  });
});

describe('getStatusLabel', () => {
  it('defaults to task statuses and prefixes the icon', () => {
    expect(getStatusLabel('completed')).toBe('✅ הושלם');
    expect(getStatusLabel('unknown')).toBe('⏳ ממתין');
  });

  it('supports project and client types', () => {
    expect(getStatusLabel('active', 'project')).toBe('🟢 פעיל');
    expect(getStatusLabel('past', 'client')).toBe('💼 עבר');
  });

  it('omits the icon when the status has none (no leading space)', () => {
    expect(getStatusLabel('active', 'client')).toBe('פעיל');
  });

  it('keeps the legacy boolean signature (true = project, false = task)', () => {
    expect(getStatusLabel('on_hold', true)).toBe('⏸️ מוקפא');
    expect(getStatusLabel('on_hold', false)).toBe('⏳ ממתין');
  });

  it('falls back to task statuses for an unknown type', () => {
    expect(getStatusLabel('stuck', 'something-else')).toBe('🚫 תקוע');
  });
});

describe('getStatusBadge', () => {
  it('returns the badge class for each type', () => {
    expect(getStatusBadge('stuck')).toBe('badge-stuck');
    expect(getStatusBadge('cancelled', 'project')).toBe('badge-cancelled');
    expect(getStatusBadge('lead', 'client')).toBe('badge-in_progress');
    expect(getStatusBadge('inactive', 'client')).toBe('badge-cancelled');
  });

  it('supports the legacy boolean signature', () => {
    expect(getStatusBadge('on_hold', true)).toBe('badge-on_hold');
    expect(getStatusBadge('on_hold', false)).toBe('badge-pending');
  });

  it('returns the default badge for unknown statuses', () => {
    expect(getStatusBadge('x')).toBe('badge-pending');
    expect(getStatusBadge('x', 'project')).toBe('badge-active');
    expect(getStatusBadge('x', 'client')).toBe('badge-active');
  });
});
