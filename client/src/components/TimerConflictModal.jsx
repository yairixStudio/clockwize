import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import useStore from '../store/useStore';
import { formatDuration } from '../utils/format';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import './TimerConflictModal.css';

function TimerConflictModal({ onCancel, onContinue, onStopTimer, targetProject, targetTask }) {
  useBodyScrollLock(true);
  const { activeTimers, stopTimer } = useStore();
  const [selectedTimerId, setSelectedTimerId] = useState(null);
  const [notes, setNotes] = useState('');
  const [showNotesFor, setShowNotesFor] = useState(null);
  const [elapsed, setElapsed] = useState({});

  // Calculate elapsed time for each timer
  useEffect(() => {
    const calculateElapsed = () => {
      const newElapsed = {};
      activeTimers.forEach(timer => {
        let total = timer.accumulated_seconds || 0;
        if (timer.is_running) {
          const startTime = new Date(timer.start_time).getTime();
          total += Math.floor((Date.now() - startTime) / 1000);
        }
        newElapsed[timer.id] = total;
      });
      setElapsed(newElapsed);
    };

    calculateElapsed();
    const interval = setInterval(calculateElapsed, 1000);
    return () => clearInterval(interval);
  }, [activeTimers]);

  const handleStopAndStart = async (timer) => {
    setShowNotesFor(timer.id);
    setSelectedTimerId(timer.id);
  };

  const confirmStopAndStart = async () => {
    if (!selectedTimerId) return;
    try {
      await stopTimer(selectedTimerId, notes);
      onStopTimer();
    } catch (error) {
      console.error('Failed to stop timer:', error);
    }
  };

  if (showNotesFor) {
    const timer = activeTimers.find(t => t.id === showNotesFor);
    return createPortal(
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal timer-conflict-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h3 className="modal-title">עצירת טיימר והפעלת חדש</h3>
            <button onClick={onCancel} className="btn btn-ghost btn-icon">✕</button>
          </div>
          <div className="modal-body">
            <div className="stop-timer-summary">
              <p><strong>עוצר:</strong> {timer?.project_name}{timer?.task_name ? ` / ${timer.task_name}` : ''}</p>
              <p><strong>זמן:</strong> <span className="ltr">{formatDuration(elapsed[showNotesFor] || 0)}</span></p>
            </div>
            
            <div className="form-group">
              <label className="form-label">הערות לטיימר שנעצר (אופציונלי)</label>
              <textarea 
                className="form-input"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="מה עשית בזמן הזה?"
                rows={2}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button onClick={confirmStopAndStart} className="btn btn-primary">
              עצור והפעל חדש
            </button>
            <button onClick={() => { setShowNotesFor(null); setSelectedTimerId(null); }} className="btn btn-secondary">
              חזור
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal timer-conflict-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">⚠️ יש טיימרים פעילים</h3>
          <button onClick={onCancel} className="btn btn-ghost btn-icon">✕</button>
        </div>
        
        <div className="modal-body">
          <p className="conflict-message">
            יש לך {activeTimers.length} טיימר{activeTimers.length > 1 ? 'ים' : ''} פעיל{activeTimers.length > 1 ? 'ים' : ''} כרגע.
            האם להמשיך ולהפעיל טיימר נוסף ל<strong>{targetTask || targetProject}</strong>?
          </p>

          <div className="active-timers-preview">
            <h4>טיימרים פעילים:</h4>
            {activeTimers.map(timer => (
              <div key={timer.id} className={`timer-preview-item ${timer.is_running ? 'running' : 'paused'}`}>
                <div className="timer-preview-info">
                  <span className="timer-preview-name">
                    {timer.project_name}
                    {timer.task_name && <span className="timer-preview-task"> / {timer.task_name}</span>}
                  </span>
                  <span className={`timer-preview-time ltr ${timer.is_running ? 'running' : 'paused'}`}>
                    {formatDuration(elapsed[timer.id] || 0)}
                  </span>
                </div>
                <button 
                  onClick={() => handleStopAndStart(timer)}
                  className="btn btn-ghost btn-sm"
                  title="עצור טיימר זה והפעל חדש"
                >
                  ⏹ עצור
                </button>
              </div>
            ))}
          </div>
        </div>
        
        <div className="modal-footer conflict-footer">
          <button onClick={onContinue} className="btn btn-primary">
            הפעל בכל זאת
          </button>
          <button 
            onClick={() => handleStopAndStart(activeTimers[0])} 
            className="btn btn-warning"
          >
            עצור ושמור את הנוכחי והתחל את זה במקום
          </button>
          <button onClick={onCancel} className="btn btn-secondary">
            ביטול
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default TimerConflictModal;

