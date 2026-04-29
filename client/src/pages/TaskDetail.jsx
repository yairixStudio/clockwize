import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate, useOutletContext } from 'react-router-dom';
import { Plus, Play, Pause, Square, Edit2, Trash2, Clock, Bell, FileText, DollarSign, CreditCard, AlertCircle, CheckCircle2, CheckSquare, TrendingUp, Folder, StickyNote, ListChecks, ChevronDown, ChevronUp } from 'lucide-react';
import { clientsAPI, projectsAPI, tasksAPI, timerAPI, remindersAPI, filesAPI } from '../services/api';
import BreadcrumbItem from '../components/BreadcrumbItem';
import { formatDurationHuman, formatCurrency, formatDateTime, formatDate, formatTimeOnly, calculateEndTime } from '../utils/format';
import { getTaskStatus, TASK_STATUSES } from '../utils/status';
import useStore from '../store/useStore';
import { useModal } from '../components/Modal';
import TaskModal from '../components/TaskModal';
import TimeEntryModal from '../components/TimeEntryModal';
import TimeEntryItem from '../components/TimeEntryItem';
import ActiveTimerEntry from '../components/ActiveTimerEntry';
import TimerConflictModal from '../components/TimerConflictModal';
import SubtaskModal from '../components/SubtaskModal';
import RemindersModal from '../components/RemindersModal';
import ReminderItem from '../components/ReminderItem';
import '../pages/Reminders.css';
import Forum from '../components/Forum';
import NotesTab from '../components/NotesTab';
import FilesSection from '../components/FilesSection';
import TimeSummary from '../components/TimeSummary';
import './TaskDetail.css';
import '../styles/reminders-mini.css';
import { apps } from '../apps';

function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const outletContext = useOutletContext();
  const setStats = outletContext?.setStats;
  const modal = useModal();
  const { activeTimers, startTimer, pauseTimer, resumeTimer, stopTimer, getTimerForProject, integrations, isAddonEnabled } = useStore();

  const [task, setTask] = useState(null);
  const [timeEntries, setTimeEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [activeTab, setActiveTab] = useState('subtasks');
  const [showTimeEntryModal, setShowTimeEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [taskReminders, setTaskReminders] = useState([]);
  const [files, setFiles] = useState([]);
  const [showFullDescription, setShowFullDescription] = useState(false);

  // Timer conflict modal state
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [pendingTimerStart, setPendingTimerStart] = useState(null);

  // Stop timer modal state
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopNotes, setStopNotes] = useState('');
  const [stopStartDate, setStopStartDate] = useState('');
  const [stopStartTime, setStopStartTime] = useState('');
  const [stopEndDate, setStopEndDate] = useState('');
  const [stopEndTime, setStopEndTime] = useState('');

  // Subtask editing state
  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('');
  const [showSubtaskModal, setShowSubtaskModal] = useState(false);
  const [editingSubtask, setEditingSubtask] = useState(null);

  // Breadcrumb dropdown loaders
  const loadAllClients = useCallback(async () => {
    const clients = await clientsAPI.getAll();
    return clients.map(c => ({
      id: c.id,
      name: c.name,
      to: `/clients/${c.id}`
    }));
  }, []);

  const loadClientProjects = useCallback(async () => {
    if (!task?.client_id) return [];
    const projects = await projectsAPI.getAll(task.client_id);
    return projects.map(p => ({
      id: p.id,
      name: p.name,
      to: `/projects/${p.id}`
    }));
  }, [task?.client_id]);

  const loadProjectTasks = useCallback(async () => {
    if (!task?.project_id) return [];
    const tasks = await tasksAPI.getAll(task.project_id);
    return tasks.map(t => ({
      id: t.id,
      name: t.name,
      to: `/tasks/${t.id}`
    }));
  }, [task?.project_id]);

  const loadData = async () => {
    try {
      const [taskData, entriesData] = await Promise.all([
        tasksAPI.getOne(id),
        timerAPI.getEntries(null, id)
      ]);
      setTask(taskData);
      setTimeEntries(entriesData);
      
      // Load files separately
      let filesData = [];
      try {
        filesData = await filesAPI.getByTask(id);
      } catch (e) {
        console.warn('Failed to load files:', e);
      }
      setFiles(filesData);

      // Load reminders
      try {
        const allReminders = await remindersAPI.getAll({ include_read: 'true' });
        const relevantReminders = allReminders.filter(r =>
          r.association_type === 'task' && r.association_id === id
        );
        setTaskReminders(relevantReminders);
      } catch (e) {
        console.error('Error loading reminders:', e);
      }
    } catch (error) {
      console.error('Failed to load task:', error);
      navigate('/clients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleSaveSubtask = async (subtaskData) => {
    try {
      if (editingSubtask) {
        await tasksAPI.updateSubtask(editingSubtask.id, subtaskData);
        modal.success('תת-המשימה עודכנה בהצלחה');
      } else {
        await tasksAPI.addSubtask(id, subtaskData);
        modal.success('תת-המשימה נוספה בהצלחה');
      }
      loadData();
      setShowSubtaskModal(false);
      setEditingSubtask(null);
    } catch (error) {
      modal.error(error.message);
    }
  };

  // Calculate stats when task or timeEntries change
  const taskStatus = task ? getTaskStatus(task.status) : null;
  const totalTime = timeEntries.reduce((sum, e) => sum + (e.duration || 0), 0);
  
  // Determine effective pricing type (task's own or inherited from project)
  const effectivePricingType = task?.pricing_type || task?.project_pricing_type || 'hourly';
  const isNoCharge = effectivePricingType === 'no_charge';
  
  const hourlyRate = task?.hourly_rate || task?.project_hourly_rate || task?.client_hourly_rate || 250;
  const totalEarnings = isNoCharge ? 0 : (totalTime / 3600) * hourlyRate;
  const balance = totalEarnings - (task?.paid_amount || 0);

  useEffect(() => {
    if (task && setStats) {
      const effectiveRate = (totalTime / 3600) > 0 ? totalEarnings / (totalTime / 3600) : 0;
      setStats([
        { label: 'רשומות זמן', value: timeEntries.length, icon: <FileText size={20} /> },
        { label: 'שעות עבודה', value: formatDurationHuman(totalTime), icon: <Clock size={20} /> },
        { label: 'סה"כ לחיוב', value: formatCurrency(totalEarnings), icon: <DollarSign size={20} /> },
        { label: 'תעריף בפועל', value: `${formatCurrency(effectiveRate)}/שעה`, icon: <TrendingUp size={20} /> },
        { label: 'שולם', value: formatCurrency(task.paid_amount || 0), icon: <CreditCard size={20} /> },
        { label: 'יתרה לתשלום', value: formatCurrency(balance), icon: balance > 0 ? <AlertCircle size={20} /> : <CheckCircle2 size={20} /> }
      ]);
    }
  }, [task, timeEntries, setStats, totalTime, totalEarnings, balance]);

  // Get timer for current task
  const taskTimer = task ? getTimerForProject(task.project_id, id) : null;

  const handleUpdateTaskStatus = async (newStatus) => {
    try {
      await tasksAPI.update(id, { ...task, status: newStatus });
      loadData();
    } catch (error) {
      modal.error(error.message);
    }
  };
  
  const handleSaveTask = async (taskData) => {
    try {
      await tasksAPI.update(id, taskData);
      loadData();
      setShowTaskModal(false);
      modal.success('המשימה עודכנה בהצלחה');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDeleteTask = async () => {
    if (await modal.confirm('האם אתה בטוח שברצונך למחוק את המשימה?')) {
      try {
        await tasksAPI.delete(id);
        modal.success('המשימה נמחקה בהצלחה');
        navigate(`/projects/${task.project_id}`);
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  // Timer button click handler
  const handleTimerButtonClick = async () => {
    if (!task) return;

    if (taskTimer) {
      try {
        if (taskTimer.is_running) {
          await pauseTimer(taskTimer.id);
        } else {
          await resumeTimer(taskTimer.id);
        }
      } catch (error) {
        modal.error(error.message);
      }
      return;
    }

    if (activeTimers.length > 0) {
      setPendingTimerStart({ projectId: task.project_id, taskId: id });
      setShowConflictModal(true);
      return;
    }

    await doStartTimer(task.project_id, id);
  };

  const doStartTimer = async (projectId, taskId) => {
    try {
      await startTimer(projectId, taskId);
      modal.success('הטיימר הופעל!');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleConflictContinue = async () => {
    setShowConflictModal(false);
    if (pendingTimerStart) {
      await doStartTimer(pendingTimerStart.projectId, pendingTimerStart.taskId);
      setPendingTimerStart(null);
    }
  };

  const handleConflictStopTimer = async () => {
    setShowConflictModal(false);
    if (pendingTimerStart) {
      await doStartTimer(pendingTimerStart.projectId, pendingTimerStart.taskId);
      setPendingTimerStart(null);
    }
  };

  const handleStopTimerClick = () => {
    setStopNotes('');
    
    // Initialize start/end time fields based on timer data
    if (taskTimer) {
      // Get the first interval's start time or use timer's start time
      const timerStartTime = new Date(taskTimer.start_time);
      const now = new Date();
      
      // Calculate actual start based on accumulated time if paused
      let actualStart;
      if (taskTimer.is_running) {
        // Timer is running - use timer's start time minus accumulated time
        const accumulatedMs = (taskTimer.accumulated_seconds || 0) * 1000;
        actualStart = new Date(timerStartTime.getTime() - accumulatedMs);
      } else {
        // Timer is paused - work backwards from now using accumulated time
        const accumulatedMs = (taskTimer.accumulated_seconds || 0) * 1000;
        actualStart = new Date(now.getTime() - accumulatedMs);
      }
      
      // Format date as YYYY-MM-DD
      const formatDate = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      // Format time as HH:MM
      const formatTime = (d) => d.toTimeString().slice(0, 5);
      
      setStopStartDate(formatDate(actualStart));
      setStopStartTime(formatTime(actualStart));
      setStopEndDate(formatDate(now));
      setStopEndTime(formatTime(now));
    }
    
    setShowStopModal(true);
  };

  const handleStopTimer = async () => {
    if (!taskTimer) return;

    try {
      // Create intervals array with modified times if user changed them
      const startDateTime = new Date(`${stopStartDate}T${stopStartTime}:00`);
      const endDateTime = new Date(`${stopEndDate}T${stopEndTime}:00`);
      const durationSeconds = Math.max(0, Math.floor((endDateTime - startDateTime) / 1000));
      
      const intervals = [{
        start_time: startDateTime.toISOString(),
        end_time: endDateTime.toISOString(),
        duration_seconds: durationSeconds
      }];
      
      await stopTimer(taskTimer.id, stopNotes, intervals);
      setShowStopModal(false);
      setStopNotes('');
      modal.success('הזמן נשמר בהצלחה!');
      loadData();
    } catch (error) {
      modal.error('שגיאה בשמירת הזמן');
    }
  };

  const handleSaveTimeEntry = async (entryData) => {
    try {
      if (editingEntry) {
        await timerAPI.updateEntry(editingEntry.id, entryData);
        modal.success('הרשומה עודכנה בהצלחה');
      } else {
        await timerAPI.createEntry({
          ...entryData,
          project_id: task.project_id,
          task_id: id
        });
        modal.success('רשומת הזמן נוספה בהצלחה');
      }
      loadData();
      setShowTimeEntryModal(false);
      setEditingEntry(null);
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDeleteEntry = async (entryId) => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך למחוק את רשומת הזמן?',
      { title: 'מחיקת רשומה', confirmText: 'מחק', type: 'error' }
    );

    if (confirmed) {
      try {
        await timerAPI.deleteEntry(entryId);
        // Update state immediately for instant UI feedback
        setTimeEntries(prev => prev.filter(e => e.id !== entryId));
        // Reload data in background to ensure consistency
        loadData();
        modal.success('הרשומה נמחקה בהצלחה');
      } catch (error) {
        modal.error(error.message);
        // Reload data on error to restore correct state
        loadData();
      }
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  if (!task) {
    return <div className="page">משימה לא נמצאה</div>;
  }

  // Timer button state
  const getTimerButton = () => {
    if (taskTimer) {
      return {
        icon: taskTimer.is_running ? '⏸' : '▶',
        text: taskTimer.is_running ? 'השהה טיימר' : 'המשך טיימר',
        className: taskTimer.is_running ? 'btn-warning' : 'btn-success'
      };
    }
    return {
      icon: '▶',
      text: 'התחל טיימר',
      className: 'btn-primary'
    };
  };

  const timerBtn = getTimerButton();

  return (
    <div className="page fade-in">
      <div className="page-header-container">
        <div className="breadcrumb">
          <BreadcrumbItem
            label="לקוחות"
            to="/clients"
            onLoadItems={loadAllClients}
          />
          <span>/</span>
          <BreadcrumbItem
            label={task.client_name}
            to={`/clients/${task.client_id}`}
            currentId={task.client_id}
            onLoadItems={loadAllClients}
          />
          <span>/</span>
          <BreadcrumbItem
            label={task.project_name}
            to={`/projects/${task.project_id}`}
            currentId={task.project_id}
            onLoadItems={loadClientProjects}
          />
          <span>/</span>
          <BreadcrumbItem
            label={task.name}
            currentId={id}
            isCurrent={true}
            onLoadItems={loadProjectTasks}
            onRename={async (newName) => {
              await tasksAPI.update(id, { title: newName });
              loadData();
            }}
          />
        </div>

        {/* Time Summary */}
        <TimeSummary
          totalSeconds={totalTime}
          hourlyRate={!isNoCharge ? hourlyRate : 0}
          showEarnings={!isNoCharge}
          size="small"
        />

        <div className="header-actions">
          <span className={`badge ${taskStatus.badge} badge-sm badge-minimal`}>
            {taskStatus.label}
          </span>

          <div className="divider-vertical"></div>

          {/* Minimal Meta */}
          <div className="client-contact-minimal">
             <Link to={`/clients/${task.client_id}`} className="contact-item-mini" title={`לקוח: ${task.client_name}`}>
               <Folder size={14} />
               <span className="mobile-hide">{task.client_name}</span>
             </Link>
             <span className="contact-item-mini" title={`תעריף: ${formatCurrency(hourlyRate)}/שעה`}>
               <DollarSign size={14} />
             </span>
          </div>

          <div className="divider-vertical"></div>

          {/* Timer Actions */}
          <button
            onClick={handleTimerButtonClick}
            className={`btn btn-sm ${timerBtn.className}`}
            disabled={task.status === 'completed' || task.status === 'cancelled'}
            title={timerBtn.text}
          >
            {timerBtn.icon === '▶' ? <Play size={16} /> : <Pause size={16} />}
            <span className="mobile-hide">{timerBtn.text === 'התחל טיימר' ? 'טיימר' : timerBtn.text}</span>
          </button>

          {taskTimer && (
            <button
              onClick={handleStopTimerClick}
              className="btn btn-error btn-sm btn-icon"
              title="עצור ושמור"
            >
              <Square size={16} />
            </button>
          )}

          <div className="divider-vertical"></div>

          <button
            onClick={() => setShowTaskModal(true)}
            className="btn btn-secondary btn-sm"
            title="ערוך פרטים"
          >
            <Edit2 size={16} />
            <span className="mobile-hide">עריכה</span>
          </button>

          <button
            onClick={handleDeleteTask}
            className="btn btn-ghost btn-icon"
            title="מחק משימה"
          >
            <Trash2 size={22} />
          </button>

          {/* App Actions */}
          {apps.map(app => {
            const actions = app.actions || [];
            return actions
              .filter(action => action.location === 'task_detail' && (!action.condition || action.condition({ task, integrations })))
              .map((action, index) => {
                const Icon = action.icon;
                return (
                  <button
                    key={`${app.id}-${index}`}
                    onClick={() => action.onClick({ task })}
                    className="btn btn-ghost btn-sm"
                    title={action.label}
                  >
                    {Icon && <Icon size={16} />}
                  </button>
                );
              });
          })}
        </div>

        {/* Task Description */}
        {task.description && (
          <div className="project-description-container">
            <div className={`project-description ${showFullDescription ? 'expanded' : 'collapsed'}`}>
              {task.description}
            </div>
            {task.description.length > 150 && (
              <button 
                className="read-more-btn"
                onClick={() => setShowFullDescription(!showFullDescription)}
              >
                {showFullDescription ? (
                  <>
                    <ChevronUp size={14} />
                    <span>הסתר</span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} />
                    <span>קרא עוד</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Estimated vs Actual Hours */}
      {task.estimated_hours && (
        <div className="card" style={{ marginTop: '1rem', padding: '1.5rem' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              ⏱️ שעות משוערות מול בפועל
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>צפי</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>{task.estimated_hours.toFixed(1)} שעות</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>בפועל</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>{(totalTime / 3600).toFixed(1)} שעות</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>הפרש</div>
              <div style={{
                fontSize: '1.25rem',
                fontWeight: '600',
                color: (totalTime / 3600) <= task.estimated_hours ? 'var(--success)' : 'var(--error)'
              }}>
                {(totalTime / 3600 - task.estimated_hours).toFixed(1)} שעות
                {(totalTime / 3600) <= task.estimated_hours ? ' ✓' : ' ⚠️'}
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min((totalTime / 3600 / task.estimated_hours) * 100, 100)}%`,
                backgroundColor: (totalTime / 3600) <= task.estimated_hours ? 'var(--success)' : 'var(--error)',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            {((totalTime / 3600 / task.estimated_hours) * 100).toFixed(0)}% מהצפי
          </div>
        </div>
      )}

      {/* Notes Section */}
      {task.notes && (
        <div className="notes-section card">
          <div className="notes-header">
            <span className="notes-icon">📝</span>
            <h3>פתק פרטי</h3>
          </div>
          <div className="notes-content">{task.notes}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'subtasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('subtasks')}
        >
          <ListChecks size={16} />
          תת-משימות ({task.subtasks?.length || 0})
        </button>
        <button
          className={`tab ${activeTab === 'time' ? 'active' : ''}`}
          onClick={() => setActiveTab('time')}
        >
          <Clock size={16} />
          רשומות זמן ({timeEntries.length})
        </button>
        {isAddonEnabled('files') && (
          <button
            className={`tab ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            <FileText size={16} />
            קבצים ({files.length})
          </button>
        )}
        {isAddonEnabled('notes') && (
          <button
            className={`tab ${activeTab === 'notes' ? 'active' : ''}`}
            onClick={() => setActiveTab('notes')}
          >
            <StickyNote size={16} />
            פתקים
          </button>
        )}
        {isAddonEnabled('reminders') && (
          <button
            className={`tab ${activeTab === 'reminders' ? 'active' : ''}`}
            onClick={() => setActiveTab('reminders')}
          >
            <Bell size={16} />
            תזכורות ({taskReminders.length})
          </button>
        )}
      </div>

      {/* Subtasks Tab */}
      {activeTab === 'subtasks' && (
        <div className="tab-content">
          <div className="add-subtask-form">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const input = e.target.elements.subtaskTitle;
                if (!input.value.trim()) return;

                try {
                  await tasksAPI.addSubtask(id, input.value);
                  input.value = '';
                  loadData();
                } catch (error) {
                  modal.error(error.message);
                }
              }}
              className="flex gap-2"
            >
              <input
                name="subtaskTitle"
                type="text"
                placeholder="הוסף תת-משימה..."
                className="form-input flex-1"
              />
              <button type="submit" className="btn btn-secondary btn-sm">
                <Plus size={16} />
                הוסף
              </button>
            </form>
          </div>

          <div className="subtasks-list">
            {task.subtasks && task.subtasks.map(subtask => {
              const isEditing = editingSubtaskId === subtask.id;
              
              const handleStartEdit = () => {
                setEditingSubtaskId(subtask.id);
                setEditingSubtaskTitle(subtask.title);
              };

              const handleSaveEdit = async (newTitle) => {
                const trimmedTitle = newTitle.trim();
                
                // Close edit mode first
                setEditingSubtaskId(null);
                setEditingSubtaskTitle('');
                
                if (!trimmedTitle) {
                  modal.error('כותרת תת-המשימה לא יכולה להיות ריקה');
                  return;
                }

                if (trimmedTitle === subtask.title) {
                  return; // No change
                }

                try {
                  await tasksAPI.updateSubtask(subtask.id, { title: trimmedTitle });
                  loadData();
                } catch (error) {
                  modal.error(error.message);
                }
              };

              const handleCancelEdit = () => {
                setEditingSubtaskId(null);
                setEditingSubtaskTitle('');
              };

              const handleKeyDown = (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveEdit(editingSubtaskTitle);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelEdit();
                }
              };

              const handleBlur = () => {
                handleSaveEdit(editingSubtaskTitle);
              };

              return (
                <div key={subtask.id} className={`subtask-item ${subtask.is_completed ? 'completed' : ''}`}>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={!!subtask.is_completed}
                      onChange={async (e) => {
                        try {
                          await tasksAPI.updateSubtask(subtask.id, { is_completed: e.target.checked });
                          loadData();
                        } catch (error) {
                          modal.error(error.message);
                        }
                      }}
                      disabled={isEditing}
                    />
                    <span className="checkmark"></span>
                    {isEditing ? (
                      <input
                        type="text"
                        className="subtask-title-input"
                        value={editingSubtaskTitle}
                        onChange={(e) => setEditingSubtaskTitle(e.target.value)}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="subtask-content">
                        <span
                          className="subtask-title"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit();
                          }}
                          title="לחץ לעריכה"
                        >
                          {subtask.title}
                        </span>
                        <div className="subtask-meta">
                          {subtask.due_date && (
                            <span className="subtask-due-date">📅 {formatDate(subtask.due_date)}</span>
                          )}
                          {subtask.priority && subtask.priority !== 'normal' && (
                            <span className={`subtask-priority priority-${subtask.priority}`}>
                              {subtask.priority === 'high' ? '🔼' : '🔽'}
                            </span>
                          )}
                          {subtask.description && <span title={subtask.description}>📝</span>}
                          {!subtask.due_date && !subtask.description && subtask.created_at && (
                            <span className="subtask-created-at">{formatDate(subtask.created_at)}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </label>
                  {!isEditing && (
                    <div className="subtask-actions">
                      <button
                        onClick={() => {
                          setEditingSubtask(subtask);
                          setShowSubtaskModal(true);
                        }}
                        className="btn btn-ghost btn-icon btn-sm edit-subtask"
                        title="ערוך תת-משימה"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={async () => {
                          if (await modal.confirm('האם למחוק את תת-המשימה?')) {
                            try {
                              await tasksAPI.deleteSubtask(subtask.id);
                              loadData();
                            } catch (error) {
                              modal.error(error.message);
                            }
                          }
                        }}
                        className="btn btn-ghost btn-icon btn-sm delete-subtask"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Time Entries Tab */}
      {activeTab === 'time' && (
        <div className="tab-content">
          <div className="time-entries-list">
            {/* New Time Entry Button - List Style */}
            <button
              onClick={() => setShowTimeEntryModal(true)}
              className="list-item new-entry-list-item"
            >
              <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
              <span style={{ fontWeight: 500 }}>צור רשומת זמן חדשה</span>
            </button>

            {/* Active Timer for this task */}
            {taskTimer && (
              <ActiveTimerEntry
                timer={taskTimer}
                showProject={false}
                showTask={false}
                onPause={() => pauseTimer(taskTimer.id)}
                onResume={() => resumeTimer(taskTimer.id)}
                onStop={handleStopTimerClick}
              />
            )}

            {timeEntries.length === 0 && !taskTimer ? (
              <div className="empty-state-inline">
                <Clock size={24} strokeWidth={1.5} />
                <span>עדיין אין רשומות זמן</span>
              </div>
            ) : (
              timeEntries.map(entry => {
                const entryTimer = getTimerForProject(task.project_id, id);

                return (
                  <TimeEntryItem
                    key={entry.id}
                    entry={entry}
                    timer={entryTimer}
                    showProject={false}
                    showTask={false}
                    onTimerClick={handleTimerButtonClick}
                    onStopClick={entryTimer ? handleStopTimerClick : null}
                    onEditClick={() => { setEditingEntry(entry); setShowTimeEntryModal(true); }}
                    onDeleteClick={() => handleDeleteEntry(entry.id)}
                    disabled={task.status === 'completed' || task.status === 'cancelled'}
                  />
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Files Tab */}
      {activeTab === 'files' && isAddonEnabled('files') && (
        <div className="tab-content">
          <FilesSection
            entityType="task"
            entityId={id}
            files={files}
            onFilesChange={loadData}
          />
        </div>
      )}

      {/* Notes Tab */}
      {activeTab === 'notes' && isAddonEnabled('notes') && (
        <div className="tab-content">
           <NotesTab entityType="task" entityId={id} />
        </div>
      )}

      {/* Reminders Tab */}
      {activeTab === 'reminders' && isAddonEnabled('reminders') && (
        <div className="tab-content">
          <div className="reminders-list">
            {/* New Reminder Button - List Style */}
            <button
              onClick={() => setShowReminderModal(true)}
              className="list-item new-reminder-list-item"
            >
              <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
              <span style={{ fontWeight: 500 }}>צור תזכורת חדשה</span>
            </button>

          {taskReminders.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-state-icon">
                <Bell size={48} strokeWidth={1.5} />
              </div>
              <h3 className="empty-state-title">עדיין אין תזכורות</h3>
              <p>הוסף תזכורות כדי לא לשכוח משימות חשובות</p>
            </div>
          ) : (
              taskReminders.map(reminder => (
                <ReminderItem 
                  key={reminder.id} 
                  reminder={reminder} 
                  onUpdate={loadData}
                />
              ))
          )}
          </div>
        </div>
      )}

      {showSubtaskModal && (
        <SubtaskModal
          subtask={editingSubtask}
          onSave={handleSaveSubtask}
          onClose={() => { setShowSubtaskModal(false); setEditingSubtask(null); }}
        />
      )}

      {showTaskModal && (
        <TaskModal
          task={task}
          projectHourlyRate={task.project_hourly_rate || task.client_hourly_rate}
          projectPricingType={task.project_pricing_type}
          onSave={handleSaveTask}
          onClose={() => setShowTaskModal(false)}
        />
      )}

      {showConflictModal && (
        <TimerConflictModal
          targetProject={task.project_name}
          targetTask={task.name}
          onCancel={() => { setShowConflictModal(false); setPendingTimerStart(null); }}
          onContinue={handleConflictContinue}
          onStopTimer={handleConflictStopTimer}
        />
      )}

      {showTimeEntryModal && (
        <TimeEntryModal
          entry={editingEntry}
          projectId={task.project_id}
          taskId={id}
          onSave={handleSaveTimeEntry}
          onClose={() => { setShowTimeEntryModal(false); setEditingEntry(null); }}
        />
      )}

      {showReminderModal && (
        <RemindersModal
          isOpen={showReminderModal}
          onClose={() => setShowReminderModal(false)}
          initialAssociation={{ type: 'task', id: id, clientId: task.client_id, projectId: task.project_id }}
        />
      )}

      {showStopModal && taskTimer && createPortal(
        <div className="modal-overlay" onClick={() => setShowStopModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">שמירת זמן עבודה</h3>
              <button onClick={() => setShowStopModal(false)} className="btn btn-ghost btn-icon">✕</button>
            </div>
            <div className="modal-body">
              <div className="stop-summary">
                <p>פרויקט: <Link to={`/projects/${task.project_id}`} className="clickable-name">{task.project_name}</Link></p>
                <p>משימה: {task.name}</p>
              </div>

              <div className="time-range-section">
                <div className="time-range-row">
                  <div className="form-group">
                    <label className="form-label">תאריך התחלה</label>
                    <input
                      type="date"
                      className="form-input"
                      value={stopStartDate}
                      onChange={e => setStopStartDate(e.target.value)}
                      dir="ltr"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">שעה</label>
                    <input
                      type="time"
                      className="form-input"
                      value={stopStartTime}
                      onChange={e => setStopStartTime(e.target.value)}
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="time-range-row">
                  <div className="form-group">
                    <label className="form-label">תאריך סיום</label>
                    <input
                      type="date"
                      className="form-input"
                      value={stopEndDate}
                      onChange={e => setStopEndDate(e.target.value)}
                      dir="ltr"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">שעה</label>
                    <input
                      type="time"
                      className="form-input"
                      value={stopEndTime}
                      onChange={e => setStopEndTime(e.target.value)}
                      dir="ltr"
                    />
                  </div>
                </div>

                {stopStartDate && stopStartTime && stopEndDate && stopEndTime && (
                  <div className="calculated-duration">
                    <span>משך זמן מחושב: </span>
                    <strong className="ltr">
                      {formatDurationHuman(
                        Math.max(0, Math.floor(
                          (new Date(`${stopEndDate}T${stopEndTime}:00`) - new Date(`${stopStartDate}T${stopStartTime}:00`)) / 1000
                        ))
                      )}
                    </strong>
                  </div>
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

      <Forum
        entityType="task"
        entityId={id}
      />
    </div>
  );
}

export default TaskDetail;
