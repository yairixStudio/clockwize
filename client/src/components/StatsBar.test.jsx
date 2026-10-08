import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import StatsBar from './StatsBar';

const stats = [
  { icon: '⏱', value: '12:30', label: 'שעות החודש', path: '/time-entries' },
  { icon: '₪', value: '₪4,500', label: 'הכנסות' }
];

const renderBar = (props = {}) => {
  const onMonthChange = vi.fn();
  const onDateRangeChange = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <StatsBar
              stats={stats}
              onMonthChange={onMonthChange}
              onDateRangeChange={onDateRangeChange}
              {...props}
            />
          }
        />
        <Route path="/time-entries" element={<p>עמוד רישומי זמן</p>} />
      </Routes>
    </MemoryRouter>
  );
  return { ...utils, onMonthChange, onDateRangeChange };
};

const prevButton = () => screen.getByTitle('חודש קודם');
const nextButton = () => screen.getByTitle('חודש הבא');
const currentButton = () => screen.getByTitle('בחר טווח תאריכים');
const startInput = () => screen.getByText('תאריך התחלה').parentElement.querySelector('input');
const endInput = () => screen.getByText('תאריך סיום').parentElement.querySelector('input');
const presetButton = (name) => within(document.querySelector('.date-range-presets')).getByRole('button', { name });

// Local calendar date of a Date, as an <input type="date"> value
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 8, 12, 0)); // Thu 8 Oct 2026, 12:00 Israel time
});

describe('StatsBar - stats', () => {
  it('renders each stat value and label', () => {
    renderBar();

    expect(screen.getByText('12:30')).toBeInTheDocument();
    expect(screen.getByText('שעות החודש')).toBeInTheDocument();
    expect(screen.getByText('₪4,500')).toBeInTheDocument();
    expect(screen.getByText('הכנסות')).toBeInTheDocument();
  });

  it('makes only stats with a path clickable, and navigates on click', async () => {
    renderBar();

    const clickable = screen.getByText('שעות החודש').closest('.stat-item');
    const plain = screen.getByText('הכנסות').closest('.stat-item');
    expect(clickable).toHaveClass('clickable');
    expect(clickable).toHaveAttribute('role', 'button');
    expect(clickable).toHaveAttribute('tabindex', '0');
    expect(plain).not.toHaveClass('clickable');
    expect(plain).not.toHaveAttribute('role');

    await userEvent.click(plain);
    expect(screen.getByText('הכנסות')).toBeInTheDocument();

    await userEvent.click(clickable);
    expect(screen.getByText('עמוד רישומי זמן')).toBeInTheDocument();
  });

  it('renders an empty stats list', () => {
    const { container } = renderBar({ stats: [] });
    expect(container.querySelector('.stats-bar')).toBeEmptyDOMElement();
  });

  it('hides the date picker without a selected month or a change handler', () => {
    renderBar({ onMonthChange: undefined, selectedMonth: new Date() });
    expect(screen.queryByTitle('חודש קודם')).not.toBeInTheDocument();
  });
});

describe('StatsBar - month navigation', () => {
  it('shows the Hebrew month name and disables "next" on the current month', () => {
    renderBar({ selectedMonth: new Date() });

    expect(currentButton()).toHaveTextContent('אוקטובר 2026');
    expect(currentButton()).toHaveClass('is-current');
    expect(nextButton()).toBeDisabled();
    expect(prevButton()).toBeEnabled();
  });

  it('goes to the previous month, across the year boundary', async () => {
    const { onMonthChange } = renderBar({ selectedMonth: new Date(2026, 0, 15) });

    expect(currentButton()).toHaveTextContent('ינואר 2026');
    await userEvent.click(prevButton());

    const target = onMonthChange.mock.calls[0][0];
    expect([target.getFullYear(), target.getMonth()]).toEqual([2025, 11]);
  });

  it('goes to the next month from a past month', async () => {
    const { onMonthChange } = renderBar({ selectedMonth: new Date(2026, 8, 10) });

    expect(nextButton()).toBeEnabled();
    expect(currentButton()).not.toHaveClass('is-current');
    await userEvent.click(nextButton());

    const target = onMonthChange.mock.calls[0][0];
    expect([target.getFullYear(), target.getMonth()]).toEqual([2026, 9]);
  });

  it('does not mutate the selected month', async () => {
    const selected = new Date(2026, 8, 10);
    renderBar({ selectedMonth: selected });

    await userEvent.click(prevButton());

    expect(selected).toEqual(new Date(2026, 8, 10));
  });

  // selectedMonth starts as `new Date()`, so its day can be 29-31
  it('"previous" from the 31st lands in the previous month, not back in the same one', async () => {
    vi.setSystemTime(new Date(2026, 2, 31, 12, 0)); // 31 March
    const { onMonthChange } = renderBar({ selectedMonth: new Date() });

    await userEvent.click(prevButton());

    const target = onMonthChange.mock.calls[0][0];
    expect([target.getFullYear(), target.getMonth()]).toEqual([2026, 1]); // February
  });

  it('"next" from the 31st does not skip a short month', async () => {
    vi.setSystemTime(new Date(2026, 3, 20, 12, 0)); // 20 April
    const { onMonthChange } = renderBar({ selectedMonth: new Date(2026, 0, 31) });

    await userEvent.click(nextButton());

    const target = onMonthChange.mock.calls[0][0];
    expect([target.getFullYear(), target.getMonth()]).toEqual([2026, 1]); // February, not March
  });

  it('disables the arrows and shows the range while a custom range is active', async () => {
    const dateRange = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 15, 23, 59, 59, 999) };
    const { onMonthChange } = renderBar({ selectedMonth: new Date(), dateRange });

    expect(currentButton()).toHaveClass('has-range');
    expect(currentButton()).not.toHaveClass('is-current');
    expect(currentButton()).toHaveTextContent('1 בספט׳ - 15 בספט׳');
    expect(prevButton()).toBeDisabled();
    expect(nextButton()).toBeDisabled();

    fireEvent.click(prevButton());
    expect(onMonthChange).not.toHaveBeenCalled();
  });
});

describe('StatsBar - date range modal', () => {
  it('pre-fills the first and last day of the selected month (local calendar days)', async () => {
    renderBar({ selectedMonth: new Date(2026, 9, 8) });

    await userEvent.click(currentButton());

    expect(screen.getByRole('heading', { name: 'בחירת טווח תאריכים' })).toBeInTheDocument();
    expect(startInput()).toHaveValue('2026-10-01');
    expect(endInput()).toHaveValue('2026-10-31');
  });

  it('pre-fills the active custom range', async () => {
    const dateRange = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 15, 23, 59, 59, 999) };
    renderBar({ selectedMonth: new Date(), dateRange });

    await userEvent.click(currentButton());

    expect(startInput()).toHaveValue('2026-09-01');
    expect(endInput()).toHaveValue('2026-09-15');
  });

  it('limits the inputs to today (local date) and the end to the start', async () => {
    vi.setSystemTime(new Date(2026, 9, 8, 1, 30)); // 01:30 local = still Oct 7 in UTC
    renderBar({ selectedMonth: new Date() });

    await userEvent.click(currentButton());

    expect(startInput()).toHaveAttribute('max', '2026-10-08');
    expect(endInput()).toHaveAttribute('max', '2026-10-08');
    expect(endInput()).toHaveAttribute('min', startInput().value);
  });

  it('applies the chosen calendar days and closes', async () => {
    const { onDateRangeChange } = renderBar({ selectedMonth: new Date() });
    await userEvent.click(currentButton());

    fireEvent.change(startInput(), { target: { value: '2026-09-01' } });
    fireEvent.change(endInput(), { target: { value: '2026-09-15' } });
    await userEvent.click(screen.getByRole('button', { name: 'החל טווח' }));

    expect(onDateRangeChange).toHaveBeenCalledTimes(1);
    const { start, end } = onDateRangeChange.mock.calls[0][0];
    expect(ymd(start)).toBe('2026-09-01');
    expect(ymd(end)).toBe('2026-09-15');
    expect(end).toEqual(new Date(2026, 8, 15, 23, 59, 59, 999));
    expect(screen.queryByRole('heading', { name: 'בחירת טווח תאריכים' })).not.toBeInTheDocument();
  });

  // Ranges are the user's local calendar days; the Dashboard sends them as exact instants
  it('starts the applied range at local midnight of the chosen day', async () => {
    const { onDateRangeChange } = renderBar({ selectedMonth: new Date() });
    await userEvent.click(currentButton());

    fireEvent.change(startInput(), { target: { value: '2026-09-01' } });
    fireEvent.change(endInput(), { target: { value: '2026-09-15' } });
    await userEvent.click(screen.getByRole('button', { name: 'החל טווח' }));

    const { start, end } = onDateRangeChange.mock.calls[0][0];
    expect(start).toEqual(new Date(2026, 8, 1, 0, 0, 0, 0));
    // Israel is UTC+3 in September: local midnight is 21:00 UTC of the previous day
    expect(start.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-15T20:59:59.999Z');
  });

  it('accepts a single-day range', async () => {
    const { onDateRangeChange } = renderBar({ selectedMonth: new Date() });
    await userEvent.click(currentButton());

    fireEvent.change(startInput(), { target: { value: '2026-10-05' } });
    fireEvent.change(endInput(), { target: { value: '2026-10-05' } });
    await userEvent.click(screen.getByRole('button', { name: 'החל טווח' }));

    const { start, end } = onDateRangeChange.mock.calls[0][0];
    expect(ymd(start)).toBe('2026-10-05');
    expect(ymd(end)).toBe('2026-10-05');
  });

  it('ignores a range whose end is before its start', async () => {
    const { onDateRangeChange } = renderBar({ selectedMonth: new Date() });
    await userEvent.click(currentButton());

    fireEvent.change(startInput(), { target: { value: '2026-10-05' } });
    fireEvent.change(endInput(), { target: { value: '2026-10-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'החל טווח' }));

    expect(onDateRangeChange).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'בחירת טווח תאריכים' })).toBeInTheDocument();
  });

  it('disables "apply" while a date is missing', async () => {
    renderBar({ selectedMonth: new Date() });
    await userEvent.click(currentButton());

    fireEvent.change(startInput(), { target: { value: '' } });

    expect(screen.getByRole('button', { name: 'החל טווח' })).toBeDisabled();
  });

  it('"back to monthly" clears the range, returns to the current month and closes', async () => {
    const dateRange = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 15) };
    const { onDateRangeChange, onMonthChange } = renderBar({ selectedMonth: new Date(2026, 5, 1), dateRange });
    await userEvent.click(currentButton());

    await userEvent.click(screen.getByRole('button', { name: 'חזור לחודשי' }));

    expect(onDateRangeChange).toHaveBeenCalledWith(null);
    expect(onMonthChange).toHaveBeenCalledWith(new Date(2026, 9, 8, 12, 0));
    expect(screen.queryByRole('heading', { name: 'בחירת טווח תאריכים' })).not.toBeInTheDocument();
  });

  it('closes from the overlay and the X button, but not from clicks inside', async () => {
    renderBar({ selectedMonth: new Date() });
    const heading = () => screen.queryByRole('heading', { name: 'בחירת טווח תאריכים' });

    await userEvent.click(currentButton());
    await userEvent.click(heading());
    expect(heading()).toBeInTheDocument();

    await userEvent.click(document.querySelector('.modal-overlay'));
    expect(heading()).not.toBeInTheDocument();

    await userEvent.click(currentButton());
    await userEvent.click(document.querySelector('.modal-header button'));
    expect(heading()).not.toBeInTheDocument();
  });

  it.each([
    ['החודש', '2026-10-01', '2026-10-08'],
    ['חודש קודם', '2026-09-01', '2026-09-30'],
    ['שבוע אחרון', '2026-10-01', '2026-10-08'],
    ['השנה', '2026-01-01', '2026-10-08']
  ])('preset "%s" fills %s → %s', async (preset, from, to) => {
    renderBar({ selectedMonth: new Date() });
    await userEvent.click(currentButton());

    await userEvent.click(presetButton(preset));

    expect(startInput()).toHaveValue(from);
    expect(endInput()).toHaveValue(to);
  });

  it('preset "previous month" handles January (goes to December of last year)', async () => {
    vi.setSystemTime(new Date(2026, 0, 10, 12, 0));
    renderBar({ selectedMonth: new Date() });
    await userEvent.click(currentButton());

    await userEvent.click(presetButton('חודש קודם'));

    expect(startInput()).toHaveValue('2025-12-01');
    expect(endInput()).toHaveValue('2025-12-31');
  });
});
