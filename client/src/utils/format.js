// Format seconds to HH:MM:SS
export const formatDuration = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
};

// Format seconds to human readable (e.g., "2 שעות 30 דקות")
export const formatDurationHuman = (seconds) => {
  if (seconds === 0) return '0 דקות';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'שעה' : 'שעות'}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'דקה' : 'דקות'}`);
  
  return parts.join(' ו-') || '0 דקות';
};

// Format currency
export const formatCurrency = (amount, currency = '₪') => {
  return `${currency}${amount.toLocaleString('he-IL')}`;
};

// Format date
export const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('he-IL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

// Format date and time
export const formatDateTime = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('he-IL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Calculate hours from seconds
export const secondsToHours = (seconds) => {
  return Math.round((seconds / 3600) * 100) / 100;
};

// Format time only (HH:MM)
export const formatTimeOnly = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

// Calculate end time from start time and duration
export const calculateEndTime = (startTime, durationSeconds) => {
  const start = new Date(startTime);
  const end = new Date(start.getTime() + durationSeconds * 1000);
  return end.toISOString();
};

