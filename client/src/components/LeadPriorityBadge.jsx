import { Flame, Sun, Snowflake } from 'lucide-react';
import { getLeadPriority } from '../utils/leadStatus';

const PRIORITY_ICONS = {
  hot: Flame,
  warm: Sun,
  cold: Snowflake
};

function LeadPriorityBadge({ priority, size = 'md' }) {
  const priorityInfo = getLeadPriority(priority);
  const Icon = PRIORITY_ICONS[priority] || Sun;

  return (
    <span
      className={`lead-priority-badge lead-priority-badge--${size}`}
      style={{
        background: `${priorityInfo.color}20`,
        color: priorityInfo.color,
        border: `1px solid ${priorityInfo.color}40`
      }}
    >
      <Icon size={size === 'sm' ? 12 : 14} />
      {priorityInfo.label}
    </span>
  );
}

export default LeadPriorityBadge;
