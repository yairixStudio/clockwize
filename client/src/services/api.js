const API_BASE = '/api';

const getHeaders = () => {
  const token = localStorage.getItem('token');
  const workspaceId = localStorage.getItem('currentWorkspaceId');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(workspaceId && { 'X-Workspace-Id': workspaceId })
  };
};

const handleResponse = async (response) => {
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'שגיאה בשרת');
    error.details = data.details;
    throw error;
  }
  return data;
};

// Auth
export const authAPI = {
  register: (data) =>
    fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(handleResponse),

  login: (data) =>
    fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(handleResponse),

  getMe: () =>
    fetch(`${API_BASE}/auth/me`, { headers: getHeaders() }).then(handleResponse),

  updateProfile: (data) =>
    fetch(`${API_BASE}/auth/profile`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  deleteAccount: (password) =>
    fetch(`${API_BASE}/auth/account`, {
      method: 'DELETE',
      headers: getHeaders(),
      body: JSON.stringify({ password })
    }).then(handleResponse),

  resetPassword: (data) =>
    fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(handleResponse)
};

// Clients
// Clients
export const clientsAPI = {
  getAll: () =>
    fetch(`${API_BASE}/clients`, { headers: getHeaders() }).then(handleResponse),

  getOne: (id) =>
    fetch(`${API_BASE}/clients/${id}`, { headers: getHeaders() }).then(handleResponse),

  create: (data) =>
    fetch(`${API_BASE}/clients`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  update: (id, data) =>
    fetch(`${API_BASE}/clients/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  toggleFavorite: (id, isFavorite) =>
    fetch(`${API_BASE}/clients/${id}/favorite`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ is_favorite: isFavorite })
    }).then(handleResponse),

  delete: (id) =>
    fetch(`${API_BASE}/clients/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  generateShareLink: (id, permissions = 'view') =>
    fetch(`${API_BASE}/clients/${id}/share`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ permissions })
    }).then(handleResponse),

  removeShareLink: (id) =>
    fetch(`${API_BASE}/clients/${id}/share`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  getShared: (token) =>
    fetch(`${API_BASE}/clients/shared/${token}`).then(handleResponse),

  lookupByDomain: (domain) =>
    fetch(`${API_BASE}/clients/lookup/domain?domain=${encodeURIComponent(domain)}`, { headers: getHeaders() }).then(handleResponse)
};

// Client Sources
export const clientSourcesAPI = {
  getAll: () =>
    fetch(`${API_BASE}/client-sources`, { headers: getHeaders() }).then(handleResponse),
  getStats: () =>
    fetch(`${API_BASE}/client-sources/stats`, { headers: getHeaders() }).then(handleResponse),
  create: (data) =>
    fetch(`${API_BASE}/client-sources`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),
  assignToWorkspace: (id) =>
    fetch(`${API_BASE}/client-sources/${id}/assign-to-workspace`, {
      method: 'POST',
      headers: getHeaders()
    }).then(handleResponse)
};

// Leads
export const leadsAPI = {
  getAll: (params = {}) => {
    const queryString = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== '')
    ).toString();
    return fetch(`${API_BASE}/leads${queryString ? `?${queryString}` : ''}`, {
      headers: getHeaders()
    }).then(handleResponse);
  },
  getStats: () =>
    fetch(`${API_BASE}/leads/stats`, { headers: getHeaders() }).then(handleResponse),
  getPipeline: () =>
    fetch(`${API_BASE}/leads/pipeline`, { headers: getHeaders() }).then(handleResponse),
  getOne: (id) =>
    fetch(`${API_BASE}/leads/${id}`, { headers: getHeaders() }).then(handleResponse),
  create: (data) =>
    fetch(`${API_BASE}/leads`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),
  update: (id, data) =>
    fetch(`${API_BASE}/leads/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),
  updateStatus: (id, status, lost_reason) =>
    fetch(`${API_BASE}/leads/${id}/status`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ status, lost_reason })
    }).then(handleResponse),
  assign: (id, assigned_to) =>
    fetch(`${API_BASE}/leads/${id}/assign`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ assigned_to })
    }).then(handleResponse),
  convert: (id, overrides = {}) =>
    fetch(`${API_BASE}/leads/${id}/convert`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(overrides)
    }).then(handleResponse),
  delete: (id) =>
    fetch(`${API_BASE}/leads/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),
  getActivities: (id) =>
    fetch(`${API_BASE}/leads/${id}/activities`, { headers: getHeaders() }).then(handleResponse),
  addActivity: (id, data) =>
    fetch(`${API_BASE}/leads/${id}/activities`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),
  deleteActivity: (id, activityId) =>
    fetch(`${API_BASE}/leads/${id}/activities/${activityId}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),
  getReminders: (id) =>
    fetch(`${API_BASE}/leads/${id}/reminders`, { headers: getHeaders() }).then(handleResponse),
  addReminder: (id, data) =>
    fetch(`${API_BASE}/leads/${id}/reminders`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),
  updateReminder: (id, reminderId, data) =>
    fetch(`${API_BASE}/leads/${id}/reminders/${reminderId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),
  deleteReminder: (id, reminderId) =>
    fetch(`${API_BASE}/leads/${id}/reminders/${reminderId}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),
  // Lead tasks & time
  getTasks: (id) =>
    fetch(`${API_BASE}/leads/${id}/tasks`, { headers: getHeaders() }).then(handleResponse),
  createTask: (id, data) =>
    fetch(`${API_BASE}/leads/${id}/tasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),
  getTimeEntries: (id) =>
    fetch(`${API_BASE}/leads/${id}/time-entries`, { headers: getHeaders() }).then(handleResponse),
  ensureProject: (id) =>
    fetch(`${API_BASE}/leads/${id}/ensure-project`, {
      method: 'POST',
      headers: getHeaders()
    }).then(handleResponse)
};

// Projects
export const projectsAPI = {
  getAll: (clientId) =>
    fetch(`${API_BASE}/projects${clientId ? `?client_id=${clientId}` : ''}`, {
      headers: getHeaders()
    }).then(handleResponse),

  getOne: (id) =>
    fetch(`${API_BASE}/projects/${id}`, { headers: getHeaders() }).then(handleResponse),

  create: (data) =>
    fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  update: (id, data) =>
    fetch(`${API_BASE}/projects/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  delete: (id) =>
    fetch(`${API_BASE}/projects/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  toggleFavorite: (id, isFavorite) =>
    fetch(`${API_BASE}/projects/${id}/favorite`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ is_favorite: isFavorite })
    }).then(handleResponse),

  generateShareLink: (id, permissions = 'view') =>
    fetch(`${API_BASE}/projects/${id}/share`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ permissions })
    }).then(handleResponse),

  removeShareLink: (id) =>
    fetch(`${API_BASE}/projects/${id}/share`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  getShared: (token) =>
    fetch(`${API_BASE}/projects/shared/${token}`).then(handleResponse)
};

// Tasks
export const tasksAPI = {
  getAll: (projectId, { includeSubtasks } = {}) => {
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (includeSubtasks) params.set('include_subtasks', 'true');
    const qs = params.toString();
    return fetch(`${API_BASE}/tasks${qs ? `?${qs}` : ''}`, {
      headers: getHeaders()
    }).then(handleResponse);
  },

  getOne: (id) =>
    fetch(`${API_BASE}/tasks/${id}`, { headers: getHeaders() }).then(handleResponse),

  create: (data) =>
    fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  update: (id, data) =>
    fetch(`${API_BASE}/tasks/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  delete: (id) =>
    fetch(`${API_BASE}/tasks/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  addSubtask: (taskId, data) =>
    fetch(`${API_BASE}/tasks/${taskId}/subtasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(typeof data === 'string' ? { title: data } : data)
    }).then(handleResponse),

  updateSubtask: (subtaskId, data) =>
    fetch(`${API_BASE}/tasks/subtasks/${subtaskId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  deleteSubtask: (subtaskId) =>
    fetch(`${API_BASE}/tasks/subtasks/${subtaskId}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse)
};

// Timer - Updated for multiple timers support
export const timerAPI = {
  // Get all active timers (returns array)
  getActive: () =>
    fetch(`${API_BASE}/timer/active`, { headers: getHeaders() }).then(handleResponse),

  // Get timer for specific project
  getProjectTimer: (projectId, taskId = null) => {
    const params = taskId ? `?taskId=${taskId}` : '';
    return fetch(`${API_BASE}/timer/active/project/${projectId}${params}`, {
      headers: getHeaders()
    }).then(handleResponse);
  },

  start: (projectId, taskId) =>
    fetch(`${API_BASE}/timer/start`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ project_id: projectId, task_id: taskId })
    }).then(handleResponse),

  // Pause specific timer by ID
  pause: (timerId) =>
    fetch(`${API_BASE}/timer/pause/${timerId}`, {
      method: 'POST',
      headers: getHeaders()
    }).then(handleResponse),

  // Resume specific timer by ID
  resume: (timerId) =>
    fetch(`${API_BASE}/timer/resume/${timerId}`, {
      method: 'POST',
      headers: getHeaders()
    }).then(handleResponse),

  // Stop specific timer by ID
  stop: (timerId, notes, intervals, options = {}) =>
    fetch(`${API_BASE}/timer/stop/${timerId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        notes,
        intervals,
        project_id: options.project_id,
        task_id: options.task_id,
        subtask_id: options.subtask_id,
        additional_associations: options.additional_associations
      })
    }).then(handleResponse),

  // Discard specific timer by ID
  discard: (timerId) =>
    fetch(`${API_BASE}/timer/discard/${timerId}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  getEntries: (projectId, taskId) => {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', projectId);
    if (taskId) params.append('task_id', taskId);
    return fetch(`${API_BASE}/timer/entries?${params}`, { headers: getHeaders() }).then(handleResponse);
  },

  // Create manual time entry
  createEntry: (data) =>
    fetch(`${API_BASE}/timer/entries`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // Update time entry
  updateEntry: (id, data) =>
    fetch(`${API_BASE}/timer/entries/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  deleteEntry: (id) =>
    fetch(`${API_BASE}/timer/entries/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  // Get intervals for a time entry
  getEntryIntervals: (entryId) =>
    fetch(`${API_BASE}/timer/entries/${entryId}/intervals`, {
      headers: getHeaders()
    }).then(handleResponse),

  // Get intervals for an active timer
  getTimerIntervals: (timerId) =>
    fetch(`${API_BASE}/timer/active/${timerId}/intervals`, {
      headers: getHeaders()
    }).then(handleResponse),

  // Update timer start time
  updateStartTime: (timerId, startTime) =>
    fetch(`${API_BASE}/timer/active/${timerId}/start-time`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ start_time: startTime })
    }).then(handleResponse)
};

// Stats
export const statsAPI = {
  getDashboard: (params = {}) => {
    const searchParams = new URLSearchParams();
    if (params.month !== undefined) searchParams.append('month', params.month);
    if (params.year !== undefined) searchParams.append('year', params.year);
    if (params.startDate) searchParams.append('startDate', params.startDate);
    if (params.endDate) searchParams.append('endDate', params.endDate);
    const query = searchParams.toString();
    return fetch(`${API_BASE}/stats/dashboard${query ? `?${query}` : ''}`, { headers: getHeaders() }).then(handleResponse);
  },

  getClient: (id) =>
    fetch(`${API_BASE}/stats/client/${id}`, { headers: getHeaders() }).then(handleResponse),

  getProject: (id) =>
    fetch(`${API_BASE}/stats/project/${id}`, { headers: getHeaders() }).then(handleResponse)
};

// Shared Links
export const shareAPI = {
  // Create a new shared link
  create: (data) =>
    fetch(`${API_BASE}/share`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // Get all links owned by user
  getMyLinks: () =>
    fetch(`${API_BASE}/share/my-links`, { headers: getHeaders() }).then(handleResponse),

  // Get links shared with the current user
  getSharedWithMe: () =>
    fetch(`${API_BASE}/share/shared-with-me`, { headers: getHeaders() }).then(handleResponse),

  // Update a shared link
  update: (id, data) =>
    fetch(`${API_BASE}/share/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // Delete a shared link
  delete: (id) =>
    fetch(`${API_BASE}/share/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  // Get link info (public)
  getInfo: (token) =>
    fetch(`${API_BASE}/share/info/${token}`).then(handleResponse),

  // Verify password
  verifyPassword: (token, password) =>
    fetch(`${API_BASE}/share/verify-password/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    }).then(handleResponse),

  // Verify email (for logged-in users)
  verifyEmail: (token) =>
    fetch(`${API_BASE}/share/verify-email/${token}`, {
      method: 'POST',
      headers: getHeaders()
    }).then(handleResponse),

  // Access shared resource
  access: (token, params = {}) => {
    const queryParams = new URLSearchParams(params).toString();
    return fetch(`${API_BASE}/share/access/${token}${queryParams ? '?' + queryParams : ''}`).then(handleResponse);
  }
};

// Reminders
export const remindersAPI = {
  getAll: (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.type) queryParams.append('type', params.type);
    if (params.id) queryParams.append('id', params.id);
    if (params.include_read) queryParams.append('include_read', params.include_read);

    return fetch(`${API_BASE}/reminders?${queryParams}`, { headers: getHeaders() }).then(handleResponse);
  },

  create: (data) =>
    fetch(`${API_BASE}/reminders`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  update: (id, data) =>
    fetch(`${API_BASE}/reminders/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  delete: (id) =>
    fetch(`${API_BASE}/reminders/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse)
};

// Admin
export const adminAPI = {
  getUsers: () =>
    fetch(`${API_BASE}/admin/users`, { headers: getHeaders() }).then(handleResponse),

  impersonate: (userId) =>
    fetch(`${API_BASE}/admin/impersonate/${userId}`, {
      method: 'POST',
      headers: getHeaders()
    }).then(handleResponse),

  forcePasswordReset: (userId) =>
    fetch(`${API_BASE}/admin/users/${userId}/force-password-reset`, {
      method: 'POST',
      headers: getHeaders()
    }).then(handleResponse),

  setPassword: (userId, password) =>
    fetch(`${API_BASE}/admin/users/${userId}/set-password`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ password })
    }).then(handleResponse),

  toggleActive: (userId) =>
    fetch(`${API_BASE}/admin/users/${userId}/toggle-active`, {
      method: 'POST',
      headers: getHeaders()
    }).then(handleResponse),

  deleteUser: (userId) =>
    fetch(`${API_BASE}/admin/users/${userId}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse)
};

// Comments (Forum)
export const commentsAPI = {
  get: (params = {}) => {
    const queryParams = new URLSearchParams(params).toString();
    return fetch(`${API_BASE}/comments${queryParams ? '?' + queryParams : ''}`, {
      headers: getHeaders()
    }).then(handleResponse);
  },

  create: (data) =>
    fetch(`${API_BASE}/comments`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  update: (id, content) =>
    fetch(`${API_BASE}/comments/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ content })
    }).then(handleResponse),

  delete: (id) =>
    fetch(`${API_BASE}/comments/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  getUnreadCount: (params = {}) => {
    const queryParams = new URLSearchParams(params).toString();
    return fetch(`${API_BASE}/comments/unread${queryParams ? '?' + queryParams : ''}`, {
      headers: getHeaders()
    }).then(handleResponse);
  },

  markAsRead: (data) =>
    fetch(`${API_BASE}/comments/mark-read`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse)
};

// Payments
export const paymentsAPI = {
  // Get all payments with optional filters
  getAll: (params = {}) => {
    const queryString = typeof params === 'string' 
      ? `project_id=${params}` 
      : new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return fetch(`${API_BASE}/payments${queryString ? `?${queryString}` : ''}`, { 
      headers: getHeaders() 
    }).then(handleResponse);
  },

  // Get single payment
  getOne: (id) =>
    fetch(`${API_BASE}/payments/${id}`, { headers: getHeaders() }).then(handleResponse),

  // Get payments summary (for dashboard)
  getSummary: (params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return fetch(`${API_BASE}/payments/summary${queryString ? `?${queryString}` : ''}`, { 
      headers: getHeaders() 
    }).then(handleResponse);
  },

  // Get pending payments
  getPending: () =>
    fetch(`${API_BASE}/payments/pending`, { headers: getHeaders() }).then(handleResponse),

  // Get overdue payments
  getOverdue: () =>
    fetch(`${API_BASE}/payments/overdue`, { headers: getHeaders() }).then(handleResponse),

  // Create payment
  create: (data) =>
    fetch(`${API_BASE}/payments`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // Update payment
  update: (id, data) =>
    fetch(`${API_BASE}/payments/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // Quick status update
  updateStatus: (id, status) =>
    fetch(`${API_BASE}/payments/${id}/status`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ status })
    }).then(handleResponse),

  // Delete payment
  delete: (id) =>
    fetch(`${API_BASE}/payments/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse)
};

// Credentials (Password Manager)
export const credentialsAPI = {
  getAll: () =>
    fetch(`${API_BASE}/credentials`, { headers: getHeaders() }).then(handleResponse),

  getByClient: (clientId) =>
    fetch(`${API_BASE}/credentials/client/${clientId}`, { headers: getHeaders() }).then(handleResponse),

  getByProject: (projectId) =>
    fetch(`${API_BASE}/credentials/project/${projectId}`, { headers: getHeaders() }).then(handleResponse),

  getAccount: () =>
    fetch(`${API_BASE}/credentials/account`, { headers: getHeaders() }).then(handleResponse),

  create: (data) =>
    fetch(`${API_BASE}/credentials`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  update: (id, data) =>
    fetch(`${API_BASE}/credentials/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  delete: (id) =>
    fetch(`${API_BASE}/credentials/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse)
};

// Files
export const filesAPI = {
  getByClient: (clientId) =>
    fetch(`${API_BASE}/files?client_id=${clientId}`, { headers: getHeaders() }).then(handleResponse),

  getByProject: (projectId) =>
    fetch(`${API_BASE}/files?project_id=${projectId}`, { headers: getHeaders() }).then(handleResponse),

  getByTask: (taskId) =>
    fetch(`${API_BASE}/files?task_id=${taskId}`, { headers: getHeaders() }).then(handleResponse),

  upload: (formData) => {
    const token = localStorage.getItem('token');
    const workspaceId = localStorage.getItem('currentWorkspaceId');
    return fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(workspaceId && { 'X-Workspace-Id': workspaceId })
        // Note: Do NOT set Content-Type for FormData - browser sets it with boundary
      },
      body: formData
    }).then(handleResponse);
  },

  download: (fileId) => {
    const token = localStorage.getItem('token');
    return fetch(`${API_BASE}/files/${fileId}/download`, {
      headers: {
        ...(token && { Authorization: `Bearer ${token}` })
      }
    }).then(response => {
      if (!response.ok) throw new Error('Failed to download');
      return response.blob();
    });
  },

  delete: (id) =>
    fetch(`${API_BASE}/files/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse)
};

// Notes
export const notesAPI = {
  getByEntity: (entityType, entityId) =>
    fetch(`${API_BASE}/notes/${entityType}/${entityId}`, { headers: getHeaders() }).then(handleResponse),

  create: (data) =>
    fetch(`${API_BASE}/notes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  update: (id, data) =>
    fetch(`${API_BASE}/notes/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  delete: (id) =>
    fetch(`${API_BASE}/notes/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse)
};

// Addons (User Extensions)
export const addonsAPI = {
  // קבלת כל התוספים עם מצבם
  getAll: () =>
    fetch(`${API_BASE}/addons`, { headers: getHeaders() }).then(handleResponse),

  // קבלת רשימת התוספים המופעלים בלבד
  getEnabled: () =>
    fetch(`${API_BASE}/addons/enabled`, { headers: getHeaders() }).then(handleResponse),

  // עדכון מצב תוסף
  update: (addonId, isEnabled) =>
    fetch(`${API_BASE}/addons/${addonId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ isEnabled })
    }).then(handleResponse),

  // עדכון מרובה של תוספים
  updateMany: (addons) =>
    fetch(`${API_BASE}/addons`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ addons })
    }).then(handleResponse),

  // קבלת הגדרות תוסף
  getSettings: (addonId) =>
    fetch(`${API_BASE}/addons/${addonId}/settings`, { headers: getHeaders() }).then(handleResponse),

  // עדכון הגדרות תוסף
  updateSettings: (addonId, settings) =>
    fetch(`${API_BASE}/addons/${addonId}/settings`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(settings)
    }).then(handleResponse)
};

// Workspaces
export const workspacesAPI = {
  getAll: () =>
    fetch(`${API_BASE}/workspaces`, { headers: getHeaders() }).then(handleResponse),

  getOne: (id) =>
    fetch(`${API_BASE}/workspaces/${id}`, { headers: getHeaders() }).then(handleResponse),

  create: (data) =>
    fetch(`${API_BASE}/workspaces`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  update: (id, data) =>
    fetch(`${API_BASE}/workspaces/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  delete: (id) =>
    fetch(`${API_BASE}/workspaces/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  // Members
  getMembers: (workspaceId) =>
    fetch(`${API_BASE}/workspaces/${workspaceId}/members`, { headers: getHeaders() }).then(handleResponse),

  updateMemberRole: (workspaceId, userId, role) =>
    fetch(`${API_BASE}/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ role })
    }).then(handleResponse),

  removeMember: (workspaceId, userId) =>
    fetch(`${API_BASE}/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  leave: (workspaceId) =>
    fetch(`${API_BASE}/workspaces/${workspaceId}/leave`, {
      method: 'POST',
      headers: getHeaders()
    }).then(handleResponse),

  // Invites
  createInvite: (workspaceId, data) =>
    fetch(`${API_BASE}/workspaces/${workspaceId}/invite`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  getInvites: (workspaceId) =>
    fetch(`${API_BASE}/workspaces/${workspaceId}/invites`, { headers: getHeaders() }).then(handleResponse),

  deleteInvite: (workspaceId, inviteId) =>
    fetch(`${API_BASE}/workspaces/${workspaceId}/invites/${inviteId}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  // Join via invite code
  getInviteInfo: (code) =>
    fetch(`${API_BASE}/workspaces/join/${code}`).then(handleResponse),

  joinByCode: (code) =>
    fetch(`${API_BASE}/workspaces/join/${code}`, {
      method: 'POST',
      headers: getHeaders()
    }).then(handleResponse)
};

// Catalog (Product/Service catalog)
export const catalogAPI = {
  // קבלת כל הפריטים
  getAll: (params = {}) => {
    const searchParams = new URLSearchParams();
    if (params.category) searchParams.append('category', params.category);
    if (params.active_only) searchParams.append('active_only', 'true');
    const query = searchParams.toString();
    return fetch(`${API_BASE}/catalog${query ? `?${query}` : ''}`, { headers: getHeaders() }).then(handleResponse);
  },

  // קבלת פריט בודד
  getOne: (id) =>
    fetch(`${API_BASE}/catalog/${id}`, { headers: getHeaders() }).then(handleResponse),

  // יצירת פריט חדש
  create: (data) =>
    fetch(`${API_BASE}/catalog`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // עדכון פריט
  update: (id, data) =>
    fetch(`${API_BASE}/catalog/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // מחיקת פריט
  delete: (id) =>
    fetch(`${API_BASE}/catalog/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  // קבלת רשימת קטגוריות
  getCategories: () =>
    fetch(`${API_BASE}/catalog/meta/categories`, { headers: getHeaders() }).then(handleResponse)
};

// AI Assistant
export const aiAPI = {
  // שליחת הודעה ל-AI וקבלת תוכנית
  chat: (message, conversationHistory = []) =>
    fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ message, conversationHistory })
    }).then(handleResponse),

  // ביצוע התוכנית המאושרת
  execute: (items) =>
    fetch(`${API_BASE}/ai/execute`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ items })
    }).then(handleResponse)
};

// Expenses API
export const expensesAPI = {
  // קבלת כל ההוצאות
  getAll: (params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return fetch(`${API_BASE}/expenses${queryString ? `?${queryString}` : ''}`, { 
      headers: getHeaders() 
    }).then(handleResponse);
  },

  // יצירת הוצאה
  create: (data) =>
    fetch(`${API_BASE}/expenses`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // עדכון הוצאה
  update: (id, data) =>
    fetch(`${API_BASE}/expenses/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // מחיקת הוצאה
  delete: (id) =>
    fetch(`${API_BASE}/expenses/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  // סיכום הוצאות
  getSummary: (params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return fetch(`${API_BASE}/expenses/summary${queryString ? `?${queryString}` : ''}`, { 
      headers: getHeaders() 
    }).then(handleResponse);
  },

  // קטגוריות
  getCategories: () =>
    fetch(`${API_BASE}/expenses/categories`, { headers: getHeaders() }).then(handleResponse),

  createCategory: (data) =>
    fetch(`${API_BASE}/expenses/categories`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  updateCategory: (id, data) =>
    fetch(`${API_BASE}/expenses/categories/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  deleteCategory: (id) =>
    fetch(`${API_BASE}/expenses/categories/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse)
};

// Recurring Payments API
export const recurringAPI = {
  // קבלת כל התשלומים המתחדשים
  getAll: (params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return fetch(`${API_BASE}/recurring${queryString ? `?${queryString}` : ''}`, { 
      headers: getHeaders() 
    }).then(handleResponse);
  },

  // קבלת תשלום מתחדש בודד
  getOne: (id) =>
    fetch(`${API_BASE}/recurring/${id}`, { headers: getHeaders() }).then(handleResponse),

  // יצירת תשלום מתחדש
  create: (data) =>
    fetch(`${API_BASE}/recurring`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // עדכון תשלום מתחדש
  update: (id, data) =>
    fetch(`${API_BASE}/recurring/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  // מחיקת תשלום מתחדש
  delete: (id) =>
    fetch(`${API_BASE}/recurring/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  // הפעלה/כיבוי
  toggle: (id) =>
    fetch(`${API_BASE}/recurring/${id}/toggle`, {
      method: 'PATCH',
      headers: getHeaders()
    }).then(handleResponse),

  // קבלת תשלומים קרובים (לתזכורות)
  getUpcoming: (days = 7) =>
    fetch(`${API_BASE}/recurring/upcoming/reminders?days=${days}`, { 
      headers: getHeaders() 
    }).then(handleResponse),

  // יצירת תשלום מתשלום מתחדש
  generate: (id, data = {}) =>
    fetch(`${API_BASE}/recurring/${id}/generate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse)
};

// Project Alerts
export const alertsAPI = {
  getAll: (projectId) => {
    const params = projectId ? `?project_id=${projectId}` : '';
    return fetch(`${API_BASE}/alerts${params}`, { headers: getHeaders() }).then(handleResponse);
  },

  check: (projectId) =>
    fetch(`${API_BASE}/alerts/check/${projectId}`, { headers: getHeaders() }).then(handleResponse),

  create: (data) =>
    fetch(`${API_BASE}/alerts`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  update: (id, data) =>
    fetch(`${API_BASE}/alerts/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  dismiss: (id) =>
    fetch(`${API_BASE}/alerts/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ is_dismissed: true })
    }).then(handleResponse),

  delete: (id) =>
    fetch(`${API_BASE}/alerts/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse)
};

// Planned Slots (scheduled work)
export const plannedSlotsAPI = {
  getAll: () =>
    fetch(`${API_BASE}/planned-slots`, { headers: getHeaders() }).then(handleResponse),

  create: (data) =>
    fetch(`${API_BASE}/planned-slots`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  update: (id, data) =>
    fetch(`${API_BASE}/planned-slots/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),

  delete: (id) =>
    fetch(`${API_BASE}/planned-slots/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  deleteGroup: (groupId) =>
    fetch(`${API_BASE}/planned-slots/group/${groupId}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse)
};

const api = {
  get: (path) =>
    fetch(`${API_BASE}${path}`, { headers: getHeaders() }).then(handleResponse),
  post: (path, data) =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),
  put: (path, data) =>
    fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    }).then(handleResponse),
  delete: (path) =>
    fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: getHeaders() }).then(handleResponse)
};

export const backupAPI = {
  getStatus: () =>
    fetch(`${API_BASE}/backup/status`, { headers: getHeaders() }).then(handleResponse),
  trigger: () =>
    fetch(`${API_BASE}/backup/trigger`, { method: 'POST', headers: getHeaders() }).then(handleResponse),
};

export default api;
