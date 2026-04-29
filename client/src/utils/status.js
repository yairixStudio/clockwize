// Project statuses
export const PROJECT_STATUSES = [
  { value: 'active', label: 'פעיל', icon: '🟢', badge: 'badge-active' },
  { value: 'in_progress', label: 'בתהליך', icon: '🔄', badge: 'badge-in_progress' },
  { value: 'stuck', label: 'תקוע', icon: '🚫', badge: 'badge-stuck' },
  { value: 'review', label: 'בבדיקה', icon: '👀', badge: 'badge-review' },
  { value: 'on_hold', label: 'מוקפא', icon: '⏸️', badge: 'badge-on_hold' },
  { value: 'completed', label: 'הושלם', icon: '✅', badge: 'badge-completed' },
  { value: 'cancelled', label: 'בוטל', icon: '❌', badge: 'badge-cancelled' }
];

// Task statuses
export const TASK_STATUSES = [
  { value: 'pending', label: 'ממתין', icon: '⏳', badge: 'badge-pending' },
  { value: 'in_progress', label: 'בתהליך', icon: '🔄', badge: 'badge-in_progress' },
  { value: 'stuck', label: 'תקוע', icon: '🚫', badge: 'badge-stuck' },
  { value: 'review', label: 'בבדיקה', icon: '👀', badge: 'badge-review' },
  { value: 'completed', label: 'הושלם', icon: '✅', badge: 'badge-completed' },
  { value: 'cancelled', label: 'בוטל', icon: '❌', badge: 'badge-cancelled' }
];

// Client statuses
export const CLIENT_STATUSES = [
  { value: 'lead', label: 'ליד', icon: '🎣', badge: 'badge-in_progress' },
  { value: 'active', label: 'פעיל', icon: '', badge: 'badge-active' },
  { value: 'past', label: 'עבר', icon: '💼', badge: 'badge-review' },
  { value: 'inactive', label: 'לא פעיל', icon: '⚪', badge: 'badge-cancelled' }
];

export function getProjectStatus(status) {
  return PROJECT_STATUSES.find(s => s.value === status) || PROJECT_STATUSES[0];
}

export function getTaskStatus(status) {
  return TASK_STATUSES.find(s => s.value === status) || TASK_STATUSES[0];
}

export function getClientStatus(status) {
  return CLIENT_STATUSES.find(s => s.value === status) || CLIENT_STATUSES[1]; // Default to active
}

export function getStatusLabel(status, type = 'task') {
  // Backward compatibility
  if (type === true) type = 'project';
  if (type === false) type = 'task';

  let statusObj;
  if (type === 'project') statusObj = getProjectStatus(status);
  else if (type === 'client') statusObj = getClientStatus(status);
  else statusObj = getTaskStatus(status);
  
  return statusObj.icon ? `${statusObj.icon} ${statusObj.label}` : statusObj.label;
}

export function getStatusBadge(status, type = 'task') {
  // Backward compatibility
  if (type === true) type = 'project';
  if (type === false) type = 'task';

  let statusObj;
  if (type === 'project') statusObj = getProjectStatus(status);
  else if (type === 'client') statusObj = getClientStatus(status);
  else statusObj = getTaskStatus(status);
  
  return statusObj.badge;
}

