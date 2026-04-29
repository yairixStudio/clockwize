import { AlertTriangle } from 'lucide-react';

function AlertBadge({ count, onClick }) {
  if (!count || count === 0) return null;

  return (
    <button
      className="alert-badge-btn"
      onClick={onClick}
      title={`${count} התראות פעילות`}
    >
      <AlertTriangle size={14} />
      <span>{count}</span>
    </button>
  );
}

export default AlertBadge;
