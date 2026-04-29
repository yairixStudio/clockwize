export const LEAD_STATUSES = [
  { value: 'new', label: 'חדש', color: '#3b82f6', order: 0 },
  { value: 'contacted', label: 'יצרו קשר', color: '#8b5cf6', order: 1 },
  { value: 'qualified', label: 'מתאים', color: '#10b981', order: 2 },
  { value: 'proposal', label: 'הצעת מחיר', color: '#f59e0b', order: 3 },
  { value: 'negotiation', label: 'משא ומתן', color: '#ef4444', order: 4 },
  { value: 'won', label: 'נסגר', color: '#22c55e', order: 5 },
  { value: 'lost', label: 'אבד', color: '#6b7280', order: 6 }
];

export const LEAD_PRIORITIES = [
  { value: 'hot', label: 'חם', color: '#ef4444' },
  { value: 'warm', label: 'חמים', color: '#f59e0b' },
  { value: 'cold', label: 'קר', color: '#3b82f6' }
];

export const LEAD_SOURCE_TYPES = [
  { value: 'website', label: 'אתר אינטרנט' },
  { value: 'campaign', label: 'קמפיין' },
  { value: 'referral', label: 'הפניה' },
  { value: 'social_media', label: 'רשתות חברתיות' },
  { value: 'cold_call', label: 'שיחה קרה' },
  { value: 'event', label: 'אירוע' },
  { value: 'other', label: 'אחר' }
];

export const LEAD_ACTIVITY_TYPES = [
  { value: 'note', label: 'הערה', icon: 'FileText' },
  { value: 'call', label: 'שיחה', icon: 'Phone' },
  { value: 'meeting', label: 'פגישה', icon: 'Users' },
  { value: 'email', label: 'אימייל', icon: 'Mail' },
  { value: 'status_change', label: 'שינוי סטטוס', icon: 'RefreshCw' },
  { value: 'assignment', label: 'הקצאה', icon: 'UserCheck' },
  { value: 'system', label: 'מערכת', icon: 'Settings' }
];

export const PIPELINE_STAGES = LEAD_STATUSES.filter(
  s => s.value !== 'won' && s.value !== 'lost'
);

export function getLeadStatus(status) {
  return LEAD_STATUSES.find(s => s.value === status) || LEAD_STATUSES[0];
}

export function getLeadPriority(priority) {
  return LEAD_PRIORITIES.find(p => p.value === priority) || LEAD_PRIORITIES[1];
}

export function getSourceType(sourceType) {
  return LEAD_SOURCE_TYPES.find(s => s.value === sourceType) || LEAD_SOURCE_TYPES[6];
}

export function getActivityType(type) {
  return LEAD_ACTIVITY_TYPES.find(a => a.value === type) || LEAD_ACTIVITY_TYPES[0];
}
