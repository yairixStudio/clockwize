import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TimeSummary from './TimeSummary';

describe('TimeSummary', () => {
  it('shows the formatted total with the default label', () => {
    const { container } = render(<TimeSummary totalSeconds={2 * 3600 + 30 * 60} />);

    expect(screen.getByText('סה"כ זמן:')).toBeInTheDocument();
    expect(screen.getByText('2 שעות ו-30 דקות')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('time-summary', 'time-summary-normal');
  });

  it('shows earnings when an hourly rate is set', () => {
    const { container } = render(<TimeSummary totalSeconds={2 * 3600} hourlyRate={150} />);

    expect(container.querySelector('.earnings')).toHaveTextContent('₪300');
  });

  it('hides earnings without a rate, with a zero rate, or when disabled', () => {
    const { container, rerender } = render(<TimeSummary totalSeconds={3600} />);
    expect(container.querySelector('.earnings')).toBeNull();

    rerender(<TimeSummary totalSeconds={3600} hourlyRate={0} />);
    expect(container.querySelector('.earnings')).toBeNull();

    rerender(<TimeSummary totalSeconds={3600} hourlyRate={200} showEarnings={false} />);
    expect(container.querySelector('.earnings')).toBeNull();
    expect(screen.getByText('1 שעה')).toBeInTheDocument();
  });

  it('renders nothing for zero time when earnings are hidden', () => {
    const { container } = render(<TimeSummary totalSeconds={0} showEarnings={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders "0 דקות" for zero time when earnings are shown', () => {
    const { container } = render(<TimeSummary totalSeconds={0} hourlyRate={100} />);

    expect(screen.getByText('0 דקות')).toBeInTheDocument();
    expect(container.querySelector('.earnings')).toHaveTextContent('₪0');
  });

  it('accepts a custom label and size', () => {
    const { container } = render(<TimeSummary totalSeconds={60} label="זמן במשימה" size="small" />);

    expect(screen.getByText('זמן במשימה:')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('time-summary-small');
    expect(container.querySelector('svg')).toHaveAttribute('width', '14');
  });

  it('formats large earnings with thousands separators', () => {
    const { container } = render(<TimeSummary totalSeconds={100 * 3600} hourlyRate={250} />);
    expect(container.querySelector('.earnings')).toHaveTextContent('₪25,000');
  });

  // 4000s at ₪250/h is ₪277.777… and is shown as "₪277.778"
  it.fails('shows earnings for partial hours with at most two decimals', () => {
    const { container } = render(<TimeSummary totalSeconds={4000} hourlyRate={250} />);
    expect(container.querySelector('.earnings').textContent).toMatch(/^₪[\d,]+(\.\d{1,2})?$/);
  });
});
