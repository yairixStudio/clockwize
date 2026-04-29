import { useState } from 'react';
import { FileText, Phone, Users, Mail, RefreshCw, UserCheck, Settings, Send, Trash2 } from 'lucide-react';
import { LEAD_ACTIVITY_TYPES, getActivityType } from '../utils/leadStatus';
import './LeadActivityTimeline.css';

const ACTIVITY_ICONS = {
  note: FileText,
  call: Phone,
  meeting: Users,
  email: Mail,
  status_change: RefreshCw,
  assignment: UserCheck,
  system: Settings
};

function LeadActivityTimeline({ activities, onAddActivity, onDeleteActivity }) {
  const [newType, setNewType] = useState('note');
  const [newContent, setNewContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    setSubmitting(true);
    try {
      await onAddActivity({ activity_type: newType, content: newContent.trim() });
      setNewContent('');
      setNewType('note');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'עכשיו';
    if (diffMin < 60) return `לפני ${diffMin} דקות`;
    if (diffHours < 24) return `לפני ${diffHours} שעות`;
    if (diffDays < 7) return `לפני ${diffDays} ימים`;
    return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const userActivityTypes = LEAD_ACTIVITY_TYPES.filter(
    t => !['status_change', 'assignment', 'system'].includes(t.value)
  );

  return (
    <div className="lead-activity-timeline">
      <form className="lead-activity-form" onSubmit={handleSubmit}>
        <div className="lead-activity-form-row">
          <select
            className="form-input form-input-sm"
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
          >
            {userActivityTypes.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <input
            type="text"
            className="form-input"
            placeholder="הוסף הערה, שיחה, פגישה..."
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={submitting || !newContent.trim()}>
            <Send size={14} />
          </button>
        </div>
      </form>

      <div className="lead-activity-list">
        {activities.map(activity => {
          const typeInfo = getActivityType(activity.activity_type);
          const Icon = ACTIVITY_ICONS[activity.activity_type] || FileText;
          const isSystem = ['status_change', 'assignment', 'system'].includes(activity.activity_type);

          return (
            <div key={activity.id} className={`lead-activity-item ${isSystem ? 'system' : ''}`}>
              <div className="lead-activity-dot">
                <Icon size={14} />
              </div>
              <div className="lead-activity-content">
                <div className="lead-activity-header">
                  <span className="lead-activity-user">{activity.user_name || 'מערכת'}</span>
                  <span className="lead-activity-type-label">{typeInfo.label}</span>
                  <span className="lead-activity-time">{formatTime(activity.created_at)}</span>
                  {!isSystem && onDeleteActivity && (
                    <button
                      className="btn btn-ghost btn-icon btn-xs lead-activity-delete"
                      onClick={() => onDeleteActivity(activity.id)}
                      title="מחק"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div className="lead-activity-text">{activity.content}</div>
              </div>
            </div>
          );
        })}

        {activities.length === 0 && (
          <div className="lead-activity-empty">אין פעילויות עדיין</div>
        )}
      </div>
    </div>
  );
}

export default LeadActivityTimeline;
