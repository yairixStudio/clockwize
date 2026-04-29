import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Folder, Play, Pause, Square, Edit2, Trash2, ChevronDown, ChevronUp, Timer, Link2 } from 'lucide-react';
import { formatDurationHuman, formatDateTime, formatTimeOnly, calculateEndTime } from '../utils/format';
import { timerAPI } from '../services/api';
import './TimeEntryItem.css';

/**
 * Unified TimeEntryItem component for displaying time entries consistently
 * across all pages (ClientDetail, ProjectDetail, TaskDetail)
 * 
 * @param {Object} entry - The time entry object
 * @param {Object} timer - Current timer object if active (optional)
 * @param {boolean} showProject - Whether to show project link (default: false)
 * @param {boolean} showTask - Whether to show task link (default: true)
 * @param {Function} onTimerClick - Handler for timer play/pause button
 * @param {Function} onStopClick - Handler for timer stop button
 * @param {Function} onEditClick - Handler for edit button (optional)
 * @param {Function} onDeleteClick - Handler for delete button (optional)
 * @param {boolean} disabled - Whether timer controls are disabled
 */
function TimeEntryItem({
  entry,
  timer,
  showProject = false,
  showTask = true,
  onTimerClick,
  onStopClick,
  onEditClick,
  onDeleteClick,
  disabled = false
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [intervals, setIntervals] = useState([]);
  const [loadingIntervals, setLoadingIntervals] = useState(false);
  const [hasIntervals, setHasIntervals] = useState(false);

  // Load intervals on mount to check if entry has intervals
  useEffect(() => {
    const loadIntervals = async () => {
      try {
        const data = await timerAPI.getEntryIntervals(entry.id);
        if (data && data.length > 0) {
          setIntervals(data);
          setHasIntervals(true);
        }
      } catch (error) {
        // Silently fail - entry might not have intervals
        console.debug('No intervals found for entry:', entry.id);
      }
    };
    
    loadIntervals();
  }, [entry.id]);

  // Determine which times to display
  const firstInterval = intervals.length > 0 ? intervals[0] : null;
  const displayStartTime = firstInterval ? formatTimeOnly(firstInterval.start_time) : formatTimeOnly(entry.start_time);
  const displayEndTime = firstInterval && firstInterval.end_time 
    ? formatTimeOnly(firstInterval.end_time) 
    : formatTimeOnly(calculateEndTime(entry.start_time, entry.duration));

  const endTime = calculateEndTime(entry.start_time, entry.duration);
  const startTimeFormatted = formatTimeOnly(entry.start_time);
  const endTimeFormatted = formatTimeOnly(endTime);

  const handleToggleExpand = async (e) => {
    e.stopPropagation();
    
    if (!isExpanded && intervals.length === 0 && !hasIntervals) {
      // Load intervals on first expand if not already loaded
      setLoadingIntervals(true);
      try {
        const data = await timerAPI.getEntryIntervals(entry.id);
        setIntervals(data);
        setHasIntervals(data && data.length > 0);
      } catch (error) {
        console.error('Error loading intervals:', error);
      } finally {
        setLoadingIntervals(false);
      }
    }
    
    setIsExpanded(!isExpanded);
  };

  const timerBtn = timer ? {
    icon: timer.is_running ? <Pause size={16} /> : <Play size={16} />,
    className: timer.is_running ? 'btn-warning' : 'btn-success',
    title: timer.is_running ? 'השהה טיימר' : 'המשך טיימר'
  } : {
    icon: <Play size={16} />,
    className: 'btn-primary',
    title: 'התחל טיימר'
  };

  return (
    <div className={`time-entry-item-wrapper ${isExpanded ? 'expanded' : ''}`}>
      <div className="time-entry-item">
        {/* Expand button */}
        <button 
          className="time-entry-expand-btn"
          onClick={handleToggleExpand}
          title={isExpanded ? 'סגור פירוט' : 'הצג פירוט זמנים'}
        >
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        <div className="time-entry-item-content">
          {/* Duration and time range section */}
          <div className="time-entry-item-main">
            <div className="time-entry-item-duration-section">
              <span className="time-entry-item-duration ltr">
                {formatDurationHuman(entry.duration)}
              </span>
              <div className="time-entry-item-range ltr">
                <Clock size={14} />
                <span>{displayStartTime} - {displayEndTime}</span>
                {hasIntervals && intervals.length > 0 && (
                  <span className="intervals-indicator" title={`${intervals.length} קטע${intervals.length > 1 ? 'י' : ''} זמן`}>
                    <Timer size={12} />
                    <span>{intervals.length}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="time-entry-item-meta">
              <div className="time-entry-item-badges">
                {entry.is_manual === 1 && (
                  <span className="time-entry-badge manual" title="נוסף ידנית">✏️ ידני</span>
                )}
                {entry.is_edited === 1 && (
                  <span className="time-entry-badge edited" title="נערך">📝 נערך</span>
                )}
              </div>
              <span className="time-entry-item-date">
                {formatDateTime(entry.start_time)}
              </span>
            </div>
          </div>

          {/* Project and Task links */}
          <div className="time-entry-item-details">
            {showProject && entry.project_name && (
              <div className="time-entry-item-project">
                <Folder size={14} />
                פרויקט: <Link to={`/projects/${entry.project_id}`}>{entry.project_name}</Link>
              </div>
            )}
            {showTask && entry.task_name && (
              <div className="time-entry-item-task">
                משימה: <Link to={`/tasks/${entry.task_id}`} className="clickable-name">{entry.task_name}</Link>
                {entry.subtask_title && (
                  <span className="time-entry-item-subtask"> › {entry.subtask_title}</span>
                )}
              </div>
            )}
            
            {/* Additional Associations */}
            {entry.additional_associations && entry.additional_associations.length > 0 && (
              <div className="time-entry-item-associations">
                <Link2 size={12} />
                <span className="associations-label">גם:</span>
                {entry.additional_associations.map((assoc, index) => (
                  <span key={assoc.id} className="association-link">
                    {assoc.project_name && (
                      <Link to={`/projects/${assoc.project_id}`}>{assoc.project_name}</Link>
                    )}
                    {assoc.task_name && (
                      <>
                        {assoc.project_name && ' / '}
                        <Link to={`/tasks/${assoc.task_id}`}>{assoc.task_name}</Link>
                      </>
                    )}
                    {index < entry.additional_associations.length - 1 && ', '}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          {entry.notes && (
            <div className="time-entry-item-notes">{entry.notes}</div>
          )}
        </div>

        <div className="time-entry-item-actions">
          {onTimerClick && (
            <button
              onClick={onTimerClick}
              className={`btn ${timerBtn.className} btn-icon btn-sm`}
              title={timerBtn.title}
              disabled={disabled}
            >
              {timerBtn.icon}
            </button>
          )}
          {timer && onStopClick && (
            <button
              onClick={onStopClick}
              className="btn btn-error btn-icon btn-sm"
              title="עצור ושמור"
            >
              <Square size={16} />
            </button>
          )}
          {onEditClick && (
            <button
              onClick={(e) => { e.stopPropagation(); onEditClick(); }}
              className="btn btn-ghost btn-icon btn-sm"
              title="ערוך"
            >
              <Edit2 size={16} />
            </button>
          )}
          {onDeleteClick && (
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteClick(); }}
              className="btn btn-ghost btn-icon btn-sm"
              title="מחק"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Intervals Panel */}
      {isExpanded && (
        <div className="time-entry-intervals">
          <div className="intervals-header">
            <Timer size={14} />
            <span>פירוט זמנים</span>
          </div>
          
          {loadingIntervals ? (
            <div className="intervals-loading">
              <div className="spinner-small"></div>
              <span>טוען...</span>
            </div>
          ) : intervals.length === 0 ? (
            <div className="intervals-empty">
              <span>אין פירוט זמנים (רשומה ידנית)</span>
            </div>
          ) : (
            <div className="intervals-list">
              {intervals.map((interval, index) => {
                const intervalEnd = interval.end_time 
                  ? formatTimeOnly(interval.end_time) 
                  : 'פעיל';
                const intervalStart = formatTimeOnly(interval.start_time);
                const duration = interval.duration_seconds || 0;
                
                return (
                  <div key={interval.id} className="interval-item">
                    <span className="interval-number">{index + 1}</span>
                    <div className="interval-times ltr">
                      <span className="interval-start">{intervalStart}</span>
                      <span className="interval-separator">→</span>
                      <span className={`interval-end ${!interval.end_time ? 'active' : ''}`}>
                        {intervalEnd}
                      </span>
                    </div>
                    <span className="interval-duration ltr">
                      {formatDurationHuman(duration)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TimeEntryItem;
