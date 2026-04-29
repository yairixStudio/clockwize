import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Plus, Play, Pause, Square, X, Edit2, Trash2, Clock, CheckSquare, Bell, DollarSign, CreditCard, AlertCircle, AlertTriangle, CheckCircle2, MessageSquare, Folder, TrendingUp, Share2, Globe, Mail, Phone, Key, FileText, StickyNote, Circle, CircleCheck, ChevronDown, ChevronUp, Copy, ChevronLeft, ListTodo } from 'lucide-react';
import { clientsAPI, projectsAPI, tasksAPI, timerAPI, statsAPI, shareAPI, remindersAPI, paymentsAPI, credentialsAPI, filesAPI, alertsAPI } from '../services/api';
import BreadcrumbItem from '../components/BreadcrumbItem';
import { formatDurationHuman, formatCurrency, formatDateTime, formatDate, formatTimeOnly, calculateEndTime } from '../utils/format';
import { getProjectStatus, getTaskStatus, PROJECT_STATUSES, TASK_STATUSES } from '../utils/status';
import useStore from '../store/useStore';
import { useModal } from '../components/Modal';
import ProjectModal from '../components/ProjectModal';
import TaskModal from '../components/TaskModal';
import TimeEntryModal from '../components/TimeEntryModal';
import TimeEntryItem from '../components/TimeEntryItem';
import ActiveTimerEntry from '../components/ActiveTimerEntry';
import TimerConflictModal from '../components/TimerConflictModal';
import ShareModal from '../components/ShareModal';
import AlertModal from '../components/AlertModal';
import AlertBadge from '../components/AlertBadge';
import RemindersModal from '../components/RemindersModal';
import ReminderItem from '../components/ReminderItem';
import '../pages/Reminders.css';
import PaymentModal from '../components/PaymentModal';
import PaymentStatusBadge, { calculateProjectEarnings } from '../components/PaymentStatusBadge';
import Forum from '../components/Forum';
import NotesTab from '../components/NotesTab';
import { CredentialModal, CredentialsSection } from '../components/Credentials';
import FilesSection from '../components/FilesSection';
import TimeSummary from '../components/TimeSummary';
import '../components/Credentials.css';
import './ProjectDetail.css';
import '../styles/reminders-mini.css';
import { apps } from '../apps';

function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setStats: setGlobalStats } = useOutletContext();
  const modal = useModal();
  const { activeTimers, startTimer, pauseTimer, resumeTimer, stopTimer, discardTimer, getTimerForProject, integrations, isAddonEnabled } = useStore();

  // Get initial tab from URL param or default to 'tasks'
  const initialTab = searchParams.get('tab') || 'tasks';

  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLinks, setShareLinks] = useState([]);
  const [showTimeEntryModal, setShowTimeEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [projectReminders, setProjectReminders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [credentials, setCredentials] = useState([]);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [editingCredential, setEditingCredential] = useState(null);
  const [files, setFiles] = useState([]);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState({});

  // Alerts state
  const [projectAlerts, setProjectAlerts] = useState([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState([]);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [editingAlert, setEditingAlert] = useState(null);

  // Timer conflict modal state
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [pendingTimerStart, setPendingTimerStart] = useState(null);

  // Stop timer modal state
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopNotes, setStopNotes] = useState('');
  const [stoppingTimer, setStoppingTimer] = useState(null);

  // Get timer for current project (no task)
  const projectTimer = getTimerForProject(id, null);

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
    if (!project?.client_id) return [];
    const projects = await projectsAPI.getAll(project.client_id);
    return projects.map(p => ({
      id: p.id,
      name: p.name,
      to: `/projects/${p.id}`
    }));
  }, [project?.client_id]);

  const loadData = async () => {
    try {
      const [projectData, tasksData, statsData, entriesData, paymentsData, credentialsData] = await Promise.all([
        projectsAPI.getOne(id),
        tasksAPI.getAll(id),
        statsAPI.getProject(id),
        timerAPI.getEntries(id, null),
        paymentsAPI.getAll(id),
        credentialsAPI.getByProject(id)
      ]);
      
      // Load files separately to avoid failing the whole page if files API has auth issues
      let filesData = [];
      try {
        filesData = await filesAPI.getByProject(id);
      } catch (e) {
        console.warn('Failed to load files:', e);
      }
      setProject(projectData);
      setTasks(tasksData);
      setStats(statsData);

      if (statsData) {
        const totalHours = (statsData.time?.total || 0) / 3600;
        const totalEarnings = statsData.earnings?.total || 0;
        const effectiveRate = totalHours > 0 ? totalEarnings / totalHours : 0;

        setGlobalStats([
          { label: 'משימות', value: `${statsData.tasks?.completed || 0}/${statsData.tasks?.total || 0}`, icon: <CheckSquare size={20} /> },
          { label: 'שעות עבודה', value: formatDurationHuman(statsData.time?.total || 0), icon: <Clock size={20} /> },
          { label: 'סה"כ לחיוב', value: formatCurrency(statsData.earnings?.total || 0), icon: <DollarSign size={20} /> },
          { label: 'תעריף בפועל', value: `${formatCurrency(effectiveRate)}/שעה`, icon: <TrendingUp size={20} /> },
          { label: 'שולם', value: formatCurrency(projectData.paid_amount || 0), icon: <CreditCard size={20} /> },
          { label: 'יתרה לתשלום', value: formatCurrency((statsData.earnings?.total || 0) - (projectData.paid_amount || 0)), icon: (statsData.earnings?.total || 0) - (projectData.paid_amount || 0) > 0 ? <AlertCircle size={20} /> : <CheckCircle2 size={20} /> }
        ]);
      }

      setTimeEntries(entriesData);
      setPayments(paymentsData);
      setCredentials(credentialsData);
      setFiles(filesData);

      // Load share links
      try {
        const allLinks = await shareAPI.getMyLinks();
        const projectLinks = allLinks.filter(link => link.resource_type === 'project' && link.resource_id === id);
        setShareLinks(projectLinks);
      } catch (e) {
        // Ignore share links loading errors
      }

      // Load reminders
      try {
        const allReminders = await remindersAPI.getAll({ include_read: 'true' });
        const relevantReminders = allReminders.filter(r =>
          r.association_type === 'project' && r.association_id === id
        );
        setProjectReminders(relevantReminders);
      } catch (e) {
        console.error('Error loading reminders:', e);
      }

      // Load alerts
      try {
        const alertData = await alertsAPI.check(id);
        setProjectAlerts(alertData.alerts || []);
        setTriggeredAlerts(alertData.triggered || []);
      } catch (e) {
        console.warn('Failed to load alerts:', e);
      }
    } catch (error) {
      console.error('Failed to load project:', error);
      navigate('/clients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleSaveAlert = async (alertData) => {
    try {
      if (editingAlert) {
        await alertsAPI.update(editingAlert.id, alertData);
        modal.success('ההתראה עודכנה בהצלחה');
      } else {
        await alertsAPI.create({ ...alertData, project_id: id });
        modal.success('ההתראה נוספה בהצלחה');
      }
      loadData();
      setShowAlertModal(false);
      setEditingAlert(null);
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleSaveTask = async (taskData) => {
    try {
      if (editingTask) {
        await tasksAPI.update(editingTask.id, taskData);
      } else {
        await tasksAPI.create({ ...taskData, project_id: id });
      }
      loadData();
      setShowTaskModal(false);
      setEditingTask(null);
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDeleteTask = async (taskId) => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך למחוק את המשימה?',
      { title: 'מחיקת משימה', confirmText: 'מחק', type: 'error' }
    );

    if (confirmed) {
      try {
        await tasksAPI.delete(taskId);
        // Update state immediately for instant UI feedback
        setTasks(prev => prev.filter(t => t.id !== taskId));
        // Reload data in background to ensure consistency
        loadData();
        modal.success('המשימה נמחקה בהצלחה');
      } catch (error) {
        modal.error(error.message);
        // Reload data on error to restore correct state
        loadData();
      }
    }
  };

  const handleToggleTaskStatus = async (task) => {
    try {
      await tasksAPI.update(task.id, {
        ...task,
        status: task.status === 'completed' ? 'pending' : 'completed'
      });
      loadData();
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleUpdateTaskStatus = async (task, newStatus) => {
    try {
      await tasksAPI.update(task.id, {
        ...task,
        status: newStatus
      });
      loadData();
    } catch (error) {
      modal.error(error.message);
    }
  };

  // Timer button click handler - checks for conflicts
  const handleTimerButtonClick = async (taskId = null) => {
    const existingTimer = taskId
      ? getTimerForProject(id, taskId)
      : projectTimer;

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
      setPendingTimerStart({ projectId: id, taskId });
      setShowConflictModal(true);
      return;
    }

    // No conflicts, start timer directly
    await doStartTimer(id, taskId);
  };

  // Actually start the timer
  const doStartTimer = async (projectId, taskId) => {
    try {
      await startTimer(projectId, taskId);
      modal.success('הטיימר הופעל!');
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

  const handleStopTimerClick = (timer, taskId = null) => {
    const task = taskId ? tasks.find(t => t.id === taskId) : null;
    setStoppingTimer({
      ...timer,
      projectName: project.name,
      taskName: task?.name || null
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
      loadData();
    } catch (error) {
      modal.error('שגיאה בשמירת הזמן');
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

  const handleSaveTimeEntry = async (entryData) => {
    try {
      if (editingEntry) {
        await timerAPI.updateEntry(editingEntry.id, entryData);
        modal.success('הרשומה עודכנה בהצלחה');
      } else {
        await timerAPI.createEntry({
          ...entryData,
          project_id: id,
          task_id: null
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

  const handleUpdateProjectStatus = async (status) => {
    try {
      await projectsAPI.update(id, { ...project, status });
      loadData();
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleSaveProject = async (projectData) => {
    try {
      await projectsAPI.update(id, projectData);
      loadData();
      setShowProjectModal(false);
      setEditingProject(null);
      modal.success('הפרויקט עודכן בהצלחה');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleSavePayment = async (paymentData) => {
    try {
      if (editingPayment) {
        await paymentsAPI.update(editingPayment.id, paymentData);
        modal.success('התשלום עודכן בהצלחה');
      } else {
        await paymentsAPI.create(paymentData);
        modal.success('התשלום נוסף בהצלחה');
      }
      loadData();
      setShowPaymentModal(false);
      setEditingPayment(null);
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך למחוק את התשלום?',
      { title: 'מחיקת תשלום', confirmText: 'מחק', type: 'error' }
    );

    if (confirmed) {
      try {
        await paymentsAPI.delete(paymentId);
        loadData();
        modal.success('התשלום נמחק בהצלחה');
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  const copyShareLink = (token) => {
    navigator.clipboard.writeText(`${window.location.origin}/s/${token}`);
    modal.success('הלינק הועתק!');
  };

  // Export tasks as message
  const handleExportTasksAsMessage = async () => {
    if (tasks.length === 0) {
      modal.error('אין משימות לייצוא');
      return;
    }

    const includeSubtasks = await modal.confirm('לייצא כולל תתי-משימות?', {
      title: 'ייצוא משימות',
      confirmText: 'כולל תתי-משימות',
      cancelText: 'משימות בלבד'
    });

    let tasksToExport = tasks;
    if (includeSubtasks) {
      try {
        tasksToExport = await tasksAPI.getAll(id, { includeSubtasks: true });
      } catch (err) {
        modal.error('שגיאה בטעינת תתי-המשימות');
        return;
      }
    }

    const lines = [];
    tasksToExport.forEach(task => {
      const emoji = task.status === 'completed' ? '✓' : '✗';
      lines.push(`${emoji} ${task.name}`);

      if (task.description) {
        const descLines = task.description.split('\n').filter(l => l.trim());
        descLines.forEach(line => {
          lines.push(`    ${line.trim()}`);
        });
      }

      if (includeSubtasks && task.subtasks && task.subtasks.length > 0) {
        task.subtasks.forEach(subtask => {
          const subtaskEmoji = subtask.is_completed ? '✓' : '○';
          lines.push(`    ${subtaskEmoji} ${subtask.title}`);
        });
      }
    });

    navigator.clipboard.writeText(lines.join('\n'));
    modal.success('המשימות הועתקו ללוח!');
  };

  // Credentials handlers
  const handleSaveCredential = async (credentialData) => {
    try {
      if (editingCredential) {
        await credentialsAPI.update(editingCredential.id, credentialData);
      } else {
        await credentialsAPI.create({ ...credentialData, project_id: id });
      }
      const updated = await credentialsAPI.getByProject(id);
      setCredentials(updated);
      setShowCredentialModal(false);
      setEditingCredential(null);
      modal.success(editingCredential ? 'הסיסמה עודכנה בהצלחה' : 'הסיסמה נוספה בהצלחה');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDeleteCredential = async (credentialId) => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך למחוק את הסיסמה?',
      { title: 'מחיקת סיסמה', confirmText: 'מחק', type: 'error' }
    );

    if (confirmed) {
      try {
        await credentialsAPI.delete(credentialId);
        const updated = await credentialsAPI.getByProject(id);
        setCredentials(updated);
        modal.success('הסיסמה נמחקה בהצלחה');
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  // Get timer button state for a task
  const getTaskTimerButton = (task) => {
    const taskTimer = getTimerForProject(id, task.id);

    if (taskTimer) {
      return {
        icon: taskTimer.is_running ? '⏸' : '▶',
        title: taskTimer.is_running ? 'השהה' : 'המשך',
        className: taskTimer.is_running ? 'btn-warning' : 'btn-success'
      };
    }

    return {
      icon: '▶',
      title: 'התחל טיימר',
      className: 'btn-primary'
    };
  };

  // Toggle expanded state for a task's subtasks
  const toggleTaskExpanded = (taskId, e) => {
    e.stopPropagation();
    setExpandedTasks(prev => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  // Toggle subtask completion
  const handleToggleSubtask = async (subtask, task) => {
    try {
      await tasksAPI.updateSubtask(subtask.id, { is_completed: !subtask.is_completed });
      loadData();
    } catch (error) {
      modal.error(error.message);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  if (!project) {
    return <div className="page">פרויקט לא נמצא</div>;
  }

  // Project timer button state
  const getProjectTimerButton = () => {
    if (projectTimer) {
      return {
        icon: projectTimer.is_running ? '⏸' : '▶',
        text: projectTimer.is_running ? 'השהה טיימר' : 'המשך טיימר',
        className: projectTimer.is_running ? 'btn-warning' : 'btn-success'
      };
    }
    return {
      icon: '▶',
      text: 'התחל טיימר',
      className: 'btn-primary'
    };
  };

  const projectBtn = getProjectTimerButton();

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
            label={project.client_name}
            to={`/clients/${project.client_id}`}
            currentId={project.client_id}
            onLoadItems={loadAllClients}
          />
          <span>/</span>
          <BreadcrumbItem
            label={project.name}
            currentId={id}
            isCurrent={true}
            onLoadItems={loadClientProjects}
            onRename={async (newName) => {
              await projectsAPI.update(id, { name: newName });
              loadData();
            }}
          />
        </div>

        {/* Time Summary */}
        <TimeSummary
          totalSeconds={stats?.time?.total || 0}
          hourlyRate={project.pricing_type !== 'fixed' && project.pricing_type !== 'no_charge' ? (project.hourly_rate || project.client_hourly_rate || 250) : 0}
          showEarnings={project.pricing_type !== 'no_charge'}
          size="small"
        />

        <div className="header-actions">
          <select
            className={`project-status-select ${getProjectStatus(project.status).badge}`}
            value={project.status}
            onChange={e => handleUpdateProjectStatus(e.target.value)}
          >
            {PROJECT_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.icon} {s.label}</option>
            ))}
          </select>

          <div className="divider-vertical"></div>

          {/* Project Meta (Minimal) */}
          <div className="client-contact-minimal">
            <Link to={`/clients/${project.client_id}`} className="contact-item-mini" title={`לקוח: ${project.client_name}`}>
              <Folder size={14} />
              <span className="mobile-hide">{project.client_name}</span>
            </Link>
            <span className="contact-item-mini" title={project.pricing_type === 'fixed' ? `מחיר קבוע: ${formatCurrency(project.fixed_price || 0)}` : `תעריף: ${formatCurrency(project.hourly_rate || project.client_hourly_rate || 250)}/שעה`}>
              <DollarSign size={14} />
            </span>
            <PaymentStatusBadge
              totalEarned={calculateProjectEarnings(project, { hourly_rate: project.client_hourly_rate })}
              paidAmount={project.paid_amount || 0}
              onClick={() => setActiveTab('payments')}
            />
            <AlertBadge
              count={triggeredAlerts.filter(a => !a.is_dismissed).length}
              onClick={() => setActiveTab('alerts')}
            />
          </div>

          <div className="divider-vertical"></div>

          {/* Timer Actions */}
          <button
            onClick={() => handleTimerButtonClick(null)}
            className={`btn btn-sm ${projectBtn.className}`}
            disabled={project.status === 'completed'}
            title={projectBtn.text}
          >
            {projectBtn.icon === '▶' ? <Play size={16} /> : <Pause size={16} />}
            <span className="mobile-hide">{projectBtn.text === 'התחל טיימר' ? 'טיימר' : projectBtn.text}</span>
          </button>

          {projectTimer && (
            <button
              onClick={() => handleStopTimerClick(projectTimer)}
              className="btn btn-error btn-sm btn-icon"
              title="עצור ושמור"
            >
              <Square size={16} />
            </button>
          )}

          <div className="divider-vertical"></div>

          <button
            onClick={() => { setEditingProject(project); setShowProjectModal(true); }}
            className="btn btn-secondary btn-sm"
            title="ערוך פרטים"
          >
            <Edit2 size={16} />
            <span className="mobile-hide">עריכה</span>
          </button>

          <div className="share-action-wrapper">
            <button
              onClick={() => setShowShareModal(true)}
              className={`btn btn-sm ${shareLinks.length > 0 ? 'btn-secondary active-share' : 'btn-ghost'}`}
              title="שיתוף פרויקט"
            >
              <Share2 size={16} />
              <span className="mobile-hide">שיתוף</span>
              {shareLinks.length > 0 && (
                <span className="share-indicator" title={`${shareLinks.length} לינקים פעילים`}>
                  {shareLinks.length}
                </span>
              )}
            </button>
          </div>

          {/* App Actions */}
          {apps.map(app => {
            const actions = app.actions || [];
            return actions
              .filter(action => action.location === 'project_detail' && (!action.condition || action.condition({ project, integrations })))
              .map((action, index) => {
                const Icon = action.icon;
                return (
                  <button
                    key={`${app.id}-${index}`}
                    onClick={() => action.onClick({ project })}
                    className="btn btn-ghost btn-sm"
                    title={action.label}
                  >
                    {Icon && <Icon size={16} />}
                  </button>
                );
              });
          })}
        </div>

        {/* Project Description */}
        {project.description && (
          <div className="project-description-container">
            <div className={`project-description ${showFullDescription ? 'expanded' : 'collapsed'}`}>
              {project.description}
            </div>
            {project.description.length > 150 && (
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

      {/* Estimated vs Actual Hours - Minimal */}
      {project.estimated_hours > 0 && (
        <div className="hours-tracker-mini card">
          <div className="hours-tracker-main">
            <span className="hours-tracker-label">⏱️ שעות</span>
            <span className={`hours-tracker-value ltr ${((stats?.time?.total || 0) / 3600) > project.estimated_hours ? 'over' : ''}`}>
              {((stats?.time?.total || 0) / 3600).toFixed(1)}/{project.estimated_hours.toFixed(0)} ({(((stats?.time?.total || 0) / 3600 / project.estimated_hours) * 100).toFixed(0)}%)
            </span>
          </div>
          <div className="hours-tracker-bar-mini">
            <div
              className={`hours-tracker-fill ${((stats?.time?.total || 0) / 3600) > project.estimated_hours ? 'over' : ''}`}
              style={{ width: `${Math.min(((stats?.time?.total || 0) / 3600 / project.estimated_hours) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Notes Section */}
      {project.notes && (
        <div className="notes-section card">
          <div className="notes-header">
            <span className="notes-icon">📝</span>
            <h3>פתק פרטי</h3>
          </div>
          <div className="notes-content">{project.notes}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          משימות ({tasks.length})
        </button>
        <button
          className={`tab ${activeTab === 'time' ? 'active' : ''}`}
          onClick={() => setActiveTab('time')}
        >
          רשומות זמן ({timeEntries.length})
        </button>
        <button
          className={`tab ${activeTab === 'payments' ? 'active' : ''}`}
          onClick={() => setActiveTab('payments')}
        >
          תשלומים ({payments.length})
        </button>
        {isAddonEnabled('credentials') && (
          <button
            className={`tab ${activeTab === 'credentials' ? 'active' : ''}`}
            onClick={() => setActiveTab('credentials')}
          >
            <Key size={16} />
            סיסמאות ({credentials.length})
          </button>
        )}
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
            תזכורות ({projectReminders.length})
          </button>
        )}
        <button
          className={`tab ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => setActiveTab('alerts')}
        >
          <AlertTriangle size={16} />
          התראות ({projectAlerts.length})
          {triggeredAlerts.filter(a => !a.is_dismissed).length > 0 && (
            <span className="tab-badge">{triggeredAlerts.filter(a => !a.is_dismissed).length}</span>
          )}
        </button>
      </div>

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <div className="tab-content">
          {/* Progress Bar */}
          {tasks.length > 0 && (
            <div className="project-progress-bar-container">
              <div className="project-progress-bar">
                <div
                  className="project-progress-bar-fill"
                  style={{
                    width: `${(tasks.filter(t => t.status === 'completed').length / tasks.length) * 100}%`
                  }}
                />
              </div>
            </div>
          )}
          
          <div className="items-list">
            {/* Export Tasks Button */}
            {tasks.length > 0 && (
              <button
                onClick={handleExportTasksAsMessage}
                className="list-item export-tasks-list-item"
                style={{ backgroundColor: 'var(--bg-secondary)', borderStyle: 'dashed' }}
              >
                <Copy size={18} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
                <span style={{ fontWeight: 500 }}>יצוא כהודעה</span>
              </button>
            )}

            {/* New Task Button - List Style */}
            <button
              onClick={() => setShowTaskModal(true)}
              className="list-item new-task-list-item"
            >
              <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
              <span style={{ fontWeight: 500 }}>צור משימה חדשה</span>
            </button>

          {tasks.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-state-icon">
                <CheckSquare size={48} strokeWidth={1.5} />
              </div>
              <h3 className="empty-state-title">עדיין אין משימות</h3>
              <p>הוסף משימות כדי לעקוב אחרי ההתקדמות</p>
            </div>
          ) : (
              tasks.map(task => {
                const taskBtn = getTaskTimerButton(task);
                const taskStatus = getTaskStatus(task.status);
                const taskTimer = getTimerForProject(id, task.id);
                const hasSubtasks = task.subtasks && task.subtasks.length > 0;
                const isExpanded = expandedTasks[task.id];
                const completedSubtasks = hasSubtasks ? task.subtasks.filter(s => s.is_completed).length : 0;

                return (
                  <div key={task.id} className="task-group-wrapper">
                    <div className={`list-item task-item ${task.status === 'completed' || task.status === 'cancelled' ? 'completed' : ''} ${hasSubtasks ? 'has-subtasks' : ''}`}>
                      {/* Subtasks Toggle - Show only if task has subtasks */}
                      {hasSubtasks && (
                        <button
                          className={`subtasks-toggle ${isExpanded ? 'expanded' : ''}`}
                          onClick={(e) => toggleTaskExpanded(task.id, e)}
                          title={isExpanded ? 'הסתר תתי-משימות' : 'הצג תתי-משימות'}
                        >
                          <ChevronLeft size={16} />
                        </button>
                      )}

                      <button
                        className={`task-checkbox ${task.status === 'completed' ? 'checked' : ''}`}
                        onClick={() => handleToggleTaskStatus(task)}
                      >
                        {task.status === 'completed' ? <CircleCheck size={16} /> : <Circle size={16} />}
                      </button>

                      <div className="list-item-content">
                        <div className="list-item-title">
                          <Link to={`/tasks/${task.id}`} className="list-item-link">
                            {task.name}
                          </Link>
                          {/* Subtasks indicator badge */}
                          {hasSubtasks && (
                            <span
                              className="subtasks-badge"
                              onClick={(e) => toggleTaskExpanded(task.id, e)}
                              title={`${completedSubtasks}/${task.subtasks.length} תתי-משימות הושלמו`}
                            >
                              <ListTodo size={12} />
                              <span>{completedSubtasks}/{task.subtasks.length}</span>
                            </span>
                          )}
                        </div>

                        {task.description && (
                          <div className="list-item-subtitle task-desc-preview" title={task.description}>
                            {task.description.length > 60 ? task.description.substring(0, 60) + '...' : task.description}
                          </div>
                        )}

                        <div className="list-item-subtitle">
                          {task.created_at && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} title="תאריך יצירה">
                              {formatDate(task.created_at)}
                            </span>
                          )}
                          {task.notes && (
                            <>
                              <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                              <span title="יש הערות">📝</span>
                            </>
                          )}
                          <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                          <span>{formatDurationHuman(task.total_time || 0)}</span>

                          {task.estimated_hours && (
                            <>
                              <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                              <span style={{
                                color: ((task.total_time || 0) / 3600) <= task.estimated_hours ? 'var(--success)' : 'var(--warning)'
                              }}>
                                ⏱️ {((task.total_time || 0) / 3600).toFixed(1)} / {task.estimated_hours.toFixed(1)} שעות
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="task-timer-area">
                        {/* Timer Controls */}
                        {(() => {
                          if (!taskTimer) {
                            return (
                              <button
                                className="timer-btn timer-play"
                                onClick={() => handleTimerButtonClick(task.id)}
                                title="התחל טיימר"
                                disabled={task.status === 'completed' || task.status === 'cancelled'}
                              >
                                <Play size={14} />
                              </button>
                            );
                          }

                          return (
                            <div className="timer-controls">
                              <span className="timer-elapsed">
                                {formatDurationHuman(
                                  taskTimer.is_running
                                    ? taskTimer.accumulated_seconds + Math.floor((Date.now() - new Date(taskTimer.start_time).getTime()) / 1000)
                                    : taskTimer.accumulated_seconds
                                )}
                              </span>

                              {taskTimer.is_running ? (
                                <button
                                  className="timer-btn timer-pause"
                                  onClick={() => handleTimerButtonClick(task.id)}
                                  title="השהה"
                                >
                                  <Pause size={14} />
                                </button>
                              ) : (
                                <button
                                  className="timer-btn timer-play"
                                  onClick={() => handleTimerButtonClick(task.id)}
                                  title="המשך"
                                >
                                  <Play size={14} />
                                </button>
                              )}

                              <button
                                className="timer-btn timer-stop"
                                onClick={() => handleStopTimerClick(taskTimer, task.id)}
                                title="עצור ושמור"
                              >
                                <Square size={14} />
                              </button>

                              <button
                                className="timer-btn timer-discard"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const confirmed = await modal.confirm(
                                    'האם אתה בטוח שברצונך לבטל את הטיימר? הזמן שנספר לא יישמר.',
                                    { title: 'ביטול טיימר', confirmText: 'בטל', type: 'warning' }
                                  );
                                  if (confirmed) {
                                    try {
                                      await discardTimer(taskTimer.id);
                                    } catch (error) {
                                      modal.error(error.message);
                                    }
                                  }
                                }}
                                title="בטל טיימר"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          );
                        })()}

                        {/* Status Select */}
                        <select
                          className={`task-status-select ${taskStatus.badge}`}
                          value={task.status}
                          onChange={e => handleUpdateTaskStatus(task, e.target.value)}
                          onClick={e => e.stopPropagation()}
                          style={{ marginRight: '0.5rem' }}
                        >
                          {TASK_STATUSES.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>

                        {/* Actions */}
                        <div className="list-actions" style={{ marginRight: '0.5rem' }}>
                          <button
                            onClick={() => { setEditingTask(task); setShowTaskModal(true); }}
                            className="btn-icon-tiny"
                            title="ערוך"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="btn-icon-tiny"
                            title="מחק"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Nested Subtasks */}
                    {hasSubtasks && isExpanded && (
                      <div className="nested-subtasks">
                        {task.subtasks.map(subtask => (
                          <div
                            key={subtask.id}
                            className={`subtask-item-inline ${subtask.is_completed ? 'completed' : ''}`}
                          >
                            <label className="checkbox-container">
                              <input
                                type="checkbox"
                                checked={!!subtask.is_completed}
                                onChange={() => handleToggleSubtask(subtask, task)}
                              />
                              <span className="checkmark"></span>
                              <span className="subtask-title">{subtask.title}</span>
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
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

            {/* Active Timers for this project */}
            {activeTimers
              .filter(timer => timer.project_id === id)
              .map(timer => (
                <ActiveTimerEntry
                  key={`active-${timer.id}`}
                  timer={timer}
                  showProject={false}
                  showTask={true}
                  onPause={() => pauseTimer(timer.id)}
                  onResume={() => resumeTimer(timer.id)}
                  onStop={() => handleStopTimerClick(timer, timer.task_id)}
                />
              ))
            }

            {timeEntries.length === 0 && activeTimers.filter(t => t.project_id === id).length === 0 ? (
              <div className="empty-state-inline">
                <Clock size={24} strokeWidth={1.5} />
                <span>עדיין אין רשומות זמן</span>
              </div>
            ) : (
              timeEntries.map(entry => {
                const entryTimer = entry.task_id
                  ? getTimerForProject(id, entry.task_id)
                  : getTimerForProject(id, null);

                return (
                  <TimeEntryItem
                    key={entry.id}
                    entry={entry}
                    timer={entryTimer}
                    showProject={false}
                    showTask={true}
                    onTimerClick={() => handleTimerButtonClick(entry.task_id || null)}
                    onStopClick={entryTimer ? () => handleStopTimerClick(entryTimer, entry.task_id) : null}
                    onEditClick={() => { setEditingEntry(entry); setShowTimeEntryModal(true); }}
                    onDeleteClick={() => handleDeleteEntry(entry.id)}
                    disabled={project.status === 'completed'}
                  />
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Payments Tab */}
      {activeTab === 'payments' && (
        <div className="tab-content">
          <div className="payments-list">
            {/* New Payment Button - List Style */}
            <button
              onClick={() => setShowPaymentModal(true)}
              className="list-item new-payment-list-item"
            >
              <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
              <span style={{ fontWeight: 500 }}>צור תשלום חדש</span>
            </button>

          {payments.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-state-icon">
                <CreditCard size={48} strokeWidth={1.5} />
              </div>
              <h3 className="empty-state-title">עדיין אין תשלומים</h3>
              <p>הוסף תשלומים כדי לעקוב אחרי ההכנסות מהפרויקט</p>
            </div>
          ) : (
              payments.map(payment => (
                <div key={payment.id} className="payment-item card">
                  <div className="payment-content">
                    <div className="payment-header">
                      <span className="payment-amount ltr">
                        {formatCurrency(payment.amount)}
                      </span>
                      <span className="payment-date">
                        {formatDateTime(payment.date)}
                      </span>
                    </div>
                    {payment.notes && (
                      <div className="payment-notes">{payment.notes}</div>
                    )}
                  </div>

                  <div className="payment-actions">
                    <button
                      onClick={() => { setEditingPayment(payment); setShowPaymentModal(true); }}
                      className="btn btn-ghost btn-icon btn-sm"
                      title="ערוך"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDeletePayment(payment.id)}
                      className="btn btn-ghost btn-icon btn-sm"
                      title="מחק"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Credentials Tab */}
      {activeTab === 'credentials' && isAddonEnabled('credentials') && (
        <div className="tab-content">
          <CredentialsSection
            credentials={credentials}
            loading={loadingCredentials}
            onAdd={() => { setEditingCredential(null); setShowCredentialModal(true); }}
            onEdit={(cred) => { setEditingCredential(cred); setShowCredentialModal(true); }}
            onDelete={handleDeleteCredential}
          />
        </div>
      )}

      {/* Files Tab */}
      {activeTab === 'files' && isAddonEnabled('files') && (
        <div className="tab-content">
          <FilesSection
            entityType="project"
            entityId={id}
            files={files}
            onFilesChange={loadData}
          />
        </div>
      )}

      {/* Notes Tab */}
      {activeTab === 'notes' && isAddonEnabled('notes') && (
        <div className="tab-content">
          <NotesTab entityType="project" entityId={id} />
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

          {projectReminders.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-state-icon">
                <Bell size={48} strokeWidth={1.5} />
              </div>
              <h3 className="empty-state-title">עדיין אין תזכורות</h3>
              <p>הוסף תזכורות כדי לא לשכוח משימות חשובות</p>
            </div>
          ) : (
              projectReminders.map(reminder => (
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

      {/* Alerts Tab */}
      {activeTab === 'alerts' && (
        <div className="tab-content">
          <div className="alerts-list">
            <button
              onClick={() => { setEditingAlert(null); setShowAlertModal(true); }}
              className="list-item new-entry-list-item"
            >
              <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
              <span style={{ fontWeight: 500 }}>צור התראה חדשה</span>
            </button>

            {projectAlerts.length === 0 ? (
              <div className="empty-state card">
                <div className="empty-state-icon">
                  <AlertTriangle size={48} strokeWidth={1.5} />
                </div>
                <h3 className="empty-state-title">עדיין אין התראות</h3>
                <p>הוסף התראות כדי לקבל תזכורת כשפרויקט עובר ספים מסוימים</p>
              </div>
            ) : (
              projectAlerts.map(alert => {
                const isTriggered = triggeredAlerts.some(t => t.id === alert.id);
                const typeLabels = { hours: '⏱️ שעות', budget: '💰 תקציב', payment: '💳 תשלומים', deadline: '📅 דדליין' };
                return (
                  <div key={alert.id} className={`alert-item card ${isTriggered ? 'alert-triggered' : ''} ${alert.is_dismissed ? 'alert-dismissed' : ''}`}>
                    <div className="alert-content">
                      <div className="alert-header">
                        <span className="alert-type-badge">{typeLabels[alert.alert_type] || alert.alert_type}</span>
                        {isTriggered && !alert.is_dismissed && <span className="badge badge-warning">נחצה!</span>}
                        {alert.is_dismissed ? <span className="badge badge-muted">טופל</span> : null}
                      </div>
                      <div className="alert-threshold">
                        סף: {alert.alert_type === 'hours' ? `${alert.threshold_value} שעות` :
                          alert.alert_type === 'deadline' ? `${alert.threshold_days} ימים` :
                          `₪${alert.threshold_value}`}
                      </div>
                      {alert.message && <div className="alert-message">{alert.message}</div>}
                    </div>
                    <div className="alert-actions">
                      {isTriggered && !alert.is_dismissed && (
                        <button
                          onClick={async () => {
                            await alertsAPI.dismiss(alert.id);
                            loadData();
                          }}
                          className="btn btn-sm btn-secondary"
                          title="סמן כטופל"
                        >
                          טופל
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingAlert(alert); setShowAlertModal(true); }}
                        className="btn btn-ghost btn-icon btn-sm"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={async () => {
                          if (await modal.confirm('האם למחוק את ההתראה?')) {
                            try {
                              await alertsAPI.delete(alert.id);
                              loadData();
                            } catch (error) {
                              modal.error(error.message);
                            }
                          }
                        }}
                        className="btn btn-ghost btn-icon btn-sm"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {showAlertModal && (
        <AlertModal
          alert={editingAlert}
          projectId={id}
          onSave={handleSaveAlert}
          onClose={() => { setShowAlertModal(false); setEditingAlert(null); }}
        />
      )}

      {showTaskModal && (
        <TaskModal
          task={editingTask}
          projectHourlyRate={project.hourly_rate || project.client_hourly_rate}
          projectPricingType={project.pricing_type}
          onSave={handleSaveTask}
          onClose={() => { setShowTaskModal(false); setEditingTask(null); }}
        />
      )}

      {showConflictModal && (
        <TimerConflictModal
          targetProject={project.name}
          targetTask={pendingTimerStart?.taskId ? tasks.find(t => t.id === pendingTimerStart.taskId)?.name : null}
          onCancel={() => { setShowConflictModal(false); setPendingTimerStart(null); }}
          onContinue={handleConflictContinue}
          onStopTimer={handleConflictStopTimer}
        />
      )}

      {showTimeEntryModal && (
        <TimeEntryModal
          entry={editingEntry}
          projectId={id}
          taskId={null}
          onSave={handleSaveTimeEntry}
          onClose={() => { setShowTimeEntryModal(false); setEditingEntry(null); }}
        />
      )}

      {showShareModal && (
        <ShareModal
          resourceType="project"
          resourceId={id}
          resourceName={project.name}
          existingLinks={shareLinks}
          onClose={() => setShowShareModal(false)}
          onSuccess={loadData}
        />
      )}

      {showReminderModal && (
        <RemindersModal
          isOpen={showReminderModal}
          onClose={() => setShowReminderModal(false)}
          initialAssociation={{ type: 'project', id: id, clientId: project.client_id, projectId: id }}
        />
      )}

      {showPaymentModal && (
        <PaymentModal
          payment={editingPayment}
          projectId={id}
          onSave={handleSavePayment}
          onClose={() => { setShowPaymentModal(false); setEditingPayment(null); }}
        />
      )}

      {showProjectModal && (
        <ProjectModal
          project={editingProject}
          clientHourlyRate={project.client_hourly_rate}
          clientId={project.client_id}
          onSave={handleSaveProject}
          onClose={() => { setShowProjectModal(false); setEditingProject(null); }}
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

      {showCredentialModal && (
        <CredentialModal
          isOpen={showCredentialModal}
          onClose={() => { setShowCredentialModal(false); setEditingCredential(null); }}
          onSave={handleSaveCredential}
          credential={editingCredential}
          clientId={project.client_id}
          projectId={id}
        />
      )}

      <Forum
        entityType="project"
        entityId={id}
      />
    </div>
  );
}

export default ProjectDetail;
