import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Folder, Play, Pause, Square, Timer } from 'lucide-react';
import { formatDuration, formatDurationHuman, formatTimeOnly } from '../utils/format';
import './ActiveTimerEntry.css';

/**
 * Component to display an active (running) timer in the time entries list
 * Shows real-time elapsed time with visual indication that it's still running
 */
function ActiveTimerEntry({
  timer,
  showProject = false,
  showTask = true,
  onPause,
  onResume,
  onStop
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const calculateElapsed = () => {
      let total = timer.accumulated_seconds || 0;
      if (timer.is_running && timer.start_time) {
        const startTime = new Date(timer.start_time).getTime();
        total += Math.floor((Date.now() - startTime) / 1000);
      }
      return total;
    };

    setElapsed(calculateElapsed());

    // Update every second if running
    if (timer.is_running) {
      const interval = setInterval(() => {
        setElapsed(calculateElapsed());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const startTimeStr = timer.start_time ? formatTimeOnly(timer.start_time) : '--:--';

  return (
    <div className={`active-timer-entry ${timer.is_running ? 'running' : 'paused'}`}>
      <div className="active-timer-entry-indicator">
        <div className="pulse-dot"></div>
        <span>{timer.is_running ? 'פעיל' : 'מושהה'}</span>
      </div>

      <div className="active-timer-entry-content">
        <div className="active-timer-entry-main">
          <div className="active-timer-entry-duration-section">
            <span className="active-timer-entry-duration ltr">
              {formatDuration(elapsed)}
            </span>
            <div className="active-timer-entry-range ltr">
              <Clock size={14} />
              <span>{startTimeStr} - עכשיו</span>
              <Timer size={12} className="timer-icon-animated" />
            </div>
          </div>
        </div>

        {/* Project and Task links */}
        <div className="active-timer-entry-details">
          {showProject && timer.project_name && (
            <div className="active-timer-entry-project">
              <Folder size={14} />
              פרויקט: <Link to={`/projects/${timer.project_id}`}>{timer.project_name}</Link>
            </div>
          )}
          {showTask && timer.task_name && (
            <div className="active-timer-entry-task">
              משימה: <Link to={`/tasks/${timer.task_id}`} className="clickable-name">{timer.task_name}</Link>
            </div>
          )}
        </div>
      </div>

      <div className="active-timer-entry-actions">
        {timer.is_running ? (
          <button
            onClick={onPause}
            className="btn btn-warning btn-icon btn-sm"
            title="השהה"
          >
            <Pause size={16} />
          </button>
        ) : (
          <button
            onClick={onResume}
            className="btn btn-success btn-icon btn-sm"
            title="המשך"
          >
            <Play size={16} />
          </button>
        )}
        <button
          onClick={onStop}
          className="btn btn-error btn-icon btn-sm"
          title="עצור ושמור"
        >
          <Square size={16} />
        </button>
      </div>
    </div>
  );
}

export default ActiveTimerEntry;
