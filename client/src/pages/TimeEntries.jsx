import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Clock, Calendar, Folder, Tag, Search, Filter, Play, Pause, Square, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { timerAPI } from '../services/api';
import { formatDurationHuman, formatDate } from '../utils/format';
import useStore from '../store/useStore';
import { useModal } from '../components/Modal';
import TimerConflictModal from '../components/TimerConflictModal';
import TimeEntryModal from '../components/TimeEntryModal';
import './TimeEntries.css';

// Component to display intervals for a time entry
function IntervalsDisplay({ entryId }) {
  const [intervals, setIntervals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadIntervals();
  }, [entryId]);

  const loadIntervals = async () => {
    try {
      const data = await timerAPI.getEntryIntervals(entryId);
      setIntervals(data);
    } catch (error) {
      console.error('Failed to load intervals:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="intervals-loading">טוען אינטרוולים...</div>;
  }

  if (intervals.length === 0) {
    return <div className="intervals-empty">אין אינטרוולים (רשומה ידנית או ישנה)</div>;
  }

  const formatTime = (dateStr) => {
    return new Date(dateStr).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="intervals-list">
      <div className="intervals-header">
        <span className="intervals-title">אינטרוולים ({intervals.length})</span>
      </div>
      <div className="intervals-items">
        {intervals.map((interval, index) => (
          <div key={interval.id} className="interval-item">
            <span className="interval-number">{index + 1}</span>
            <span className="interval-time ltr">
              {formatTime(interval.start_time)} - {interval.end_time ? formatTime(interval.end_time) : '...'}
            </span>
            <span className="interval-duration">
              {formatDurationHuman(interval.duration_seconds || 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeEntries() {
  const { activeTimers, startTimer, pauseTimer, resumeTimer, stopTimer, getTimerForProject } = useStore();
  const modal = useModal();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Timer conflict modal state
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [pendingTimerStart, setPendingTimerStart] = useState(null);

  // Stop timer modal state
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopNotes, setStopNotes] = useState('');
  const [stoppingTimer, setStoppingTimer] = useState(null);

  // Time entry modal state
  const [showTimeEntryModal, setShowTimeEntryModal] = useState(false);

  // Expanded rows state (for showing intervals)
  const [expandedEntries, setExpandedEntries] = useState(new Set());

  const toggleExpanded = (entryId) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    try {
      const data = await timerAPI.getEntries();
      setEntries(data);
    } catch (error) {
      console.error('Failed to load time entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTimeEntry = async (entryData) => {
    try {
      await timerAPI.createEntry(entryData);
      loadEntries();
      setShowTimeEntryModal(false);
      modal.success('רשומת הזמן נוספה בהצלחה');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const filteredEntries = entries.filter(entry => 
    entry.project_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.task_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.notes?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Timer button click handler
  const handleTimerButtonClick = async (entry) => {
    const existingTimer = entry.task_id
      ? getTimerForProject(entry.project_id, entry.task_id)
      : getTimerForProject(entry.project_id, null);

    // If there's already a timer for this project/task, toggle pause/resume
    if (existingTimer) {
      try {
        if (existingTimer.is_running) {
          await pauseTimer(existingTimer.id);
        } else {
          await resumeTimer(existingTimer.id);
        }
      } catch (error) {
        modal.error(error.message);
      }
      return;
    }

    // Check if there are other active timers
    if (activeTimers.length > 0) {
      setPendingTimerStart({ 
        projectId: entry.project_id, 
        taskId: entry.task_id,
        projectName: entry.project_name,
        taskName: entry.task_name
      });
      setShowConflictModal(true);
      return;
    }

    // No conflicts, start timer directly
    await doStartTimer(entry.project_id, entry.task_id);
  };

  // Actually start the timer
  const doStartTimer = async (projectId, taskId) => {
    try {
      await startTimer(projectId, taskId || null);
      modal.success('הטיימר הופעל!');
      loadEntries();
    } catch (error) {
      modal.error(error.message);
    }
  };

  // Handle continue from conflict modal
  const handleConflictContinue = async () => {
    setShowConflictModal(false);
    if (pendingTimerStart) {
      await doStartTimer(pendingTimerStart.projectId, pendingTimerStart.taskId);
      setPendingTimerStart(null);
    }
  };

  // Handle stop timer from conflict modal
  const handleConflictStopTimer = async () => {
    setShowConflictModal(false);
    if (pendingTimerStart) {
      await doStartTimer(pendingTimerStart.projectId, pendingTimerStart.taskId);
      setPendingTimerStart(null);
    }
  };

  const handleStopTimerClick = (timer, entry) => {
    setStoppingTimer({ 
      ...timer, 
      projectName: entry.project_name,
      taskName: entry.task_name
    });
    setStopNotes('');
    setShowStopModal(true);
  };

  const handleStopTimer = async () => {
    if (!stoppingTimer) return;
    
    try {
      await stopTimer(stoppingTimer.id, stopNotes);
      setShowStopModal(false);
      setStopNotes('');
      setStoppingTimer(null);
      modal.success('הזמן נשמר בהצלחה!');
      loadEntries();
    } catch (error) {
      modal.error('שגיאה בשמירת הזמן');
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">יומן שעות</h1>
          <p className="page-subtitle">היסטוריית עבודה וזמנים</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            className="form-input search-input"
            placeholder="חיפוש לפי פרויקט, משימה או הערות..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <button onClick={() => setShowTimeEntryModal(true)} className="btn btn-primary">
          <Plus size={18} />
          <span>הוסף רשומת זמן</span>
        </button>
      </div>

      <div className="entries-list card">
        {filteredEntries.length === 0 ? (
          <div className="empty-state">
            <Clock size={48} strokeWidth={1.5} />
            <p>לא נמצאו רשומות זמן</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>פרויקט / משימה</th>
                  <th>תאריך</th>
                  <th>משך זמן</th>
                  <th>הערות</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map(entry => {
                  const entryTimer = entry.task_id
                    ? getTimerForProject(entry.project_id, entry.task_id)
                    : getTimerForProject(entry.project_id, null);
                  
                  const timerBtn = entryTimer ? {
                    icon: entryTimer.is_running ? '⏸' : '▶',
                    className: entryTimer.is_running ? 'btn-warning' : 'btn-success',
                    title: entryTimer.is_running ? 'השהה טיימר' : 'המשך טיימר'
                  } : {
                    icon: '▶',
                    className: 'btn-primary',
                    title: 'התחל טיימר'
                  };

                  const isExpanded = expandedEntries.has(entry.id);

                  return (
                    <>
                      <tr key={entry.id} className={isExpanded ? 'expanded-row' : ''}>
                        <td>
                          <div className="entry-project">
                            <button
                              onClick={() => toggleExpanded(entry.id)}
                              className="expand-btn"
                              title={isExpanded ? 'הסתר אינטרוולים' : 'הצג אינטרוולים'}
                            >
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                            <div>
                              <div className="project-name">
                                <Folder size={14} />
                                <Link to={`/projects/${entry.project_id}`} className="clickable-name">
                                  {entry.project_name}
                                </Link>
                              </div>
                              {entry.task_name && (
                                <div className="task-name">
                                  <Tag size={12} />
                                  <Link to={`/tasks/${entry.task_id}`} className="clickable-name">
                                    {entry.task_name}
                                  </Link>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="entry-date">
                            <Calendar size={14} />
                            {formatDate(entry.start_time)}
                          </div>
                          <div className="entry-time text-muted">
                            {new Date(entry.start_time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} - 
                            {entry.end_time ? new Date(entry.end_time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '...'}
                          </div>
                        </td>
                        <td className="font-mono font-medium">
                          {formatDurationHuman(entry.duration)}
                        </td>
                        <td className="entry-notes">
                          {entry.notes || '-'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <button
                              onClick={() => handleTimerButtonClick(entry)}
                              className={`btn ${timerBtn.className} btn-icon btn-sm`}
                              title={timerBtn.title}
                            >
                              {timerBtn.icon === '▶' ? <Play size={16} /> : <Pause size={16} />}
                            </button>
                            {entryTimer && (
                              <button
                                onClick={() => handleStopTimerClick(entryTimer, entry)}
                                className="btn btn-error btn-icon btn-sm"
                                title="עצור ושמור"
                              >
                                <Square size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${entry.id}-intervals`} className="intervals-row">
                          <td colSpan={5}>
                            <IntervalsDisplay entryId={entry.id} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showConflictModal && (
        <TimerConflictModal
          targetProject={pendingTimerStart?.projectName}
          targetTask={pendingTimerStart?.taskName}
          onCancel={() => { setShowConflictModal(false); setPendingTimerStart(null); }}
          onContinue={handleConflictContinue}
          onStopTimer={handleConflictStopTimer}
        />
      )}

      {showStopModal && stoppingTimer && createPortal(
        <div className="modal-overlay" onClick={() => setShowStopModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">שמירת זמן עבודה</h3>
              <button onClick={() => setShowStopModal(false)} className="btn btn-ghost btn-icon">✕</button>
            </div>
            <div className="modal-body">
              <div className="stop-summary">
                <p>זמן מצטבר: <strong className="ltr">{formatDurationHuman(
                  stoppingTimer.is_running
                    ? (stoppingTimer.accumulated_seconds || 0) + Math.floor((Date.now() - new Date(stoppingTimer.start_time).getTime()) / 1000)
                    : (stoppingTimer.accumulated_seconds || 0)
                )}</strong></p>
                <p>פרויקט: <Link to={`/projects/${stoppingTimer.project_id}`} className="clickable-name">{stoppingTimer.projectName}</Link></p>
                {stoppingTimer.taskName && (
                  <p>משימה: <Link to={`/tasks/${stoppingTimer.task_id}`} className="clickable-name">{stoppingTimer.taskName}</Link></p>
                )}
              </div>
              
              <div className="form-group">
                <label className="form-label">הערות (אופציונלי)</label>
                <textarea 
                  className="form-input"
                  value={stopNotes}
                  onChange={e => setStopNotes(e.target.value)}
                  placeholder="מה עשית בזמן הזה?"
                  rows={3}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={handleStopTimer} className="btn btn-primary">
                שמור
              </button>
              <button onClick={() => setShowStopModal(false)} className="btn btn-secondary">
                ביטול
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showTimeEntryModal && (
        <TimeEntryModal
          onSave={handleSaveTimeEntry}
          onClose={() => setShowTimeEntryModal(false)}
        />
      )}
    </div>
  );
}

export default TimeEntries;

