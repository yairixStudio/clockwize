import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Clock, Plus, X, Trash2, GripVertical, Repeat, ListTodo, Timer, Bell, UserPlus } from 'lucide-react';
import { timerAPI, clientsAPI, projectsAPI, plannedSlotsAPI, leadsAPI, remindersAPI } from '../services/api';
import useStore from '../store/useStore';
import { useModal } from '../components/Modal';
import TimeEntryModal from '../components/TimeEntryModal';
import { formatDurationHuman } from '../utils/format';
import { splitEntriesByDay, getEntriesForDay } from '../utils/timeSplit';
import './Schedule.css';

// פונקציות עזר לתאריכים
const getDaysInMonth = (date) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  return days;
};

const getFirstDayOfMonth = (date) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  return new Date(year, month, 1).getDay();
};

const getWeekDays = (date) => {
  const curr = new Date(date);
  const first = curr.getDate() - curr.getDay();

  const days = [];
  for (let i = 0; i < 7; i++) {
    const next = new Date(curr);
    next.setDate(first + i);
    days.push(next);
  }
  return days;
};

const isSameDay = (d1, d2) => {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
};

const formatDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

// צבעים ללקוחות
const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#06b6d4',
  '#84cc16', '#a855f7', '#d946ef', '#f43f5e', '#2dd4bf'
];

const getClientColor = (clientId) => {
  if (!clientId) return '#94a3b8';
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COLORS.length;
  return COLORS[index];
};

// Time grid configuration
const HOUR_HEIGHT = 60;
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const TOTAL_HOURS = DAY_END_HOUR - DAY_START_HOUR;
const GRID_HEIGHT = TOTAL_HOURS * HOUR_HEIGHT;
const MIN_EVENT_HEIGHT = 20;

// Day view compact configuration
const DAY_VIEW_HOUR_HEIGHT = 40;
const DAY_VIEW_GRID_HEIGHT = TOTAL_HOURS * DAY_VIEW_HOUR_HEIGHT;
const DAY_VIEW_VISIBLE_HOURS = 8; // 8:00-16:00

const getHourLabels = () => {
  const labels = [];
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) {
    labels.push(`${String(h).padStart(2, '0')}:00`);
  }
  return labels;
};

const hasTimeData = (entry) => {
  return !!(entry._sliceStart || entry.start_time);
};

/**
 * Compute layout positions for time entries in a single day column.
 * Uses greedy column-packing for overlapping entries (like Google Calendar).
 * Returns array of { entry, top, height, column, totalColumns }.
 */
function computeTimeGridLayout(entries, hourHeight = HOUR_HEIGHT) {
  if (!entries.length) return [];

  const items = entries.map(entry => {
    const start = new Date(entry._sliceStart || entry.start_time);
    const end = new Date(entry._sliceEnd || entry.end_time || start);

    const startMinutes = start.getHours() * 60 + start.getMinutes();
    let endMinutes = end.getHours() * 60 + end.getMinutes();
    if (endMinutes <= startMinutes) endMinutes = startMinutes + 30;

    const clampedStartMin = Math.max(startMinutes, DAY_START_HOUR * 60);
    const clampedEndMin = Math.min(endMinutes, DAY_END_HOUR * 60);

    const top = ((clampedStartMin - DAY_START_HOUR * 60) / 60) * hourHeight;
    const height = Math.max(
      ((clampedEndMin - clampedStartMin) / 60) * hourHeight,
      MIN_EVENT_HEIGHT
    );

    return { entry, startMin: clampedStartMin, endMin: clampedEndMin, top, height, column: 0, totalColumns: 1 };
  });

  items.sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

  // Greedy column assignment
  const columns = [];
  for (const item of items) {
    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      if (columns[col] <= item.startMin) {
        item.column = col;
        columns[col] = item.endMin;
        placed = true;
        break;
      }
    }
    if (!placed) {
      item.column = columns.length;
      columns.push(item.endMin);
    }
  }

  // Find connected overlap clusters and set totalColumns
  const visited = new Set();
  for (let i = 0; i < items.length; i++) {
    if (visited.has(i)) continue;
    const cluster = [i];
    visited.add(i);
    let qi = 0;
    while (qi < cluster.length) {
      const ci = cluster[qi];
      for (let j = 0; j < items.length; j++) {
        if (visited.has(j)) continue;
        if (items[ci].startMin < items[j].endMin && items[j].startMin < items[ci].endMin) {
          cluster.push(j);
          visited.add(j);
        }
      }
      qi++;
    }
    const maxCol = Math.max(...cluster.map(idx => items[idx].column)) + 1;
    for (const idx of cluster) {
      items[idx].totalColumns = maxCol;
    }
  }

  return items;
}

function Schedule() {
  const navigate = useNavigate();
  const modal = useModal();
  const [view, setView] = useState('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [entries, setEntries] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [plannedSlots, setPlannedSlots] = useState([]);
  const [leads, setLeads] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [displayMode, setDisplayMode] = useState('all'); // 'all' | 'logged' | 'planned'

  // Add dropdown state
  const [addDropdownDate, setAddDropdownDate] = useState(null); // date string of open dropdown
  const addDropdownRef = useRef(null);
  const timegridBodyRef = useRef(null);

  // TimeEntryModal state
  const [showTimeEntryModal, setShowTimeEntryModal] = useState(false);
  const [timeEntryDate, setTimeEntryDate] = useState(null);
  const [convertingSlot, setConvertingSlot] = useState(null);

  // Modal state
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [editingSlot, setEditingSlot] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [slotForm, setSlotForm] = useState({ slot_type: 'client', client_id: '', lead_id: '', project_id: '', hours: 1, minutes: 0, notes: '', is_recurring: false, recurrence_type: 'weekly', recurrence_interval: 1, recurrence_end_date: '' });
  const [clientProjects, setClientProjects] = useState([]);
  const [savingSlot, setSavingSlot] = useState(false);

  // Drag and drop state
  const [draggedSlot, setDraggedSlot] = useState(null);
  const [dragOverDate, setDragOverDate] = useState(null);

  useEffect(() => {
    loadData();
  }, [currentDate, view]);

  // Auto-scroll time grid to 8:00 AM when switching to week/day view
  useEffect(() => {
    if ((view === 'week' || view === 'day') && !loading && timegridBodyRef.current) {
      const h = view === 'day' ? DAY_VIEW_HOUR_HEIGHT : HOUR_HEIGHT;
      timegridBodyRef.current.scrollTop = (8 - DAY_START_HOUR) * h;
    }
  }, [view, loading]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [entriesData, clientsData, slotsData, leadsData, remindersData] = await Promise.all([
        timerAPI.getEntries(),
        clientsAPI.getAll(),
        plannedSlotsAPI.getAll(),
        leadsAPI.getAll().catch(() => []),
        remindersAPI.getAll().catch(() => [])
      ]);

      setEntries(entriesData);
      setClients(clientsData);
      setPlannedSlots(slotsData);
      setLeads(leadsData);
      setReminders(remindersData.filter(r => r.due_date && !r.is_read));
    } catch (error) {
      console.error('Error loading schedule data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!addDropdownDate) return;
    const handleClickOutside = (e) => {
      if (addDropdownRef.current && !addDropdownRef.current.contains(e.target)) {
        setAddDropdownDate(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [addDropdownDate]);

  const handlePlusClick = (e, dateStr, date) => {
    e.stopPropagation();
    setAddDropdownDate(prev => prev === dateStr ? null : dateStr);
  };

  const handleDropdownSelect = (type, date) => {
    setAddDropdownDate(null);
    if (type === 'planned') {
      openSlotModal(date);
    } else if (type === 'time-entry') {
      setTimeEntryDate(date);
      setShowTimeEntryModal(true);
    }
  };

  const handleConvertSlot = async (slot, e) => {
    e.stopPropagation();
    // For lead slots, ensure project exists first
    if (slot.lead_id && !slot.project_id) {
      try {
        const result = await leadsAPI.ensureProject(slot.lead_id);
        slot = { ...slot, project_id: result.project_id };
      } catch (error) {
        modal.error('שגיאה ביצירת פרויקט פנימי עבור הליד');
        return;
      }
    }
    setConvertingSlot(slot);
    setShowTimeEntryModal(true);
  };

  const handleSaveTimeEntry = async (entryData) => {
    try {
      await timerAPI.createEntry(entryData);
      if (convertingSlot) {
        await plannedSlotsAPI.delete(convertingSlot.id);
        setConvertingSlot(null);
      }
      loadData();
      setShowTimeEntryModal(false);
      setTimeEntryDate(null);
      modal.success('רשומת הזמן נוספה בהצלחה');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const getClientName = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    return client ? client.name : 'לקוח לא ידוע';
  };

  // סינון רשומות לתצוגה הנוכחית - כולל פיצול רשומות שחוצות ימים
  const currentVirtualEntries = useMemo(() => {
    if (displayMode === 'planned') return [];

    // חישוב גבולות התקופה הנוכחית
    let periodStart, periodEnd;
    if (view === 'month') {
      periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (view === 'day') {
      periodStart = new Date(currentDate);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd = new Date(currentDate);
      periodEnd.setHours(23, 59, 59, 999);
    } else {
      periodStart = new Date(currentDate);
      periodStart.setDate(currentDate.getDate() - currentDate.getDay());
      periodStart.setHours(0, 0, 0, 0);
      periodEnd = new Date(periodStart);
      periodEnd.setDate(periodStart.getDate() + 6);
      periodEnd.setHours(23, 59, 59, 999);
    }

    // סינון רשומות שחופפות לתקופה (לא רק לפי start_time)
    const overlapping = entries.filter(entry => {
      const entryStart = new Date(entry.start_time);
      const entryEnd = entry.end_time ? new Date(entry.end_time) : new Date();
      return entryStart <= periodEnd && entryEnd >= periodStart;
    });

    // פיצול רשומות שחוצות חצות לרשומות וירטואליות לפי יום
    return splitEntriesByDay(overlapping);
  }, [entries, currentDate, view, displayMode]);

  // סינון סלוטים מתוכננים לתצוגה הנוכחית
  const currentSlots = useMemo(() => {
    if (displayMode === 'logged') return [];
    return plannedSlots.filter(slot => {
      const slotDate = new Date(slot.date + 'T00:00:00');
      if (view === 'month') {
        return slotDate.getMonth() === currentDate.getMonth() &&
               slotDate.getFullYear() === currentDate.getFullYear();
      } else if (view === 'day') {
        return slot.date === formatDateStr(currentDate);
      } else {
        const weekStart = new Date(currentDate);
        weekStart.setDate(currentDate.getDate() - currentDate.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);

        return slotDate >= weekStart && slotDate < weekEnd;
      }
    });
  }, [plannedSlots, currentDate, view, displayMode]);

  const navigateDate = (direction) => {
    const newDate = new Date(currentDate);
    if (view === 'month') {
      newDate.setMonth(currentDate.getMonth() + direction);
    } else if (view === 'day') {
      newDate.setDate(currentDate.getDate() + direction);
    } else {
      newDate.setDate(currentDate.getDate() + (direction * 7));
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Modal handlers
  const openSlotModal = (date, slot = null) => {
    setSelectedDate(date);
    if (slot) {
      setEditingSlot(slot);
      const totalMinutes = Math.floor((slot.duration || 0) / 60);
      setSlotForm({
        slot_type: slot.lead_id ? 'lead' : 'client',
        client_id: slot.client_id || '',
        lead_id: slot.lead_id || '',
        project_id: slot.project_id || '',
        hours: Math.floor(totalMinutes / 60),
        minutes: totalMinutes % 60,
        notes: slot.notes || '',
        is_recurring: !!slot.recurrence_group_id,
        recurrence_type: slot.recurrence_type || 'weekly',
        recurrence_interval: slot.recurrence_interval || 1,
        recurrence_end_date: slot.recurrence_end_date || ''
      });
      if (slot.client_id) {
        loadClientProjects(slot.client_id);
      }
    } else {
      setEditingSlot(null);
      setSlotForm({ slot_type: 'client', client_id: '', lead_id: '', project_id: '', hours: 1, minutes: 0, notes: '', is_recurring: false, recurrence_type: 'weekly', recurrence_interval: 1, recurrence_end_date: '' });
      setClientProjects([]);
    }
    setShowSlotModal(true);
  };

  const closeSlotModal = () => {
    setShowSlotModal(false);
    setEditingSlot(null);
    setSelectedDate(null);
    setSlotForm({ slot_type: 'client', client_id: '', lead_id: '', project_id: '', hours: 1, minutes: 0, notes: '', is_recurring: false, recurrence_type: 'weekly', recurrence_interval: 1, recurrence_end_date: '' });
    setClientProjects([]);
  };

  const loadClientProjects = async (clientId) => {
    if (!clientId) {
      setClientProjects([]);
      return;
    }
    try {
      const projects = await projectsAPI.getAll(clientId);
      setClientProjects(projects);
    } catch (error) {
      console.error('Error loading projects:', error);
      setClientProjects([]);
    }
  };

  const handleClientChange = (clientId) => {
    setSlotForm(prev => ({ ...prev, client_id: clientId, project_id: '' }));
    loadClientProjects(clientId);
  };

  const handleSaveSlot = async () => {
    const hasEntity = slotForm.slot_type === 'lead' ? slotForm.lead_id : slotForm.client_id;
    if (!hasEntity || (!slotForm.hours && !slotForm.minutes)) return;

    setSavingSlot(true);
    try {
      const duration = (slotForm.hours * 3600) + (slotForm.minutes * 60);
      const data = {
        client_id: slotForm.slot_type === 'client' ? slotForm.client_id : null,
        lead_id: slotForm.slot_type === 'lead' ? slotForm.lead_id : null,
        project_id: slotForm.slot_type === 'client' ? (slotForm.project_id || null) : null,
        date: formatDateStr(selectedDate),
        duration,
        notes: slotForm.notes || null
      };

      if (editingSlot) {
        const updated = await plannedSlotsAPI.update(editingSlot.id, data);
        setPlannedSlots(prev => prev.map(s => s.id === editingSlot.id ? updated : s));
      } else {
        // Add recurrence data only for new slots
        if (slotForm.is_recurring && slotForm.recurrence_end_date) {
          data.is_recurring = true;
          data.recurrence_type = slotForm.recurrence_type;
          data.recurrence_interval = slotForm.recurrence_interval;
          data.recurrence_end_date = slotForm.recurrence_end_date;
        }
        const created = await plannedSlotsAPI.create(data);
        // API returns array for recurring, single object for non-recurring
        if (Array.isArray(created)) {
          setPlannedSlots(prev => [...prev, ...created]);
        } else {
          setPlannedSlots(prev => [...prev, created]);
        }
      }
      closeSlotModal();
    } catch (error) {
      console.error('Error saving planned slot:', error);
    } finally {
      setSavingSlot(false);
    }
  };

  const handleDeleteSlot = async (slotId, e) => {
    if (e) e.stopPropagation();
    try {
      await plannedSlotsAPI.delete(slotId);
      setPlannedSlots(prev => prev.filter(s => s.id !== slotId));
      if (showSlotModal && editingSlot?.id === slotId) {
        closeSlotModal();
      }
    } catch (error) {
      console.error('Error deleting planned slot:', error);
    }
  };

  const handleDeleteSeries = async (groupId) => {
    try {
      const result = await plannedSlotsAPI.deleteGroup(groupId);
      if (result.deletedIds) {
        const deletedSet = new Set(result.deletedIds);
        setPlannedSlots(prev => prev.filter(s => !deletedSet.has(s.id)));
      }
      if (showSlotModal) {
        closeSlotModal();
      }
    } catch (error) {
      console.error('Error deleting series:', error);
    }
  };

  // Drag and drop handlers
  const handleDragStart = useCallback((e, slot) => {
    setDraggedSlot(slot);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', slot.id);
    // Add a slight delay to let the browser capture the drag image
    requestAnimationFrame(() => {
      e.target.classList.add('dragging');
    });
  }, []);

  const handleDragEnd = useCallback((e) => {
    e.target.classList.remove('dragging');
    setDraggedSlot(null);
    setDragOverDate(null);
  }, []);

  const handleDragOver = useCallback((e, dateStr) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(dateStr);
  }, []);

  const handleDragLeave = useCallback((e) => {
    // Only clear if we're leaving the day cell, not entering a child
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverDate(null);
    }
  }, []);

  const handleDrop = useCallback(async (e, dateStr) => {
    e.preventDefault();
    setDragOverDate(null);

    if (!draggedSlot || draggedSlot.date === dateStr) {
      setDraggedSlot(null);
      return;
    }

    // Optimistic update
    const previousSlots = [...plannedSlots];
    setPlannedSlots(prev => prev.map(s =>
      s.id === draggedSlot.id ? { ...s, date: dateStr } : s
    ));

    try {
      const updated = await plannedSlotsAPI.update(draggedSlot.id, { date: dateStr });
      setPlannedSlots(prev => prev.map(s => s.id === draggedSlot.id ? updated : s));
    } catch (error) {
      console.error('Error moving planned slot:', error);
      // Revert on failure
      setPlannedSlots(previousSlots);
    }

    setDraggedSlot(null);
  }, [draggedSlot, plannedSlots]);

  const handleReorderSlot = useCallback(async (dateStr, slotId, direction) => {
    const daySlots = currentSlots
      .filter(s => s.date === dateStr)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const idx = daySlots.findIndex(s => s.id === slotId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= daySlots.length) return;

    // Swap sort_order values
    const orderA = daySlots[idx].sort_order ?? idx;
    const orderB = daySlots[newIdx].sort_order ?? newIdx;

    // Optimistic update
    setPlannedSlots(prev => prev.map(s => {
      if (s.id === daySlots[idx].id) return { ...s, sort_order: orderB };
      if (s.id === daySlots[newIdx].id) return { ...s, sort_order: orderA };
      return s;
    }));

    try {
      await Promise.all([
        plannedSlotsAPI.update(daySlots[idx].id, { sort_order: orderB }),
        plannedSlotsAPI.update(daySlots[newIdx].id, { sort_order: orderA })
      ]);
    } catch (error) {
      console.error('Error reordering slots:', error);
      loadData();
    }
  }, [currentSlots, plannedSlots]);

  const renderMonthView = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const days = [];

    // ימים ריקים בהתחלה
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
    }

    // ימי החודש
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), i);
      const isToday = isSameDay(date, new Date());
      const dateStr = formatDateStr(date);

      const dayEntries = getEntriesForDay(currentVirtualEntries, date);

      const daySlots = currentSlots.filter(slot => slot.date === dateStr);

      // קיבוץ רשומות זמן לפי לקוח
      const entriesByClient = dayEntries.reduce((acc, entry) => {
        const clientName = entry.client_id ? getClientName(entry.client_id) : 'ללא לקוח';
        const key = entry.client_id || 'no-client';

        if (!acc[key]) {
          acc[key] = {
            clientId: entry.client_id,
            clientName,
            duration: 0,
            count: 0,
            color: getClientColor(entry.client_id)
          };
        }
        acc[key].duration += entry.duration || 0;
        acc[key].count++;
        return acc;
      }, {});

      days.push(
        <div
          key={i}
          className={`calendar-day ${isToday ? 'today' : ''} ${dragOverDate === dateStr ? 'drag-over' : ''}`}
          onDragOver={(e) => handleDragOver(e, dateStr)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, dateStr)}
        >
          <div className="day-header">
            <span>{i}</span>
            <div className="add-dropdown-wrapper" ref={addDropdownDate === dateStr ? addDropdownRef : null}>
              <button
                className="add-slot-btn"
                onClick={(e) => handlePlusClick(e, dateStr, date)}
                title="הוסף"
              >
                <Plus size={12} />
              </button>
              {addDropdownDate === dateStr && (
                <div className="add-dropdown">
                  <button className="add-dropdown-item" onClick={() => handleDropdownSelect('planned', date)}>
                    <ListTodo size={14} />
                    משימה מתוכננת
                  </button>
                  <button className="add-dropdown-item" onClick={() => handleDropdownSelect('time-entry', date)}>
                    <Timer size={14} />
                    רשומת זמן
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="day-content">
            {/* רשומות זמן */}
            {Object.entries(entriesByClient).map(([key, data], idx) => (
              <div
                key={`entry-${idx}`}
                className={`calendar-event ${data.clientId ? 'clickable' : ''}`}
                style={{ backgroundColor: data.color }}
                title={`${data.clientName}: ${formatDurationHuman(data.duration)}`}
                onClick={() => data.clientId && navigate(`/clients/${data.clientId}`)}
              >
                <span 
                  className={`event-client ${data.clientId ? 'clickable-client-name' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (data.clientId) {
                      navigate(`/clients/${data.clientId}`);
                    }
                  }}
                  style={{ cursor: data.clientId ? 'pointer' : 'default' }}
                >
                  {data.clientName}
                </span>
                <span className="event-duration">{formatDurationHuman(data.duration)}</span>
              </div>
            ))}
            {/* סלוטים מתוכננים */}
            {daySlots.map(slot => {
              const slotName = slot.lead_id
                ? (slot.lead_name || 'ליד')
                : (slot.client_name || getClientName(slot.client_id));
              const slotColor = slot.lead_id ? '#8b5cf6' : getClientColor(slot.client_id);
              return (
                <div
                  key={`slot-${slot.id}`}
                  className={`calendar-event planned clickable ${slot.lead_id ? 'lead-slot' : ''}`}
                  style={{ backgroundColor: slotColor }}
                  title={`מתוכנן: ${slotName} - ${formatDurationHuman(slot.duration)}${slot.recurrence_group_id ? ' (חוזר)' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, slot)}
                  onDragEnd={handleDragEnd}
                  onClick={() => openSlotModal(date, slot)}
                >
                  <span
                    className={`event-client ${(slot.client_id || slot.lead_id) ? 'clickable-client-name' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (slot.lead_id) {
                        navigate(`/leads/${slot.lead_id}`);
                      } else if (slot.client_id) {
                        navigate(`/clients/${slot.client_id}`);
                      }
                    }}
                    style={{ cursor: (slot.client_id || slot.lead_id) ? 'pointer' : 'default' }}
                  >
                    <GripVertical size={10} className="drag-handle" />
                    {slot.lead_id ? <UserPlus size={10} className="planned-icon" /> : slot.recurrence_group_id ? <Repeat size={10} className="planned-icon" /> : <Clock size={10} className="planned-icon" />}
                    {slotName}
                  </span>
                  <span className="event-duration">{formatDurationHuman(slot.duration)}</span>
                  {slot.notes && (
                    <div className="event-notes-line">{slot.notes}</div>
                  )}
                  <button
                    className="convert-slot-btn-month"
                    onClick={(e) => handleConvertSlot(slot, e)}
                    title="המר לרשומת זמן"
                  >
                    <Timer size={12} />
                  </button>
                  <button
                    className="delete-slot-btn-month"
                    onClick={(e) => handleDeleteSlot(slot.id, e)}
                    title="מחק תכנון"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
            {/* תזכורות */}
            {reminders.filter(r => {
              const rDate = new Date(r.due_date);
              return isSameDay(rDate, date);
            }).map(reminder => (
              <div
                key={`reminder-${reminder.id}`}
                className="calendar-event reminder-event"
                title={reminder.content}
                onClick={() => {
                  if (reminder.association_type === 'lead') navigate(`/leads/${reminder.association_id}`);
                  else if (reminder.association_type === 'client') navigate(`/clients/${reminder.association_id}`);
                  else if (reminder.association_type === 'project') navigate(`/projects/${reminder.association_id}`);
                  else if (reminder.association_type === 'task') navigate(`/tasks/${reminder.association_id}`);
                  else navigate('/reminders');
                }}
              >
                <Bell size={10} />
                <span className="event-client">{reminder.content}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="calendar-grid month-view">
        {WEEKDAYS.map(day => (
          <div key={day} className="calendar-header-cell">{day}</div>
        ))}
        {days}
      </div>
    );
  };

  const renderWeekView = () => {
    const weekDays = getWeekDays(currentDate);
    const hourLabels = getHourLabels();

    const dayLayouts = weekDays.map(date => {
      const dateStr = formatDateStr(date);
      const dayEntries = getEntriesForDay(currentVirtualEntries, date).filter(hasTimeData);
      const daySlots = currentSlots.filter(slot => slot.date === dateStr);
      const layout = computeTimeGridLayout(dayEntries);
      return { date, dateStr, dayEntries, daySlots, layout };
    });

    const hasAnySlots = dayLayouts.some(d => d.daySlots.length > 0);

    return (
      <div className="week-view-timegrid">
        {/* Day headers row */}
        <div className="timegrid-header-row">
          <div className="timegrid-header-gutter"></div>
          <div className="timegrid-header-columns">
            {dayLayouts.map(({ date, dateStr }, idx) => {
              const isToday = isSameDay(date, new Date());
              return (
                <div key={idx} className={`timegrid-header-cell ${isToday ? 'today' : ''}`}>
                  <span className="week-day-name">{WEEKDAYS[date.getDay()]}</span>
                  <span className="week-date">{date.getDate()}</span>
                  <div className="add-dropdown-wrapper" ref={addDropdownDate === dateStr ? addDropdownRef : null}>
                    <button
                      className="add-slot-btn-week"
                      onClick={(e) => handlePlusClick(e, dateStr, date)}
                      title="הוסף"
                    >
                      <Plus size={14} />
                    </button>
                    {addDropdownDate === dateStr && (
                      <div className="add-dropdown">
                        <button className="add-dropdown-item" onClick={() => handleDropdownSelect('planned', date)}>
                          <ListTodo size={14} />
                          משימה מתוכננת
                        </button>
                        <button className="add-dropdown-item" onClick={() => handleDropdownSelect('time-entry', date)}>
                          <Timer size={14} />
                          רשומת זמן
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* All-day section for planned slots */}
        {(displayMode !== 'logged' && hasAnySlots) && (
          <div className="timegrid-allday-row">
            <div className="timegrid-allday-gutter">
              <span>כל היום</span>
            </div>
            <div className="timegrid-allday-columns">
              {dayLayouts.map(({ date, dateStr, daySlots }, idx) => (
                <div
                  key={idx}
                  className={`timegrid-allday-col ${dragOverDate === dateStr ? 'drag-over' : ''}`}
                  onDragOver={(e) => handleDragOver(e, dateStr)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, dateStr)}
                >
                  {daySlots
                    .slice()
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map((slot, slotIdx) => {
                    const slotName = slot.lead_id
                      ? (slot.lead_name || 'ליד')
                      : (slot.client_name || getClientName(slot.client_id));
                    const slotColor = slot.lead_id ? '#8b5cf6' : getClientColor(slot.client_id);
                    return (
                      <div
                        key={`slot-${slot.id}`}
                        className={`timegrid-allday-event ${slot.lead_id ? 'lead-slot' : ''}`}
                        style={{ borderRight: `3px dashed ${slotColor}` }}
                        draggable
                        onDragStart={(e) => handleDragStart(e, slot)}
                        onDragEnd={handleDragEnd}
                        onClick={() => openSlotModal(date, slot)}
                      >
                        <GripVertical size={10} className="drag-handle" />
                        {slot.lead_id ? <UserPlus size={10} /> : slot.recurrence_group_id ? <Repeat size={10} /> : <Clock size={10} />}
                        <span className="allday-event-name">
                          {slotName}
                        </span>
                        <span className="event-duration-tag planned-tag">
                          {formatDurationHuman(slot.duration)}
                        </span>
                        <div className="allday-reorder-arrows">
                          <button
                            className="allday-reorder-btn"
                            disabled={slotIdx === 0}
                            onClick={(e) => { e.stopPropagation(); handleReorderSlot(dateStr, slot.id, -1); }}
                            title="הזז למעלה"
                          >
                            <ChevronUp size={12} />
                          </button>
                          <button
                            className="allday-reorder-btn"
                            disabled={slotIdx === daySlots.length - 1}
                            onClick={(e) => { e.stopPropagation(); handleReorderSlot(dateStr, slot.id, 1); }}
                            title="הזז למטה"
                          >
                            <ChevronDown size={12} />
                          </button>
                        </div>
                        <button
                          className="convert-slot-btn"
                          onClick={(e) => handleConvertSlot(slot, e)}
                          title="המר לרשומת זמן"
                        >
                          <Timer size={12} />
                        </button>
                        <button
                          className="delete-slot-btn"
                          onClick={(e) => handleDeleteSlot(slot.id, e)}
                          title="מחק"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scrollable time grid body */}
        <div className="timegrid-body" ref={timegridBodyRef}>
          {/* Time gutter */}
          <div className="timegrid-gutter">
            {hourLabels.map(label => (
              <div key={label} className="timegrid-hour-label" style={{ height: HOUR_HEIGHT }}>
                <span>{label}</span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="timegrid-columns">
            {dayLayouts.map(({ date, dateStr, layout }, idx) => {
              const isToday = isSameDay(date, new Date());
              return (
                <div
                  key={idx}
                  className={`timegrid-day-col ${isToday ? 'today' : ''}`}
                  style={{ height: GRID_HEIGHT }}
                >
                  {/* Hour grid lines */}
                  {hourLabels.map((_, hIdx) => (
                    <div
                      key={hIdx}
                      className="timegrid-hour-line"
                      style={{ top: hIdx * HOUR_HEIGHT }}
                    />
                  ))}

                  {/* Positioned entry blocks */}
                  {layout.map(item => (
                    <div
                      key={item.entry.id}
                      className="timegrid-event"
                      style={{
                        top: item.top,
                        height: item.height,
                        right: `${(item.column / item.totalColumns) * 100}%`,
                        width: `${(1 / item.totalColumns) * 100}%`,
                        backgroundColor: getClientColor(item.entry.client_id),
                      }}
                    >
                      <div className="timegrid-event-title">
                        <Link to={`/projects/${item.entry.project_id}`} className="clickable-name">
                          {item.entry.project_name}
                        </Link>
                      </div>
                      {item.entry.task_name && (
                        <div className="timegrid-event-subtitle">
                          <Link to={`/tasks/${item.entry.task_id}`} className="clickable-name">
                            {item.entry.task_name}
                          </Link>
                        </div>
                      )}
                      <div className="timegrid-event-duration">
                        {formatDurationHuman(item.entry.duration)}
                      </div>
                    </div>
                  ))}

                  {/* Current time indicator */}
                  {isToday && (() => {
                    const now = new Date();
                    const nowMin = now.getHours() * 60 + now.getMinutes();
                    if (nowMin >= DAY_START_HOUR * 60 && nowMin <= DAY_END_HOUR * 60) {
                      const top = ((nowMin - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
                      return <div className="timegrid-now-line" style={{ top }} />;
                    }
                    return null;
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const date = new Date(currentDate);
    const dateStr = formatDateStr(date);
    const hourLabels = getHourLabels();
    const isToday = isSameDay(date, new Date());

    const dayEntries = getEntriesForDay(currentVirtualEntries, date).filter(hasTimeData);
    const daySlots = currentSlots
      .filter(slot => slot.date === dateStr)
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const layout = computeTimeGridLayout(dayEntries, DAY_VIEW_HOUR_HEIGHT);
    const hasSlots = daySlots.length > 0;

    return (
      <div className="week-view-timegrid day-view-timegrid">
        {/* Day header row */}
        <div className="timegrid-header-row">
          <div className="timegrid-header-gutter"></div>
          <div className="timegrid-header-columns">
            <div className={`timegrid-header-cell ${isToday ? 'today' : ''}`}>
              <span className="week-day-name">{WEEKDAYS[date.getDay()]}</span>
              <span className="week-date">{date.getDate()}</span>
              <div className="add-dropdown-wrapper" ref={addDropdownDate === dateStr ? addDropdownRef : null}>
                <button
                  className="add-slot-btn-week"
                  onClick={(e) => handlePlusClick(e, dateStr, date)}
                  title="הוסף"
                >
                  <Plus size={14} />
                </button>
                {addDropdownDate === dateStr && (
                  <div className="add-dropdown">
                    <button className="add-dropdown-item" onClick={() => handleDropdownSelect('planned', date)}>
                      <ListTodo size={14} />
                      משימה מתוכננת
                    </button>
                    <button className="add-dropdown-item" onClick={() => handleDropdownSelect('time-entry', date)}>
                      <Timer size={14} />
                      רשומת זמן
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* All-day section for planned slots */}
        {(displayMode !== 'logged' && hasSlots) && (
          <div className="timegrid-allday-row">
            <div className="timegrid-allday-gutter">
              <span>כל היום</span>
            </div>
            <div className="timegrid-allday-columns">
              <div
                className={`timegrid-allday-col ${dragOverDate === dateStr ? 'drag-over' : ''}`}
                onDragOver={(e) => handleDragOver(e, dateStr)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, dateStr)}
              >
                {daySlots.map((slot, slotIdx) => {
                  const slotName = slot.lead_id
                    ? (slot.lead_name || 'ליד')
                    : (slot.client_name || getClientName(slot.client_id));
                  const slotColor = slot.lead_id ? '#8b5cf6' : getClientColor(slot.client_id);
                  return (
                    <div
                      key={`slot-${slot.id}`}
                      className={`timegrid-allday-event ${slot.lead_id ? 'lead-slot' : ''}`}
                      style={{ borderRight: `3px dashed ${slotColor}` }}
                      draggable
                      onDragStart={(e) => handleDragStart(e, slot)}
                      onDragEnd={handleDragEnd}
                      onClick={() => openSlotModal(date, slot)}
                    >
                      <GripVertical size={10} className="drag-handle" />
                      {slot.lead_id ? <UserPlus size={10} /> : slot.recurrence_group_id ? <Repeat size={10} /> : <Clock size={10} />}
                      <span className="allday-event-name">
                        {slotName}
                      </span>
                      <span className="event-duration-tag planned-tag">
                        {formatDurationHuman(slot.duration)}
                      </span>
                      <div className="allday-reorder-arrows">
                        <button
                          className="allday-reorder-btn"
                          disabled={slotIdx === 0}
                          onClick={(e) => { e.stopPropagation(); handleReorderSlot(dateStr, slot.id, -1); }}
                          title="הזז למעלה"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          className="allday-reorder-btn"
                          disabled={slotIdx === daySlots.length - 1}
                          onClick={(e) => { e.stopPropagation(); handleReorderSlot(dateStr, slot.id, 1); }}
                          title="הזז למטה"
                        >
                          <ChevronDown size={12} />
                        </button>
                      </div>
                      <button
                        className="convert-slot-btn"
                        onClick={(e) => handleConvertSlot(slot, e)}
                        title="המר לרשומת זמן"
                      >
                        <Timer size={12} />
                      </button>
                      <button
                        className="delete-slot-btn"
                        onClick={(e) => handleDeleteSlot(slot.id, e)}
                        title="מחק"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Scrollable time grid body */}
        <div className="timegrid-body" ref={timegridBodyRef} style={{ maxHeight: DAY_VIEW_VISIBLE_HOURS * DAY_VIEW_HOUR_HEIGHT }}>
          <div className="timegrid-gutter">
            {hourLabels.map(label => (
              <div key={label} className="timegrid-hour-label" style={{ height: DAY_VIEW_HOUR_HEIGHT }}>
                <span>{label}</span>
              </div>
            ))}
          </div>

          <div className="timegrid-columns">
            <div
              className={`timegrid-day-col ${isToday ? 'today' : ''}`}
              style={{ height: DAY_VIEW_GRID_HEIGHT }}
            >
              {hourLabels.map((_, hIdx) => (
                <div
                  key={hIdx}
                  className="timegrid-hour-line"
                  style={{ top: hIdx * DAY_VIEW_HOUR_HEIGHT }}
                />
              ))}

              {layout.map(item => (
                <div
                  key={item.entry.id}
                  className="timegrid-event"
                  style={{
                    top: item.top,
                    height: item.height,
                    right: `${(item.column / item.totalColumns) * 100}%`,
                    width: `${(1 / item.totalColumns) * 100}%`,
                    backgroundColor: getClientColor(item.entry.client_id),
                  }}
                >
                  <div className="timegrid-event-title">
                    <Link to={`/projects/${item.entry.project_id}`} className="clickable-name">
                      {item.entry.project_name}
                    </Link>
                  </div>
                  {item.entry.task_name && (
                    <div className="timegrid-event-subtitle">
                      <Link to={`/tasks/${item.entry.task_id}`} className="clickable-name">
                        {item.entry.task_name}
                      </Link>
                    </div>
                  )}
                  <div className="timegrid-event-duration">
                    {formatDurationHuman(item.entry.duration)}
                  </div>
                </div>
              ))}

              {isToday && (() => {
                const now = new Date();
                const nowMin = now.getHours() * 60 + now.getMinutes();
                if (nowMin >= DAY_START_HOUR * 60 && nowMin <= DAY_END_HOUR * 60) {
                  const top = ((nowMin - DAY_START_HOUR * 60) / 60) * DAY_VIEW_HOUR_HEIGHT;
                  return <div className="timegrid-now-line" style={{ top }} />;
                }
                return null;
              })()}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderSlotModal = () => {
    if (!showSlotModal) return null;

    return (
      <div className="slot-modal-overlay" onClick={closeSlotModal}>
        <div className="slot-modal" onClick={e => e.stopPropagation()}>
          <div className="slot-modal-header">
            <h3>{editingSlot ? 'עריכת תכנון' : 'תכנון חדש'}</h3>
            <button className="slot-modal-close" onClick={closeSlotModal}>
              <X size={18} />
            </button>
          </div>

          <div className="slot-modal-date">
            <CalendarIcon size={14} />
            {editingSlot ? (
              <input
                type="date"
                className="slot-date-input"
                value={selectedDate ? formatDateStr(selectedDate) : ''}
                onChange={(e) => {
                  const newDate = new Date(e.target.value + 'T00:00:00');
                  if (!isNaN(newDate.getTime())) {
                    setSelectedDate(newDate);
                  }
                }}
              />
            ) : (
              <span>
                {selectedDate && `${WEEKDAYS[selectedDate.getDay()]}, ${selectedDate.getDate()} ב${MONTHS[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`}
              </span>
            )}
          </div>

          <div className="slot-modal-body">
            {/* Client / Lead toggle */}
            {leads.length > 0 && (
              <div className="slot-type-toggle">
                <button
                  className={`slot-type-btn ${slotForm.slot_type === 'client' ? 'active' : ''}`}
                  onClick={() => setSlotForm(prev => ({ ...prev, slot_type: 'client', lead_id: '' }))}
                  type="button"
                >
                  לקוח
                </button>
                <button
                  className={`slot-type-btn ${slotForm.slot_type === 'lead' ? 'active' : ''}`}
                  onClick={() => setSlotForm(prev => ({ ...prev, slot_type: 'lead', client_id: '', project_id: '' }))}
                  type="button"
                >
                  <UserPlus size={14} />
                  ליד
                </button>
              </div>
            )}

            {slotForm.slot_type === 'client' ? (
              <>
                <div className="slot-field">
                  <label>לקוח *</label>
                  <select
                    value={slotForm.client_id}
                    onChange={e => handleClientChange(e.target.value)}
                  >
                    <option value="">בחר לקוח...</option>
                    {clients.filter(c => c.status === 'active').map(client => (
                      <option key={client.id} value={client.id}>{client.name}</option>
                    ))}
                  </select>
                </div>

                <div className="slot-field">
                  <label>פרויקט (אופציונלי)</label>
                  <select
                    value={slotForm.project_id}
                    onChange={e => setSlotForm(prev => ({ ...prev, project_id: e.target.value }))}
                    disabled={!slotForm.client_id}
                  >
                    <option value="">כל הפרויקטים</option>
                    {clientProjects.filter(p => p.status === 'active').map(project => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="slot-field">
                <label>ליד *</label>
                <select
                  value={slotForm.lead_id}
                  onChange={e => setSlotForm(prev => ({ ...prev, lead_id: e.target.value }))}
                >
                  <option value="">בחר ליד...</option>
                  {leads.filter(l => l.status !== 'won' && l.status !== 'lost').map(lead => (
                    <option key={lead.id} value={lead.id}>{lead.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="slot-field">
              <label>משך זמן *</label>
              <div className="duration-inputs">
                <div className="duration-input-group">
                  <input
                    type="number"
                    min="0"
                    max="24"
                    value={slotForm.hours}
                    onChange={e => setSlotForm(prev => ({ ...prev, hours: parseInt(e.target.value) || 0 }))}
                  />
                  <span>שעות</span>
                </div>
                <div className="duration-input-group">
                  <input
                    type="number"
                    min="0"
                    max="59"
                    step="15"
                    value={slotForm.minutes}
                    onChange={e => setSlotForm(prev => ({ ...prev, minutes: parseInt(e.target.value) || 0 }))}
                  />
                  <span>דקות</span>
                </div>
              </div>
            </div>

            <div className="slot-field">
              <label>הערות</label>
              <textarea
                value={slotForm.notes}
                onChange={e => setSlotForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="הערות לתכנון..."
                rows={2}
              />
            </div>

            {!editingSlot && (
              <div className="slot-field recurrence-field">
                <label className="recurrence-checkbox-label">
                  <input
                    type="checkbox"
                    checked={slotForm.is_recurring}
                    onChange={e => setSlotForm(prev => ({ ...prev, is_recurring: e.target.checked }))}
                  />
                  <Repeat size={14} />
                  אירוע חוזר
                </label>

                {slotForm.is_recurring && (
                  <div className="recurrence-config">
                    <div className="recurrence-frequency">
                      <span>כל</span>
                      <input
                        type="number"
                        min="1"
                        max="12"
                        value={slotForm.recurrence_interval}
                        onChange={e => setSlotForm(prev => ({ ...prev, recurrence_interval: parseInt(e.target.value) || 1 }))}
                        className="recurrence-interval-input"
                      />
                      <select
                        value={slotForm.recurrence_type}
                        onChange={e => setSlotForm(prev => ({ ...prev, recurrence_type: e.target.value }))}
                        className="recurrence-type-select"
                      >
                        <option value="daily">יום</option>
                        <option value="weekly">שבוע</option>
                        <option value="biweekly">דו-שבועי</option>
                        <option value="monthly">חודש</option>
                        <option value="yearly">שנה</option>
                      </select>
                    </div>
                    <div className="recurrence-end">
                      <span>עד</span>
                      <input
                        type="date"
                        value={slotForm.recurrence_end_date || ''}
                        onChange={e => setSlotForm(prev => ({ ...prev, recurrence_end_date: e.target.value }))}
                        min={selectedDate ? formatDateStr(selectedDate) : ''}
                        className="recurrence-end-input"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="slot-modal-footer">
            {editingSlot && (
              <div className="slot-delete-actions">
                <button
                  className="slot-delete-btn"
                  onClick={() => handleDeleteSlot(editingSlot.id)}
                >
                  <Trash2 size={14} />
                  מחק
                </button>
                {editingSlot.recurrence_group_id && (
                  <button
                    className="slot-delete-btn slot-delete-series-btn"
                    onClick={() => handleDeleteSeries(editingSlot.recurrence_group_id)}
                  >
                    <Repeat size={14} />
                    מחק סדרה
                  </button>
                )}
              </div>
            )}
            <div className="slot-modal-actions">
              <button className="slot-cancel-btn" onClick={closeSlotModal}>ביטול</button>
              <button
                className="slot-save-btn"
                onClick={handleSaveSlot}
                disabled={!(slotForm.slot_type === 'lead' ? slotForm.lead_id : slotForm.client_id) || (!slotForm.hours && !slotForm.minutes) || savingSlot || (slotForm.is_recurring && !slotForm.recurrence_end_date)}
              >
                {savingSlot ? 'שומר...' : (editingSlot ? 'עדכן' : 'שמור')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="page fade-in schedule-page">
      <div className="page-header">
        <div className="header-content">
          <CalendarIcon className="page-icon" size={24} />
          <div>
            <h1 className="page-title">לו״ז עבודה</h1>
            <p className="page-subtitle">צפה בפעילות לפי לוח שנה</p>
          </div>
        </div>

        <div className="schedule-controls">
          <div className="display-mode-toggle">
            <button
              className={`toggle-btn ${displayMode === 'all' ? 'active' : ''}`}
              onClick={() => setDisplayMode('all')}
            >
              הכל
            </button>
            <button
              className={`toggle-btn ${displayMode === 'logged' ? 'active' : ''}`}
              onClick={() => setDisplayMode('logged')}
            >
              ביצוע
            </button>
            <button
              className={`toggle-btn ${displayMode === 'planned' ? 'active' : ''}`}
              onClick={() => setDisplayMode('planned')}
            >
              תכנון
            </button>
          </div>

          <div className="date-nav-wrapper">
            <button onClick={goToToday} className="today-btn">היום</button>
            <div className="date-nav">
              <button onClick={() => navigateDate(-1)} className="nav-btn">
                <ChevronRight size={20} />
              </button>
              <span className="current-date-label">
                {view === 'month'
                  ? `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
                  : view === 'day'
                    ? `${WEEKDAYS[currentDate.getDay()]} ${currentDate.getDate()} ב${MONTHS[currentDate.getMonth()]}`
                    : `שבוע ${currentDate.getDate()} ב${MONTHS[currentDate.getMonth()]}`
                }
              </span>
              <button onClick={() => navigateDate(1)} className="nav-btn">
                <ChevronLeft size={20} />
              </button>
            </div>
          </div>

          <div className="view-toggle">
            <button
              className={`toggle-btn ${view === 'month' ? 'active' : ''}`}
              onClick={() => setView('month')}
            >
              חודש
            </button>
            <button
              className={`toggle-btn ${view === 'week' ? 'active' : ''}`}
              onClick={() => setView('week')}
            >
              שבוע
            </button>
            <button
              className={`toggle-btn ${view === 'day' ? 'active' : ''}`}
              onClick={() => setView('day')}
            >
              יום
            </button>
          </div>
        </div>
      </div>

      <div className="schedule-container card">
        {loading ? (
          <div className="loading-state">
            <div className="spinner"></div>
          </div>
        ) : (
          view === 'month' ? renderMonthView() : view === 'day' ? renderDayView() : renderWeekView()
        )}
      </div>

      {renderSlotModal()}

      {showTimeEntryModal && (
        <TimeEntryModal
          startTime={
            convertingSlot
              ? new Date(`${convertingSlot.date}T09:00:00`).toISOString()
              : timeEntryDate ? new Date(timeEntryDate.getFullYear(), timeEntryDate.getMonth(), timeEntryDate.getDate(), 9, 0, 0).toISOString() : undefined
          }
          endTime={
            convertingSlot
              ? new Date(new Date(`${convertingSlot.date}T09:00:00`).getTime() + convertingSlot.duration * 1000).toISOString()
              : timeEntryDate ? new Date(timeEntryDate.getFullYear(), timeEntryDate.getMonth(), timeEntryDate.getDate(), 10, 0, 0).toISOString() : undefined
          }
          durationSeconds={convertingSlot ? convertingSlot.duration : 3600}
          clientId={convertingSlot ? convertingSlot.client_id : undefined}
          projectId={convertingSlot ? convertingSlot.project_id : undefined}
          onSave={handleSaveTimeEntry}
          onClose={() => { setShowTimeEntryModal(false); setTimeEntryDate(null); setConvertingSlot(null); }}
        />
      )}
    </div>
  );
}

export default Schedule;
