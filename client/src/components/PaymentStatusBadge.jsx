import { CreditCard } from 'lucide-react';
import { formatCurrency } from '../utils/format';
import './PaymentStatusBadge.css';

/**
 * Payment status badge component
 * Shows payment status with fraction display: "₪650/₪1,000"
 * 
 * @param {number} totalEarned - Total amount to be paid (calculated from hours*rate or fixed price)
 * @param {number} paidAmount - Amount already paid
 * @param {function} onClick - Click handler (optional)
 * @param {boolean} compact - Show compact version (icon only on mobile)
 */
function PaymentStatusBadge({ totalEarned = 0, paidAmount = 0, onClick, compact = false }) {
  // Don't show badge if no work done yet and no payment
  if (totalEarned === 0 && paidAmount === 0) {
    return null;
  }

  const balance = totalEarned - paidAmount;
  
  // Determine status
  let status, label, colorClass;
  
  if (balance <= 0) {
    status = 'paid';
    label = 'שולם';
    colorClass = 'badge-paid';
  } else if (paidAmount > 0) {
    status = 'partial';
    label = 'שולם חלקי';
    colorClass = 'badge-partial';
  } else {
    status = 'unpaid';
    label = 'לא שולם';
    colorClass = 'badge-unpaid';
  }

  // Format display
  const paidFormatted = formatCurrency(paidAmount);
  const totalFormatted = formatCurrency(totalEarned);
  const balanceFormatted = formatCurrency(balance);
  const fractionDisplay = `${paidFormatted}/${totalFormatted}`;
  
  // Build tooltip with balance info
  const tooltipText = balance > 0 
    ? `${label}: ${fractionDisplay} | יתרה לתשלום: ${balanceFormatted}`
    : `${label}: ${fractionDisplay}`;

  const handleClick = (e) => {
    if (onClick) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }
  };

  return (
    <button
      className={`payment-status-badge ${colorClass} ${compact ? 'compact' : ''} ${onClick ? 'clickable' : ''}`}
      onClick={handleClick}
      title={tooltipText}
      type="button"
    >
      <CreditCard size={14} className="badge-icon" />
      <span className="badge-fraction">{fractionDisplay}</span>
      {balance > 0 && <span className="badge-balance">(חוב: {balanceFormatted})</span>}
      {status === 'paid' && <span className="badge-check">✓</span>}
    </button>
  );
}

/**
 * Calculate effective hourly rate with cascade logic
 * @param {object} project - Project object
 * @param {object} client - Client object (optional)
 * @param {number} defaultRate - User's default rate (optional, defaults to 250)
 */
export function getEffectiveRate(project, client = null, defaultRate = 250) {
  return project?.hourly_rate || client?.hourly_rate || defaultRate;
}

/**
 * Calculate total earnings for a project
 * @param {object} project - Project with pricing_type, fixed_price, hourly_rate, total_time
 * @param {object} client - Client object (optional)
 * @param {number} defaultRate - User's default rate
 */
export function calculateProjectEarnings(project, client = null, defaultRate = 250) {
  if (!project) return 0;
  
  // No charge projects have no earnings
  if (project.pricing_type === 'no_charge') {
    return 0;
  }
  
  if (project.pricing_type === 'fixed') {
    return project.fixed_price || 0;
  }
  
  // Hourly pricing - use billable_time (excludes no_charge tasks) if available
  const rate = getEffectiveRate(project, client, defaultRate);
  const hours = (project.billable_time != null ? project.billable_time : (project.total_time || 0)) / 3600;
  return hours * rate;
}

export default PaymentStatusBadge;
