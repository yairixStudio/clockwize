import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeadStatusBadge from './LeadStatusBadge';
import LeadPriorityBadge from './LeadPriorityBadge';
import PaymentStatusBadge, { getEffectiveRate, calculateProjectEarnings } from './PaymentStatusBadge';

describe('LeadStatusBadge', () => {
  it('shows the Hebrew label with the status colour', () => {
    render(<LeadStatusBadge status="proposal" />);

    const badge = screen.getByText('הצעת מחיר');
    expect(badge).toHaveClass('lead-status-badge', 'lead-status-badge--md');
    // #f59e0b with the "20" / "40" alpha suffixes
    expect(badge).toHaveStyle({
      color: 'rgb(245, 158, 11)',
      background: 'rgba(245, 158, 11, 0.125)',
      border: '1px solid rgba(245, 158, 11, 0.25)'
    });
  });

  it('supports the size modifier', () => {
    render(<LeadStatusBadge status="won" size="sm" />);
    expect(screen.getByText('נסגר')).toHaveClass('lead-status-badge--sm');
  });

  it('falls back to "new" for unknown statuses', () => {
    render(<LeadStatusBadge status="archived" />);
    expect(screen.getByText('חדש')).toHaveStyle({ color: 'rgb(59, 130, 246)' });
  });
});

describe('LeadPriorityBadge', () => {
  it.each([
    ['hot', 'חם', 'rgb(239, 68, 68)', 'lucide-flame'],
    ['warm', 'חמים', 'rgb(245, 158, 11)', 'lucide-sun'],
    ['cold', 'קר', 'rgb(59, 130, 246)', 'lucide-snowflake']
  ])('%s → %s with its icon and colour', (priority, label, color, iconClass) => {
    const { container } = render(<LeadPriorityBadge priority={priority} />);

    const badge = screen.getByText(label);
    expect(badge).toHaveStyle({ color });
    expect(container.querySelector(`svg.${iconClass}`)).not.toBeNull();
  });

  it('uses the smaller icon for size="sm"', () => {
    const { container } = render(<LeadPriorityBadge priority="hot" size="sm" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '12');
    expect(screen.getByText('חם')).toHaveClass('lead-priority-badge--sm');
  });

  it('falls back to "warm" (label and icon) for unknown priorities', () => {
    const { container } = render(<LeadPriorityBadge priority="urgent" />);
    expect(screen.getByText('חמים')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-sun')).not.toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('width', '14');
  });
});

describe('PaymentStatusBadge', () => {
  it('renders nothing when there is no work and no payment', () => {
    const { container } = render(<PaymentStatusBadge totalEarned={0} paidAmount={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing with the default props', () => {
    const { container } = render(<PaymentStatusBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "unpaid" with the full debt when nothing was paid', () => {
    render(<PaymentStatusBadge totalEarned={1000} paidAmount={0} />);

    const badge = screen.getByRole('button');
    expect(badge).toHaveClass('payment-status-badge', 'badge-unpaid');
    expect(badge).toHaveTextContent('₪0/₪1,000');
    expect(badge).toHaveTextContent('(חוב: ₪1,000)');
    expect(badge).toHaveAttribute('title', 'לא שולם: ₪0/₪1,000 | יתרה לתשלום: ₪1,000');
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });

  it('shows "partial" with the remaining balance', () => {
    render(<PaymentStatusBadge totalEarned={1000} paidAmount={650} />);

    const badge = screen.getByRole('button');
    expect(badge).toHaveClass('badge-partial');
    expect(badge).toHaveTextContent('₪650/₪1,000');
    expect(badge).toHaveTextContent('(חוב: ₪350)');
    expect(badge).toHaveAttribute('title', 'שולם חלקי: ₪650/₪1,000 | יתרה לתשלום: ₪350');
  });

  it('shows "paid" with a check mark when fully paid', () => {
    render(<PaymentStatusBadge totalEarned={1000} paidAmount={1000} />);

    const badge = screen.getByRole('button');
    expect(badge).toHaveClass('badge-paid');
    expect(badge).toHaveAttribute('title', 'שולם: ₪1,000/₪1,000');
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(badge).not.toHaveTextContent('חוב');
  });

  it('treats overpayment as paid without showing a negative debt', () => {
    render(<PaymentStatusBadge totalEarned={500} paidAmount={800} />);

    const badge = screen.getByRole('button');
    expect(badge).toHaveClass('badge-paid');
    expect(badge).toHaveTextContent('₪800/₪500');
    expect(badge).not.toHaveTextContent('חוב');
  });

  it('shows a payment received before any work as paid', () => {
    render(<PaymentStatusBadge totalEarned={0} paidAmount={200} />);
    expect(screen.getByRole('button')).toHaveClass('badge-paid');
  });

  it('calls onClick without letting the click bubble to a parent link/row', async () => {
    const onClick = vi.fn();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <PaymentStatusBadge totalEarned={100} paidAmount={0} onClick={onClick} />
      </div>
    );

    const badge = screen.getByRole('button');
    expect(badge).toHaveClass('clickable');
    await userEvent.click(badge);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('lets clicks through when there is no onClick handler', async () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <PaymentStatusBadge totalEarned={100} paidAmount={0} compact />
      </div>
    );

    const badge = screen.getByRole('button');
    expect(badge).toHaveClass('compact');
    expect(badge).not.toHaveClass('clickable');
    await userEvent.click(badge);
    expect(onParentClick).toHaveBeenCalledTimes(1);
  });
});

describe('getEffectiveRate', () => {
  it('cascades project → client → default', () => {
    expect(getEffectiveRate({ hourly_rate: 300 }, { hourly_rate: 200 })).toBe(300);
    expect(getEffectiveRate({ hourly_rate: null }, { hourly_rate: 200 })).toBe(200);
    expect(getEffectiveRate({}, null, 180)).toBe(180);
    expect(getEffectiveRate(null)).toBe(250);
    expect(getEffectiveRate(undefined, undefined)).toBe(250);
  });
});

describe('calculateProjectEarnings', () => {
  it('returns 0 without a project or for no-charge projects', () => {
    expect(calculateProjectEarnings(null)).toBe(0);
    expect(calculateProjectEarnings({ pricing_type: 'no_charge', hourly_rate: 500, total_time: 36000 })).toBe(0);
  });

  it('uses the fixed price for fixed projects, regardless of time', () => {
    expect(calculateProjectEarnings({ pricing_type: 'fixed', fixed_price: 5000, total_time: 999999 })).toBe(5000);
    expect(calculateProjectEarnings({ pricing_type: 'fixed', fixed_price: null })).toBe(0);
  });

  it('multiplies hours by the effective rate for hourly projects', () => {
    expect(calculateProjectEarnings({ pricing_type: 'hourly', hourly_rate: 200, total_time: 5400 })).toBe(300);
    expect(calculateProjectEarnings({ total_time: 3600 }, { hourly_rate: 150 })).toBe(150);
    expect(calculateProjectEarnings({ total_time: 7200 }, null, 100)).toBe(200);
  });

  it('prefers billable_time (excludes no-charge tasks), even when it is 0', () => {
    expect(calculateProjectEarnings({ hourly_rate: 100, total_time: 7200, billable_time: 3600 })).toBe(100);
    expect(calculateProjectEarnings({ hourly_rate: 100, total_time: 7200, billable_time: 0 })).toBe(0);
  });

  it('treats missing time as zero', () => {
    expect(calculateProjectEarnings({ hourly_rate: 100 })).toBe(0);
  });
});
