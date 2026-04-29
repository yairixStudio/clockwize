import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowRight, Edit, Trash2, UserCheck, Mail, Phone, Building2,
  Calendar, DollarSign, Tag, Clock, CheckCircle, XCircle,
  Bell, Plus, Check, X, Play, Square, ListTodo, Timer, Briefcase, CalendarClock
} from 'lucide-react';
import { leadsAPI, timerAPI } from '../services/api';
import { useModal } from '../components/Modal';
import useStore from '../store/useStore';
import LeadStatusBadge from '../components/LeadStatusBadge';
import LeadPriorityBadge from '../components/LeadPriorityBadge';
import LeadActivityTimeline from '../components/LeadActivityTimeline';
import LeadConvertModal from '../components/LeadConvertModal';
import LeadModal from '../components/LeadModal';
import { getSourceType, LEAD_STATUSES } from '../utils/leadStatus';
import './LeadDetail.css';

function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const modal = useModal();
  const { activeTimers, startTimer, stopTimer, pauseTimer, resumeTimer, loadActiveTimers } = useStore();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [reminderContent, setReminderContent] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [activeTab, setActiveTab] = useState('info'); // info, tasks, time

  useEffect(() => {
    loadLead();
  }, [id]);

  const loadLead = async () => {
    try {
      setLoading(true);
      const data = await leadsAPI.getOne(id);
      setLead(data);
    } catch (error) {
      console.error('Failed to load lead:', error);
      modal.error('שגיאה בטעינת ליד');
    } finally {
      setLoading(false);
    }
  };

  const handleAddActivity = async (data) => {
    try {
      await leadsAPI.addActivity(id, data);
      loadLead();
    } catch (error) {
      console.error('Failed to add activity:', error);
      modal.error('שגיאה בהוספת פעילות');
    }
  };

  const handleDeleteActivity = async (activityId) => {
    try {
      await leadsAPI.deleteActivity(id, activityId);
      loadLead();
    } catch (error) {
      console.error('Failed to delete activity:', error);
      modal.error('שגיאה במחיקת פעילות');
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      await leadsAPI.updateStatus(id, newStatus);
      loadLead();
    } catch (error) {
      console.error('Failed to update status:', error);
      modal.error('שגיאה בעדכון סטטוס');
    }
  };

  const handleDelete = async () => {
    const taskCount = (lead.tasks || []).length;
    const timeCount = (lead.timeEntries || []).length;
    const warning = taskCount || timeCount
      ? `למחוק את הליד "${lead.name}"?\nזה ימחק גם ${taskCount} משימות ו-${timeCount} רשומות זמן.`
      : `למחוק את הליד "${lead.name}"?`;
    if (!confirm(warning)) return;
    try {
      await leadsAPI.delete(id);
      modal.success('ליד נמחק');
      navigate('/leads');
    } catch (error) {
      console.error('Failed to delete lead:', error);
      modal.error('שגיאה במחיקת ליד');
    }
  };

  const handleAddReminder = async () => {
    if (!reminderContent.trim() || !reminderDate) return;
    try {
      await leadsAPI.addReminder(id, { content: reminderContent, due_date: reminderDate });
      setReminderContent('');
      setReminderDate('');
      setShowReminderForm(false);
      loadLead();
      modal.success('תזכורת נוספה');
    } catch (error) {
      console.error('Failed to add reminder:', error);
      modal.error('שגיאה בהוספת תזכורת');
    }
  };

  const handleToggleReminder = async (reminder) => {
    try {
      await leadsAPI.updateReminder(id, reminder.id, { is_completed: reminder.is_completed ? 0 : 1 });
      loadLead();
    } catch (error) {
      console.error('Failed to toggle reminder:', error);
    }
  };

  const handleDeleteReminder = async (reminderId) => {
    try {
      await leadsAPI.deleteReminder(id, reminderId);
      loadLead();
    } catch (error) {
      console.error('Failed to delete reminder:', error);
    }
  };

  // Tasks
  const handleAddTask = async () => {
    if (!newTaskName.trim()) return;
    try {
      await leadsAPI.createTask(id, { name: newTaskName, description: newTaskDescription });
      setNewTaskName('');
      setNewTaskDescription('');
      setShowTaskForm(false);
      loadLead();
      modal.success('משימה נוספה');
    } catch (error) {
      console.error('Failed to create task:', error);
      modal.error('שגיאה ביצירת משימה');
    }
  };

  // Timer
  const handleStartTimer = async (taskId) => {
    try {
      const { project_id } = await leadsAPI.ensureProject(id);
      await startTimer(project_id, taskId || null);
      modal.success('טיימר הופעל');
    } catch (error) {
      console.error('Failed to start timer:', error);
      modal.error(error.message || 'שגיאה בהפעלת טיימר');
    }
  };

  const handleStopTimer = async (timerId) => {
    try {
      await stopTimer(timerId);
      loadLead();
      modal.success('טיימר נעצר');
    } catch (error) {
      console.error('Failed to stop timer:', error);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  // Find active timer for this lead's project
  const getLeadTimer = () => {
    if (!lead?.internal_project_id) return null;
    return activeTimers.find(t => t.project_id === lead.internal_project_id);
  };

  if (loading) {
    return (
      <div className="page fade-in lead-detail-page">
        <div className="loading"><div className="spinner"></div></div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="page fade-in lead-detail-page">
        <p>ליד לא נמצא</p>
        <Link to="/leads">חזרה לרשימה</Link>
      </div>
    );
  }

  const tags = lead.tags ? (typeof lead.tags === 'string' ? JSON.parse(lead.tags) : lead.tags) : [];
  const isConverted = !!lead.converted_client_id;
  const tasks = lead.tasks || [];
  const timeEntries = lead.timeEntries || [];
  const totalTimeInvested = lead.totalTimeInvested || 0;
  const leadTimer = getLeadTimer();

  return (
    <div className="page fade-in lead-detail-page">
      {/* Header */}
      <div className="lead-detail-header">
        <div className="lead-detail-header-right">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/leads')}>
            <ArrowRight size={16} />
            חזרה
          </button>
          <div className="lead-detail-title-area">
            <h1>{lead.name}</h1>
            <div className="lead-detail-badges">
              <LeadStatusBadge status={lead.status} />
              <LeadPriorityBadge priority={lead.priority} />
              {lead.is_opportunity ? (
                <span className="lead-badge-opportunity">
                  <Briefcase size={12} /> הזדמנות
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="lead-detail-actions">
          {!isConverted && lead.status !== 'lost' && (
            <>
              <select
                className="form-input form-input-sm lead-status-select"
                value={lead.status}
                onChange={(e) => handleStatusChange(e.target.value)}
              >
                {LEAD_STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => setShowConvertModal(true)}>
                <CheckCircle size={16} />
                {lead.is_opportunity || lead.client_id ? 'המר לפרויקט' : 'המר ללקוח'}
              </button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowEditModal(true)}>
            <Edit size={16} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleDelete} style={{ color: 'var(--error)' }}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Converted Banner */}
      {isConverted && (
        <div className="lead-converted-banner">
          <CheckCircle size={20} />
          <span>ליד זה הומר ללקוח </span>
          <Link to={`/clients/${lead.converted_client_id}`} className="lead-converted-link">
            {lead.converted_client_name || 'צפה בלקוח'}
          </Link>
          {lead.converted_at && (
            <span className="lead-converted-date">
              ({new Date(lead.converted_at).toLocaleDateString('he-IL')})
            </span>
          )}
        </div>
      )}

      {/* Opportunity Client Link */}
      {lead.opportunity_client_name && !isConverted && (
        <div className="lead-opportunity-banner">
          <Building2 size={16} />
          <span>הזדמנות מלקוח: </span>
          <Link to={`/clients/${lead.client_id}`} className="lead-converted-link">
            {lead.opportunity_client_name}
          </Link>
        </div>
      )}

      {/* Time invested summary */}
      {totalTimeInvested > 0 && (
        <div className="lead-time-summary">
          <Timer size={16} />
          <span>זמן שהושקע: <strong>{formatDuration(totalTimeInvested)}</strong></span>
          <span className="lead-time-summary-detail">({tasks.length} משימות, {timeEntries.length} רשומות זמן)</span>
        </div>
      )}

      {/* Tabs */}
      <div className="lead-detail-tabs">
        <button
          className={`lead-tab ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => setActiveTab('info')}
        >
          פרטים
        </button>
        <button
          className={`lead-tab ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          <ListTodo size={14} /> משימות {tasks.length > 0 && <span className="lead-tab-count">{tasks.length}</span>}
        </button>
        <button
          className={`lead-tab ${activeTab === 'time' ? 'active' : ''}`}
          onClick={() => setActiveTab('time')}
        >
          <Clock size={14} /> זמן {timeEntries.length > 0 && <span className="lead-tab-count">{timeEntries.length}</span>}
        </button>
      </div>

      <div className="lead-detail-content">
        {activeTab === 'info' && (
          <>
            <div className="lead-detail-info">
              <div className="lead-detail-card">
                <h3>פרטי קשר</h3>
                <div className="lead-info-grid">
                  {lead.company && (
                    <div className="lead-info-item">
                      <Building2 size={16} />
                      <span>{lead.company}</span>
                    </div>
                  )}
                  {lead.email && (
                    <div className="lead-info-item">
                      <Mail size={16} />
                      <a href={`mailto:${lead.email}`}>{lead.email}</a>
                    </div>
                  )}
                  {lead.phone && (
                    <div className="lead-info-item">
                      <Phone size={16} />
                      <a href={`tel:${lead.phone}`}>{lead.phone}</a>
                    </div>
                  )}
                </div>
              </div>

              <div className="lead-detail-card">
                <h3>פרטי עסקה</h3>
                <div className="lead-info-grid">
                  {lead.expected_value && (
                    <div className="lead-info-item">
                      <DollarSign size={16} />
                      <span>₪{Number(lead.expected_value).toLocaleString('he-IL')}</span>
                    </div>
                  )}
                  {lead.expected_close_date && (
                    <div className="lead-info-item">
                      <Calendar size={16} />
                      <span>{new Date(lead.expected_close_date).toLocaleDateString('he-IL')}</span>
                    </div>
                  )}
                  {lead.assigned_to_name && (
                    <div className="lead-info-item">
                      <UserCheck size={16} />
                      <span>{lead.assigned_to_name}</span>
                    </div>
                  )}
                  <div className="lead-info-item">
                    <Clock size={16} />
                    <span>נוצר {new Date(lead.created_at).toLocaleDateString('he-IL')}</span>
                  </div>
                </div>
              </div>

              <div className="lead-detail-card">
                <h3>מקור</h3>
                <div className="lead-info-grid">
                  <div className="lead-info-item">
                    <Tag size={16} />
                    <span>{getSourceType(lead.source_type).label}</span>
                  </div>
                  {lead.source_name && (
                    <div className="lead-info-item">
                      <span className="lead-info-label">קטגוריה:</span>
                      <span>{lead.source_name}</span>
                    </div>
                  )}
                  {lead.source_detail && (
                    <div className="lead-info-item">
                      <span className="lead-info-label">פרטים:</span>
                      <span>{lead.source_detail}</span>
                    </div>
                  )}
                </div>
              </div>

              {tags.length > 0 && (
                <div className="lead-detail-card">
                  <h3>תגיות</h3>
                  <div className="lead-tags">
                    {tags.map((tag, i) => (
                      <span key={i} className="lead-tag">{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {lead.notes && (
                <div className="lead-detail-card">
                  <h3>הערות</h3>
                  <p className="lead-notes-text">{lead.notes}</p>
                </div>
              )}

              {/* Reminders */}
              <div className="lead-detail-card">
                <div className="lead-card-header">
                  <h3><Bell size={16} /> תזכורות</h3>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowReminderForm(!showReminderForm)}
                  >
                    <Plus size={14} /> הוסף
                  </button>
                </div>

                {showReminderForm && (
                  <div className="lead-reminder-form">
                    <input
                      type="text"
                      className="form-input"
                      placeholder="תוכן התזכורת..."
                      value={reminderContent}
                      onChange={(e) => setReminderContent(e.target.value)}
                    />
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={reminderDate}
                      onChange={(e) => setReminderDate(e.target.value)}
                    />
                    <div className="lead-reminder-form-actions">
                      <button className="btn btn-primary btn-sm" onClick={handleAddReminder}>
                        <Check size={14} /> שמור
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowReminderForm(false)}>
                        ביטול
                      </button>
                    </div>
                  </div>
                )}

                <div className="lead-reminders-list">
                  {(lead.reminders || []).map(reminder => {
                    const isOverdue = !reminder.is_completed && new Date(reminder.due_date) < new Date();
                    return (
                      <div key={reminder.id} className={`lead-reminder-item ${reminder.is_completed ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}`}>
                        <button
                          className="lead-reminder-toggle"
                          onClick={() => handleToggleReminder(reminder)}
                        >
                          {reminder.is_completed ? <CheckCircle size={16} /> : <div className="lead-reminder-circle" />}
                        </button>
                        <div className="lead-reminder-content">
                          <span>{reminder.content}</span>
                          <span className="lead-reminder-date">
                            {new Date(reminder.due_date).toLocaleDateString('he-IL', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                            })}
                          </span>
                        </div>
                        <button
                          className="btn btn-ghost btn-icon btn-xs"
                          onClick={() => handleDeleteReminder(reminder.id)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                  {/* Planned slots associated with this lead */}
                  {(lead.plannedSlots || []).map(slot => {
                    const isPast = new Date(slot.date) < new Date(new Date().toDateString());
                    return (
                      <div key={`slot-${slot.id}`} className={`lead-reminder-item ${isPast ? 'completed' : ''}`}>
                        <div className="lead-reminder-toggle" style={{ cursor: 'default' }}>
                          <CalendarClock size={16} style={{ color: 'var(--accent-primary)' }} />
                        </div>
                        <div className="lead-reminder-content">
                          <span>
                            {slot.notes || 'משימה מתוכננת'}
                            {slot.project_name && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}> · {slot.project_name}</span>}
                          </span>
                          <span className="lead-reminder-date">
                            {new Date(slot.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                            {slot.duration && ` · ${Math.floor(slot.duration / 60)}:${String(slot.duration % 60).padStart(2, '0')} שעות`}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {(!lead.reminders || lead.reminders.length === 0) && (!lead.plannedSlots || lead.plannedSlots.length === 0) && !showReminderForm && (
                    <p className="lead-reminders-empty">אין תזכורות</p>
                  )}
                </div>
              </div>
            </div>

            {/* Activity Timeline */}
            <div className="lead-detail-timeline">
              <h3>היסטוריית פעילות</h3>
              <LeadActivityTimeline
                activities={lead.activities || []}
                onAddActivity={handleAddActivity}
                onDeleteActivity={handleDeleteActivity}
              />
            </div>
          </>
        )}

        {activeTab === 'tasks' && (
          <div className="lead-tasks-section">
            <div className="lead-section-header">
              <h3>משימות</h3>
              <div className="lead-section-header-actions">
                {!isConverted && (
                  <>
                    {leadTimer ? (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--error)' }} onClick={() => handleStopTimer(leadTimer.id)}>
                        <Square size={14} /> עצור טיימר
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleStartTimer()}>
                        <Play size={14} /> טיימר כללי
                      </button>
                    )}
                    <button className="btn btn-primary btn-sm" onClick={() => setShowTaskForm(!showTaskForm)}>
                      <Plus size={14} /> משימה חדשה
                    </button>
                  </>
                )}
              </div>
            </div>

            {showTaskForm && (
              <div className="lead-task-form">
                <input
                  type="text"
                  className="form-input"
                  placeholder="שם המשימה..."
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  autoFocus
                />
                <input
                  type="text"
                  className="form-input"
                  placeholder="תיאור (אופציונלי)..."
                  value={newTaskDescription}
                  onChange={(e) => setNewTaskDescription(e.target.value)}
                />
                <div className="lead-task-form-actions">
                  <button className="btn btn-primary btn-sm" onClick={handleAddTask}>
                    <Check size={14} /> צור משימה
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowTaskForm(false); setNewTaskName(''); setNewTaskDescription(''); }}>
                    ביטול
                  </button>
                </div>
              </div>
            )}

            <div className="lead-tasks-list">
              {tasks.length === 0 ? (
                <p className="lead-empty-message">אין משימות עדיין. צור משימה ראשונה כדי להתחיל לעקוב אחרי העבודה על הליד.</p>
              ) : (
                tasks.map(task => {
                  const taskTimer = activeTimers.find(t => t.task_id === task.id);
                  return (
                    <div key={task.id} className="lead-task-item">
                      <div className="lead-task-info">
                        <Link to={`/tasks/${task.id}`} className="lead-task-name">
                          {task.name}
                        </Link>
                        <div className="lead-task-meta">
                          <span className={`lead-task-status status-${task.status}`}>{
                            { pending: 'ממתין', in_progress: 'בביצוע', completed: 'הושלם', cancelled: 'בוטל' }[task.status]
                          }</span>
                          {task.total_time > 0 && (
                            <span className="lead-task-time">
                              <Clock size={12} /> {formatDuration(task.total_time)}
                            </span>
                          )}
                        </div>
                      </div>
                      {!isConverted && (
                        <div className="lead-task-actions">
                          {taskTimer ? (
                            <button className="btn btn-ghost btn-icon btn-sm" style={{ color: 'var(--error)' }} onClick={() => handleStopTimer(taskTimer.id)} title="עצור טיימר">
                              <Square size={14} />
                            </button>
                          ) : (
                            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleStartTimer(task.id)} title="הפעל טיימר">
                              <Play size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === 'time' && (
          <div className="lead-time-section">
            <div className="lead-section-header">
              <h3>רשומות זמן</h3>
              {totalTimeInvested > 0 && (
                <span className="lead-total-time">סה"כ: {formatDuration(totalTimeInvested)}</span>
              )}
            </div>

            <div className="lead-time-list">
              {timeEntries.length === 0 ? (
                <p className="lead-empty-message">אין רשומות זמן. הפעל טיימר ממשימה כדי להתחיל לתעד זמן.</p>
              ) : (
                timeEntries.map(entry => (
                  <div key={entry.id} className="lead-time-item">
                    <div className="lead-time-item-info">
                      <span className="lead-time-item-duration">{formatDuration(entry.duration)}</span>
                      <span className="lead-time-item-date">
                        {new Date(entry.start_time).toLocaleDateString('he-IL', {
                          day: 'numeric', month: 'short', year: 'numeric'
                        })}
                      </span>
                      {entry.task_name && <span className="lead-time-item-task">{entry.task_name}</span>}
                    </div>
                    {entry.notes && <p className="lead-time-item-notes">{entry.notes}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <LeadModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        lead={lead}
        onSaved={loadLead}
      />

      <LeadConvertModal
        isOpen={showConvertModal}
        onClose={() => setShowConvertModal(false)}
        lead={lead}
        onConverted={loadLead}
      />
    </div>
  );
}

export default LeadDetail;
