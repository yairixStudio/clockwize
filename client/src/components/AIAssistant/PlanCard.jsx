import { useState } from 'react';
import { Check, User, Briefcase, ListTodo, CheckSquare, Bell, Edit2, X, Save, ChevronDown, ChevronUp } from 'lucide-react';

// Type icons and labels
const TYPE_CONFIG = {
  client: {
    icon: User,
    label: 'לקוח',
    color: 'var(--info)',
    fields: ['name', 'phone', 'email', 'address', 'hourly_rate', 'notes']
  },
  project: {
    icon: Briefcase,
    label: 'פרויקט',
    color: 'var(--primary)',
    fields: ['name', 'description', 'pricing_type', 'fixed_price', 'hourly_rate', 'estimated_hours', 'priority']
  },
  task: {
    icon: ListTodo,
    label: 'משימה',
    color: 'var(--warning)',
    fields: ['name', 'description', 'hourly_rate', 'estimated_hours', 'priority']
  },
  subtask: {
    icon: CheckSquare,
    label: 'תת-משימה',
    color: 'var(--success)',
    fields: ['title']
  },
  reminder: {
    icon: Bell,
    label: 'תזכורת',
    color: 'var(--accent)',
    fields: ['content', 'due_date']
  }
};

// Field labels in Hebrew
const FIELD_LABELS = {
  name: 'שם',
  title: 'כותרת',
  phone: 'טלפון',
  email: 'אימייל',
  address: 'כתובת',
  description: 'תיאור',
  notes: 'הערות',
  content: 'תוכן',
  hourly_rate: 'מחיר לשעה',
  fixed_price: 'מחיר קבוע',
  estimated_hours: 'שעות משוערות',
  pricing_type: 'סוג תמחור',
  priority: 'עדיפות',
  due_date: 'תאריך יעד',
  status: 'סטטוס'
};

// Value formatters
const formatValue = (key, value) => {
  if (value === null || value === undefined || value === '') return '-';
  
  if (key === 'hourly_rate' || key === 'fixed_price') {
    return `₪${value}`;
  }
  if (key === 'estimated_hours') {
    return `${value} שעות`;
  }
  if (key === 'pricing_type') {
    return value === 'fixed' ? 'קבוע' : 'שעתי';
  }
  if (key === 'priority') {
    const labels = { low: 'נמוכה', normal: 'רגילה', high: 'גבוהה' };
    return labels[value] || value;
  }
  if (key === 'due_date' && value) {
    try {
      return new Date(value).toLocaleString('he-IL', { 
        dateStyle: 'short', 
        timeStyle: 'short' 
      });
    } catch {
      return value;
    }
  }
  
  return value;
};

function PlanCard({ item, index, isSelected, onToggle, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [isExpanded, setIsExpanded] = useState(false);

  const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.task;
  const Icon = config.icon;
  
  // Get main display field
  const mainField = item.data.name || item.data.title || item.data.content || '';
  
  // Get secondary info
  const secondaryInfo = [];
  if (item.data.resolved_client_name) {
    secondaryInfo.push(`לקוח: ${item.data.resolved_client_name}`);
  } else if (item.data.client_ref) {
    secondaryInfo.push(`לקוח חדש (${item.data.client_ref})`);
  }
  if (item.data.resolved_project_name) {
    secondaryInfo.push(`פרויקט: ${item.data.resolved_project_name}`);
  } else if (item.data.project_ref) {
    secondaryInfo.push(`פרויקט חדש (${item.data.project_ref})`);
  }
  if (item.data.resolved_task_name) {
    secondaryInfo.push(`משימה: ${item.data.resolved_task_name}`);
  } else if (item.data.task_ref) {
    secondaryInfo.push(`משימה (${item.data.task_ref})`);
  }

  // Show warning for unresolved entities
  if (item.data.unresolved_name && item.data.match_candidates) {
    secondaryInfo.push(`⚠️ "${item.data.unresolved_name}" - לא נמצא, יש הצעות`);
  } else if (item.data.unresolved_name) {
    secondaryInfo.push(`⚠️ "${item.data.unresolved_name}" - לא נמצא במערכת`);
  }

  // Get extra fields to show
  const extraFields = config.fields.filter(f => {
    const val = item.data[f];
    return val !== null && val !== undefined && val !== '' && 
           f !== 'name' && f !== 'title' && f !== 'content';
  });

  const startEditing = (e) => {
    e.stopPropagation();
    setEditData({ ...item.data });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setEditData({});
    setIsEditing(false);
  };

  const saveEditing = () => {
    onUpdate(editData);
    setIsEditing(false);
  };

  const handleFieldChange = (field, value) => {
    setEditData(prev => ({ ...prev, [field]: value }));
  };

  if (isEditing) {
    return (
      <div className={`plan-card editing ${isSelected ? 'selected' : ''}`}>
        <div className="plan-card-header">
          <div className="plan-card-type" style={{ background: config.color }}>
            <Icon size={14} />
            <span>{config.label}</span>
          </div>
          <div className="plan-card-actions">
            <button className="plan-card-action cancel" onClick={cancelEditing}>
              <X size={14} />
            </button>
            <button className="plan-card-action save" onClick={saveEditing}>
              <Save size={14} />
            </button>
          </div>
        </div>
        
        <div className="plan-card-edit-form">
          {config.fields.map(field => (
            <div key={field} className="plan-card-field">
              <label>{FIELD_LABELS[field] || field}</label>
              {field === 'description' || field === 'notes' || field === 'content' ? (
                <textarea
                  value={editData[field] || ''}
                  onChange={(e) => handleFieldChange(field, e.target.value)}
                  rows={2}
                />
              ) : field === 'pricing_type' ? (
                <select
                  value={editData[field] || 'hourly'}
                  onChange={(e) => handleFieldChange(field, e.target.value)}
                >
                  <option value="hourly">שעתי</option>
                  <option value="fixed">קבוע</option>
                </select>
              ) : field === 'priority' ? (
                <select
                  value={editData[field] || 'normal'}
                  onChange={(e) => handleFieldChange(field, e.target.value)}
                >
                  <option value="low">נמוכה</option>
                  <option value="normal">רגילה</option>
                  <option value="high">גבוהה</option>
                </select>
              ) : field === 'due_date' ? (
                <input
                  type="datetime-local"
                  value={editData[field]?.slice(0, 16) || ''}
                  onChange={(e) => handleFieldChange(field, e.target.value)}
                />
              ) : (
                <input
                  type={field.includes('rate') || field.includes('price') || field.includes('hours') ? 'number' : 'text'}
                  value={editData[field] || ''}
                  onChange={(e) => handleFieldChange(field, e.target.value)}
                  dir={field === 'phone' || field === 'email' ? 'ltr' : 'rtl'}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`plan-card ${isSelected ? 'selected' : ''}`}
      onClick={onToggle}
    >
      <div className="plan-card-header">
        <div className="plan-card-checkbox">
          <div className={`checkbox ${isSelected ? 'checked' : ''}`}>
            {isSelected && <Check size={12} />}
          </div>
        </div>
        <div className="plan-card-type" style={{ background: config.color }}>
          <Icon size={14} />
          <span>{config.label}</span>
        </div>
        <div className="plan-card-actions">
          <button 
            className="plan-card-action edit" 
            onClick={startEditing}
            title="עריכה"
          >
            <Edit2 size={14} />
          </button>
          {extraFields.length > 0 && (
            <button 
              className="plan-card-action expand" 
              onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
              title={isExpanded ? 'הסתר פרטים' : 'הצג פרטים'}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>
      
      <div className="plan-card-main">
        <span className="plan-card-name">{mainField}</span>
        {secondaryInfo.length > 0 && (
          <span className="plan-card-secondary">{secondaryInfo.join(' • ')}</span>
        )}
      </div>

      {isExpanded && extraFields.length > 0 && (
        <div className="plan-card-details">
          {extraFields.map(field => (
            <div key={field} className="plan-card-detail">
              <span className="detail-label">{FIELD_LABELS[field] || field}:</span>
              <span className="detail-value">{formatValue(field, item.data[field])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PlanCard;












