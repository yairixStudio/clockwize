// Monthly/yearly reminders keep the day of the month they were set for (reminders.recurrence_day),
// so 31.1 -> 28.2 -> 31.3 instead of drifting to the 28th after one short month.
// Shared by routes/reminders.js and the lead reminders in routes/leads.js.
export const ANCHORED_INTERVALS = ['monthly', 'yearly'];

export const dayOfMonth = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getDate();
};

export const recurrenceDayFor = ({ is_recurring, recurrence_interval, due_date }) =>
  is_recurring && ANCHORED_INTERVALS.includes(recurrence_interval) && due_date ? dayOfMonth(due_date) : null;
