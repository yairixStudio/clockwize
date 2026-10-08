import { describe, it, expect } from 'vitest';
import {
  LEAD_STATUSES,
  LEAD_PRIORITIES,
  LEAD_SOURCE_TYPES,
  LEAD_ACTIVITY_TYPES,
  PIPELINE_STAGES,
  getLeadStatus,
  getLeadPriority,
  getSourceType,
  getActivityType
} from './leadStatus';

describe('lead constants', () => {
  it('orders lead statuses by their "order" field', () => {
    expect(LEAD_STATUSES.map(s => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('uses 6-digit hex colours (badges append an alpha suffix)', () => {
    [...LEAD_STATUSES, ...LEAD_PRIORITIES].forEach(s => {
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('pipeline stages exclude the closed statuses (won / lost)', () => {
    expect(PIPELINE_STAGES.map(s => s.value)).toEqual(['new', 'contacted', 'qualified', 'proposal', 'negotiation']);
  });

  it.each([
    ['LEAD_STATUSES', LEAD_STATUSES],
    ['LEAD_PRIORITIES', LEAD_PRIORITIES],
    ['LEAD_SOURCE_TYPES', LEAD_SOURCE_TYPES],
    ['LEAD_ACTIVITY_TYPES', LEAD_ACTIVITY_TYPES]
  ])('%s has unique values and Hebrew labels', (_, list) => {
    const values = list.map(s => s.value);
    expect(new Set(values).size).toBe(values.length);
    list.forEach(s => expect(s.label).toMatch(/[֐-׿]/));
  });
});

describe('lookups', () => {
  it('getLeadStatus finds a status or falls back to "new"', () => {
    expect(getLeadStatus('won')).toMatchObject({ value: 'won', label: 'נסגר' });
    expect(getLeadStatus('bogus').value).toBe('new');
    expect(getLeadStatus(undefined).value).toBe('new');
  });

  it('getLeadPriority finds a priority or falls back to "warm"', () => {
    expect(getLeadPriority('hot')).toMatchObject({ value: 'hot', label: 'חם' });
    expect(getLeadPriority('cold').label).toBe('קר');
    expect(getLeadPriority(null).value).toBe('warm');
  });

  it('getSourceType finds a source or falls back to "other"', () => {
    expect(getSourceType('referral').label).toBe('הפניה');
    expect(getSourceType('tiktok').value).toBe('other');
    expect(getSourceType().label).toBe('אחר');
  });

  it('getActivityType finds a type or falls back to "note"', () => {
    expect(getActivityType('call')).toMatchObject({ value: 'call', icon: 'Phone' });
    expect(getActivityType('fax').value).toBe('note');
  });
});
