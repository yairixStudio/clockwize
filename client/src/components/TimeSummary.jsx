import React from 'react';
import { Clock, DollarSign } from 'lucide-react';
import { formatDurationHuman, formatCurrency } from '../utils/format';
import './TimeSummary.css';

/**
 * Displays a compact time summary for entity pages (client, project, task)
 * Shows total time and optionally earnings
 */
const TimeSummary = ({
  totalSeconds,
  hourlyRate,
  showEarnings = true,
  label = 'סה"כ זמן',
  size = 'normal' // 'small', 'normal', 'large'
}) => {
  const totalHours = totalSeconds / 3600;
  const earnings = hourlyRate ? totalHours * hourlyRate : 0;

  if (totalSeconds === 0 && !showEarnings) {
    return null;
  }

  return (
    <div className={`time-summary time-summary-${size}`}>
      <div className="time-summary-item">
        <Clock size={size === 'small' ? 14 : 16} />
        <span className="time-summary-label">{label}:</span>
        <span className="time-summary-value">{formatDurationHuman(totalSeconds)}</span>
      </div>
      {showEarnings && hourlyRate > 0 && (
        <div className="time-summary-item earnings">
          <DollarSign size={size === 'small' ? 14 : 16} />
          <span className="time-summary-value">{formatCurrency(earnings)}</span>
        </div>
      )}
    </div>
  );
};

export default TimeSummary;
