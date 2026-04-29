import { getLeadStatus } from '../utils/leadStatus';

function LeadStatusBadge({ status, size = 'md' }) {
  const statusInfo = getLeadStatus(status);

  return (
    <span
      className={`lead-status-badge lead-status-badge--${size}`}
      style={{
        background: `${statusInfo.color}20`,
        color: statusInfo.color,
        border: `1px solid ${statusInfo.color}40`
      }}
    >
      {statusInfo.label}
    </span>
  );
}

export default LeadStatusBadge;
