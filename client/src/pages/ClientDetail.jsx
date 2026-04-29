import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate, useOutletContext } from 'react-router-dom';
import { Plus, Edit2, Trash2, Play, Pause, Square, X, Mail, Phone, Building2, Bell, Folder, Clock, DollarSign, RotateCw, Star, MessageSquare, Globe, CreditCard, Share2, Link as LinkIcon, Lock, TrendingUp, Key, FileText, StickyNote, CheckSquare, Circle, CircleCheck, Copy } from 'lucide-react';
import { clientsAPI, projectsAPI, tasksAPI, statsAPI, shareAPI, remindersAPI, timerAPI, paymentsAPI, credentialsAPI, filesAPI, leadsAPI } from '../services/api';
import BreadcrumbItem from '../components/BreadcrumbItem';
import { formatDurationHuman, formatCurrency, formatDateTime, formatDate, formatTimeOnly, calculateEndTime } from '../utils/format';
import { getProjectStatus, PROJECT_STATUSES, getClientStatus, CLIENT_STATUSES } from '../utils/status';
import useStore from '../store/useStore';
import { useModal } from '../components/Modal';
import ProjectModal from '../components/ProjectModal';
import TimerConflictModal from '../components/TimerConflictModal';
import ShareModal from '../components/ShareModal';
import RemindersModal from '../components/RemindersModal';
import ReminderItem from '../components/ReminderItem';
import '../pages/Reminders.css';
import ClientModal from '../components/ClientModal';
import Forum from '../components/Forum';
import NotesTab from '../components/NotesTab';
import { CredentialModal, CredentialsSection } from '../components/Credentials';
import FilesSection from '../components/FilesSection';
import TimeEntryModal from '../components/TimeEntryModal';
import TimeEntryItem from '../components/TimeEntryItem';
import ActiveTimerEntry from '../components/ActiveTimerEntry';
import PaymentModal from '../components/PaymentModal';
import SmartPaymentModal from '../components/SmartPaymentModal';
import PaymentStatusBadge, { calculateProjectEarnings } from '../components/PaymentStatusBadge';
import TimeSummary from '../components/TimeSummary';
import LeadModal from '../components/LeadModal';
import LeadStatusBadge from '../components/LeadStatusBadge';
import '../components/Credentials.css';
import './ClientDetail.css';
import '../styles/reminders-mini.css';
import { apps } from '../apps';

function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { setStats: setGlobalStats } = useOutletContext();
  const modal = useModal();
  const { activeTimers, startTimer, pauseTimer, resumeTimer, stopTimer, discardTimer, getTimerForProject, integrations, isAddonEnabled } = useStore();

  const [client, setClient] = useState(null);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLinks, setShareLinks] = useState([]);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [clientReminders, setClientReminders] = useState([]);
  const [showClientModal, setShowClientModal] = useState(false);
  const [activeTab, setActiveTab] = useState('projects');
  const [timeEntries, setTimeEntries] = useState([]);
  const [payments, setPayments] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [editingCredential, setEditingCredential] = useState(null);
  const [files, setFiles] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [showTimeEntryModal, setShowTimeEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [showSmartPaymentModal, setShowSmartPaymentModal] = useState(false);

  // Timer conflict modal state
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [pendingTimerStart, setPendingTimerStart] = useState(null);

  // Stop timer modal state
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopNotes, setStopNotes] = useState('');
  const [stoppingTimer, setStoppingTimer] = useState(null);

  // Client-level timer state (stored in localStorage)
  const [clientTimer, setClientTimer] = useState(null);
  const [showClientTimerStopModal, setShowClientTimerStopModal] = useState(false);
  const [clientTimerNotes, setClientTimerNotes] = useState('');
  const [selectedProjectForTimer, setSelectedProjectForTimer] = useState('');
  const [clientTimerElapsed, setClientTimerElapsed] = useState(0);

  // Breadcrumb dropdown loader
  const loadAllClients = useCallback(async () => {
    const clients = await clientsAPI.getAll();
    return clients.map(c => ({
      id: c.id,
      name: c.name,
      to: `/clients/${c.id}`
    }));
  }, []);

  const loadData = async () => {
    try {
      const [clientData, projectsData, statsData, entriesData, paymentsData, credentialsData, allTasks] = await Promise.all([
        clientsAPI.getOne(id),
        projectsAPI.getAll(id),
        statsAPI.getClient(id),
        timerAPI.getEntries().then(entries => entries.filter(e => e.client_id === id)),
        paymentsAPI.getAll().then(payments => payments.filter(p => p.client_id === id)),
        credentialsAPI.getByClient(id),
        tasksAPI.getAll()
      ]);
      
      // Get project IDs for this client
      const projectIds = new Set(projectsData.map(p => p.id));
      
      // Filter tasks that belong to this client's projects
      const tasksData = allTasks.filter(task => projectIds.has(task.project_id));
      
      // Load files separately to avoid failing the whole page if files API has auth issues
      let filesData = [];
      try {
        filesData = await filesAPI.getByClient(id);
      } catch (e) {
        console.warn('Failed to load files:', e);
      }
      setClient(clientData);
      setProjects(projectsData);
      setStats(statsData);
      // Sort tasks by created_at descending (newest first)
      setTasks(tasksData.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));

      if (statsData) {
        const totalHours = (statsData.time?.total || 0) / 3600;
        const totalEarnings = statsData.earnings?.total || 0;
        const effectiveRate = totalHours > 0 ? totalEarnings / totalHours : 0;

        setGlobalStats([
          { label: 'פרויקטים', value: statsData.projects?.total || 0, icon: <Folder size={20} /> },
          { label: 'פרויקטים פעילים', value: statsData.projects?.active || 0, icon: <RotateCw size={20} /> },
          { label: 'שעות עבודה', value: formatDurationHuman(statsData.time?.total || 0), icon: <Clock size={20} /> },
          { label: 'סה"כ חיוב', value: formatCurrency(statsData.earnings?.total || 0), icon: <DollarSign size={20} /> },
          { label: 'תעריף בפועל', value: `${formatCurrency(effectiveRate)}/שעה`, icon: <TrendingUp size={20} /> }
        ]);
      }

      setTimeEntries(entriesData);
      setPayments(paymentsData);
      setCredentials(credentialsData);
      setFiles(filesData);

      // Load share links
      try {
        const allLinks = await shareAPI.getMyLinks();
        const clientLinks = allLinks.filter(link => link.resource_type === 'client' && link.resource_id === id);
        setShareLinks(clientLinks);
      } catch (e) {
        // Ignore share links loading errors
      }

      // Load reminders
      try {
        const allReminders = await remindersAPI.getAll({ include_read: 'true' });
        const relevantReminders = allReminders.filter(r =>
          r.association_type === 'client' && r.association_id === id
        );
        setClientReminders(relevantReminders);
      } catch (e) {
        console.error('Error loading reminders:', e);
      }

      // Load opportunities (leads linked to this client)
      try {
        const allLeads = await leadsAPI.getAll();
        const clientOpportunities = allLeads.filter(l => l.client_id === id);
        setOpportunities(clientOpportunities);
      } catch (e) {
        console.error('Error loading opportunities:', e);
      }
    } catch (error) {
      console.error('Failed to load client:', error);
      navigate('/clients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  // Load client timer from localStorage and set up interval for elapsed time
  useEffect(() => {
    const storageKey = `clientTimer_${id}`;
    const savedTimer = localStorage.getItem(storageKey);
    if (savedTimer) {
      const timer = JSON.parse(savedTimer);
      setClientTimer(timer);
    }
  }, [id]);

  // Update elapsed time every second for client timer
  useEffect(() => {
    if (!clientTimer) {
      setClientTimerElapsed(0);
      return;
    }

    const calculateElapsed = () => {
      let total = clientTimer.accumulated_seconds || 0;
      if (clientTimer.is_running && clientTimer.start_time) {
        const startTime = new Date(clientTimer.start_time).getTime();
        total += Math.floor((Date.now() - startTime) / 1000);
      }
      return total;
    };

    setClientTimerElapsed(calculateElapsed());
    const interval = setInterval(() => {
      setClientTimerElapsed(calculateElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [clientTimer]);

  const handleSaveProject = async (projectData) => {
    try {
      if (editingProject) {
        await projectsAPI.update(editingProject.id, projectData);
      } else {
        await projectsAPI.create({ ...projectData, client_id: id });
      }
      loadData();
      setShowProjectModal(false);
      setEditingProject(null);
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDeleteProject = async (projectId) => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך למחוק את הפרויקט?',
      { title: 'מחיקת פרויקט', confirmText: 'מחק', type: 'error' }
    );

    if (confirmed) {
      try {
        await projectsAPI.delete(projectId);
        // Update state immediately for instant UI feedback
        setProjects(prev => prev.filter(p => p.id !== projectId));
        setTasks(prev => prev.filter(t => t.project_id !== projectId));
        // Reload data in background to ensure consistency
        loadData();
        modal.success('הפרויקט נמחק בהצלחה');
      } catch (error) {
        modal.error(error.message);
        // Reload data on error to restore correct state
        loadData();
      }
    }
  };

  const handleUpdateProjectStatus = async (project, newStatus) => {
    try {
      await projectsAPI.update(project.id, { ...project, status: newStatus });
      loadData();
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleToggleTask = async (task) => {
    try {
      const newStatus = task.status === 'completed' ? 'pending' : 'completed';
      await tasksAPI.update(task.id, { ...task, status: newStatus });
      
      // Update local state
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: newStatus } : t
      ));
      
      modal.success(newStatus === 'completed' ? 'המשימה הושלמה!' : 'המשימה הוחזרה לביצוע');
    } catch (error) {
      modal.error('שגיאה בעדכון המשימה');
    }
  };

  const handleSaveClient = async (clientData) => {
    try {
      await clientsAPI.update(id, clientData);
      loadData();
      setShowClientModal(false);
      modal.success('פרטי הלקוח עודכנו בהצלחה');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDeleteClient = async () => {
    try {
      navigate('/clients');
    } catch (error) {
      console.error('Error navigating after delete:', error);
    }
  };

  const handleToggleFavorite = async () => {
    try {
      await clientsAPI.toggleFavorite(client.id, !client.is_favorite);
      loadData();
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const handleToggleProjectFavorite = async (e, project) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Toggle project favorite clicked:', { projectId: project.id, currentFavorite: project.is_favorite, newFavorite: !project.is_favorite });
    try {
      const result = await projectsAPI.toggleFavorite(project.id, !project.is_favorite);
      console.log('Toggle project favorite result:', result);
      loadData();
    } catch (error) {
      console.error('Failed to toggle project favorite:', error);
      modal.error('שגיאה בעדכון המועדפים');
    }
  };

  const handleUpdateClientStatus = async (newStatus) => {
    try {
      await clientsAPI.update(client.id, { ...client, status: newStatus });
      loadData();
    } catch (error) {
      modal.error(error.message);
    }
  };

  // Timer button click handler
  const handleTimerButtonClick = async (projectId) => {
    const existingTimer = getTimerForProject(projectId, null);

    // If there's already a timer for this project, toggle pause/resume
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
      const project = projects.find(p => p.id === projectId);
      setPendingTimerStart({ projectId, projectName: project?.name });
      setShowConflictModal(true);
      return;
    }

    // No conflicts, start timer directly
    await doStartTimer(projectId);
  };

  // Actually start the timer
  const doStartTimer = async (projectId) => {
    try {
      await startTimer(projectId, null);
      modal.success('הטיימר הופעל!');
    } catch (error) {
      modal.error(error.message);
    }
  };

  // Handle continue from conflict modal
  const handleConflictContinue = async () => {
    setShowConflictModal(false);
    if (pendingTimerStart) {
      await doStartTimer(pendingTimerStart.projectId);
      setPendingTimerStart(null);
    }
  };

  // Handle stop timer from conflict modal
  const handleConflictStopTimer = async () => {
    setShowConflictModal(false);
    if (pendingTimerStart) {
      await doStartTimer(pendingTimerStart.projectId);
      setPendingTimerStart(null);
    }
  };

  const handleStopTimerClick = (timer, projectName) => {
    setStoppingTimer({ ...timer, projectName });
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

  // Get timer button state for a project
  const getProjectTimerButton = (projectId) => {
    const projectTimer = getTimerForProject(projectId, null);

    if (projectTimer) {
      return {
        icon: projectTimer.is_running ? '⏸' : '▶',
        text: projectTimer.is_running ? 'השהה' : 'המשך',
        className: projectTimer.is_running ? 'btn-warning' : 'btn-success'
      };
    }

    return {
      icon: '▶',
      text: 'התחל טיימר',
      className: 'btn-primary'
    };
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
        const allTasks = await tasksAPI.getAll(null, { includeSubtasks: true });
        const projectIds = new Set(projects.map(p => p.id));
        tasksToExport = allTasks.filter(task => projectIds.has(task.project_id));
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

  // Client-level timer handlers
  const saveClientTimerToStorage = (timer) => {
    const storageKey = `clientTimer_${id}`;
    if (timer) {
      localStorage.setItem(storageKey, JSON.stringify(timer));
    } else {
      localStorage.removeItem(storageKey);
    }
  };

  const handleClientTimerStart = () => {
    const timer = {
      id: `client_${id}_${Date.now()}`,
      client_id: id,
      client_name: client.name,
      start_time: new Date().toISOString(),
      accumulated_seconds: 0,
      is_running: true
    };
    setClientTimer(timer);
    saveClientTimerToStorage(timer);
    modal.success('הטיימר הופעל!');
  };

  const handleClientTimerPause = () => {
    if (!clientTimer) return;
    const now = Date.now();
    const startTime = new Date(clientTimer.start_time).getTime();
    const additionalSeconds = Math.floor((now - startTime) / 1000);

    const updated = {
      ...clientTimer,
      is_running: false,
      accumulated_seconds: (clientTimer.accumulated_seconds || 0) + additionalSeconds,
      start_time: null
    };
    setClientTimer(updated);
    saveClientTimerToStorage(updated);
  };

  const handleClientTimerResume = () => {
    if (!clientTimer) return;
    const updated = {
      ...clientTimer,
      is_running: true,
      start_time: new Date().toISOString()
    };
    setClientTimer(updated);
    saveClientTimerToStorage(updated);
  };

  const handleClientTimerStopClick = () => {
    setClientTimerNotes('');
    setSelectedProjectForTimer(projects.length > 0 ? projects[0].id : '');
    setShowClientTimerStopModal(true);
  };

  const handleClientTimerDiscard = async () => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך לבטל את הטיימר? הזמן לא יישמר.',
      { title: 'ביטול טיימר', confirmText: 'בטל', type: 'error' }
    );
    if (confirmed) {
      setClientTimer(null);
      saveClientTimerToStorage(null);
      modal.success('הטיימר בוטל');
    }
  };

  const handleSaveClientTimer = async () => {
    if (!selectedProjectForTimer) {
      modal.error('יש לבחור פרויקט');
      return;
    }

    // Calculate final duration
    let totalSeconds = clientTimer.accumulated_seconds || 0;
    if (clientTimer.is_running && clientTimer.start_time) {
      const startTime = new Date(clientTimer.start_time).getTime();
      totalSeconds += Math.floor((Date.now() - startTime) / 1000);
    }

    try {
      // Create a time entry directly
      await timerAPI.createEntry({
        project_id: selectedProjectForTimer,
        duration: totalSeconds,
        notes: clientTimerNotes,
        date: new Date().toISOString()
      });

      // Clear the client timer
      setClientTimer(null);
      saveClientTimerToStorage(null);
      setShowClientTimerStopModal(false);
      setClientTimerNotes('');
      setSelectedProjectForTimer('');

      modal.success('הזמן נשמר בהצלחה!');
      loadData();
    } catch (error) {
      modal.error('שגיאה בשמירת הזמן: ' + error.message);
    }
  };

  // Credentials handlers
  const handleSaveCredential = async (credentialData) => {
    try {
      if (editingCredential) {
        await credentialsAPI.update(editingCredential.id, credentialData);
      } else {
        await credentialsAPI.create({ ...credentialData, client_id: id });
      }
      const updated = await credentialsAPI.getByClient(id);
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
        const updated = await credentialsAPI.getByClient(id);
        setCredentials(updated);
        modal.success('הסיסמה נמחקה בהצלחה');
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  // Time entry handler
  const handleSaveTimeEntry = async (entryData) => {
    try {
      if (editingEntry) {
        await timerAPI.updateEntry(editingEntry.id, entryData);
        modal.success('הרשומה עודכנה בהצלחה');
      } else {
        await timerAPI.createEntry(entryData);
        modal.success('רשומת הזמן נוספה בהצלחה');
      }
      loadData();
      setShowTimeEntryModal(false);
      setEditingEntry(null);
    } catch (error) {
      modal.error(error.message);
    }
  };

  // Delete time entry handler
  const handleDeleteEntry = async (entryId) => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך למחוק את רשומת הזמן?',
      { title: 'מחיקת רשומה', confirmText: 'מחק', type: 'error' }
    );

    if (confirmed) {
      try {
        await timerAPI.deleteEntry(entryId);
        setTimeEntries(prev => prev.filter(e => e.id !== entryId));
        modal.success('הרשומה נמחקה בהצלחה');
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  // Payment handler
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

  // Smart payment handler (multiple allocations)
  const handleSaveSmartPayment = async ({ payments, totalAmount, creditBalance }) => {
    try {
      // Create all payment records
      for (const payment of payments) {
        await paymentsAPI.create(payment);
      }
      
      loadData();
      setShowSmartPaymentModal(false);
      
      if (creditBalance > 0) {
        modal.success(`התשלום נקלט בהצלחה! יתרת זכות: ₪${creditBalance.toFixed(2)}`);
      } else {
        modal.success('התשלום נקלט בהצלחה!');
      }
    } catch (error) {
      modal.error(error.message);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  if (!client) {
    return <div className="page">לקוח לא נמצא</div>;
  }

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
            label={client.name}
            currentId={id}
            isCurrent={true}
            onLoadItems={loadAllClients}
            onRename={async (newName) => {
              await clientsAPI.update(id, { name: newName });
              loadData();
            }}
          />
        </div>

        {/* Lead origin link */}
        {client.lead_id && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem'
          }}>
            <span>מקור:</span>
            <Link to={`/leads/${client.lead_id}`} style={{ color: 'var(--accent-primary)' }}>
              ליד מקורי
            </Link>
          </div>
        )}

        {/* Time Summary */}
        <TimeSummary
          totalSeconds={stats?.time?.total || 0}
          hourlyRate={client.hourly_rate || 250}
          showEarnings={true}
          size="small"
        />

        {/* Actions Bar - Moved to Header */}
        <div className="header-actions">
          <select
            className={`client-status-select ${getClientStatus(client.status).badge}`}
            value={client.status}
            onChange={e => handleUpdateClientStatus(e.target.value)}
          >
            {CLIENT_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.icon}{s.icon ? ' ' : ''}{s.label}</option>
            ))}
          </select>

          <button
            className={`btn-icon-star-small ${client.is_favorite ? 'is-favorite' : ''}`}
            onClick={handleToggleFavorite}
            title={client.is_favorite ? 'הסר ממועדפים' : 'הוסף למועדפים'}
          >
            <Star size={16} fill={client.is_favorite ? "currentColor" : "none"} />
          </button>

          <div className="divider-vertical"></div>

          {/* Contact Info (Minimal) */}
          <div className="client-contact-minimal">
            {client.email && (
              <a href={`mailto:${client.email}`} className="contact-item-mini" title={client.email}>
                <Mail size={14} />
              </a>
            )}
            {client.phone && (
              <a href={`tel:${client.phone}`} className="contact-item-mini" title={client.phone}>
                <Phone size={14} />
              </a>
            )}
            {client.source_name && (
              <span className="contact-item-mini" title={`מקור: ${client.source_name}`}>
                <Globe size={14} />
              </span>
            )}
          </div>

          <div className="divider-vertical"></div>

          {/* Client Timer Button */}
          {!clientTimer ? (
            <button
              onClick={handleClientTimerStart}
              className="btn btn-primary btn-sm client-timer-btn"
              title="התחל טיימר"
            >
              <Play size={16} />
              <span className="mobile-hide">טיימר</span>
            </button>
          ) : (
            <div className="client-timer-controls">
              <span className="client-timer-elapsed">
                {formatDurationHuman(clientTimerElapsed)}
              </span>
              {clientTimer.is_running ? (
                <button
                  onClick={handleClientTimerPause}
                  className="timer-btn timer-pause"
                  title="השהה"
                >
                  <Pause size={14} />
                </button>
              ) : (
                <button
                  onClick={handleClientTimerResume}
                  className="timer-btn timer-play"
                  title="המשך"
                >
                  <Play size={14} />
                </button>
              )}
              <button
                onClick={handleClientTimerStopClick}
                className="timer-btn timer-stop"
                title="עצור ושמור"
              >
                <Square size={14} />
              </button>
              <button
                onClick={handleClientTimerDiscard}
                className="timer-btn timer-discard"
                title="בטל"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="divider-vertical"></div>

          <button
            onClick={() => setShowSmartPaymentModal(true)}
            className="btn btn-success btn-sm"
            title="הכנס תשלום"
          >
            <CreditCard size={16} />
            <span className="mobile-hide">הכנס תשלום</span>
          </button>

          <button onClick={() => setShowClientModal(true)} className="btn btn-secondary btn-sm" title="ערוך פרטים">
            <Edit2 size={16} />
            <span className="mobile-hide">עריכה</span>
          </button>

          <div className="share-action-wrapper">
            <button
              onClick={() => setShowShareModal(true)}
              className={`btn btn-sm ${shareLinks.length > 0 ? 'btn-secondary active-share' : 'btn-ghost'}`}
              title="שיתוף עם הלקוח"
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
              .filter(action => action.location === 'client_detail' && (!action.condition || action.condition({ client, integrations })))
              .map((action, index) => {
                const Icon = action.icon;
                return (
                  <button
                    key={`${app.id}-${index}`}
                    onClick={() => action.onClick({ client })}
                    className="btn btn-ghost btn-sm"
                    title={action.label}
                  >
                    {Icon && <Icon size={16} />}
                  </button>
                );
              });
          })}
        </div>
      </div>


      {/* Notes Section */}
      {client.notes && (
        <div className="notes-section card">
          <div className="notes-header">
            <span className="notes-icon">📝</span>
            <h3>פתק פרטי</h3>
          </div>
          <div className="notes-content">{client.notes}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'projects' ? 'active' : ''}`}
          onClick={() => setActiveTab('projects')}
        >
          פרויקטים ({projects.length})
        </button>
        <button
          className={`tab ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          <CheckSquare size={16} />
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
            תזכורות ({clientReminders.length})
          </button>
        )}
        {isAddonEnabled('leads_management') && (
          <button
            className={`tab ${activeTab === 'opportunities' ? 'active' : ''}`}
            onClick={() => setActiveTab('opportunities')}
          >
            <TrendingUp size={16} />
            הזדמנויות ({opportunities.length})
          </button>
        )}
      </div>

      {/* Projects Tab */}
      {activeTab === 'projects' && (
        <div className="tab-content">
          <div className="items-list">
            {/* New Project Button - List Style */}
            <button
              onClick={() => setShowProjectModal(true)}
              className="list-item new-project-list-item"
            >
              <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
              <span style={{ fontWeight: 500 }}>צור פרויקט חדש</span>
            </button>

            {projects.map(project => {
              const projectTimer = getTimerForProject(project.id, null);
              
              return (
                <div key={project.id} className="list-item">
                  <button
                    className={`btn-icon-star-dashboard ${project.is_favorite ? 'is-favorite' : ''}`}
                    onClick={(e) => handleToggleProjectFavorite(e, project)}
                    title={project.is_favorite ? 'הסר ממועדפים' : 'הוסף למועדפים'}
                  >
                    <Star size={16} fill={project.is_favorite ? "currentColor" : "none"} />
                  </button>
                  <div className="list-item-content">
                    <div className="list-item-title">
                      <Link to={`/projects/${project.id}`} className="list-item-link">
                        {project.name}
                      </Link>
                    </div>
                    
                    <div className="list-item-subtitle">
                      {project.created_at && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} title="תאריך יצירה">
                          {formatDate(project.created_at)}
                        </span>
                      )}
                      <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                      <span>{project.task_count} משימות</span>
                      <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                      <span>{formatDurationHuman(project.total_time || 0)}</span>
                      <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                      <PaymentStatusBadge
                        totalEarned={calculateProjectEarnings(project, client)}
                        paidAmount={project.paid_amount || 0}
                        onClick={() => navigate(`/projects/${project.id}?tab=payments`)}
                      />
                    </div>
                  </div>

                  <div className="project-timer-area">
                    {/* Actions */}
                    <div className="list-actions" style={{ marginLeft: '0.5rem' }}>
                       <Link to={`/projects/${project.id}`} className="btn-icon-tiny" title="פתח">
                        <LinkIcon size={16} />
                      </Link>
                      <button
                        onClick={() => { setEditingProject(project); setShowProjectModal(true); }}
                        className="btn-icon-tiny"
                        title="ערוך"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteProject(project.id)}
                        className="btn-icon-tiny"
                        title="מחק"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Status Select */}
                    <select
                      className={`project-status-select ${getProjectStatus(project.status).badge}`}
                      value={project.status}
                      onChange={e => handleUpdateProjectStatus(project, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      style={{ marginLeft: '0.5rem' }}
                    >
                      {PROJECT_STATUSES.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>

                    {/* Timer Controls */}
                    {(() => {
                      if (!projectTimer) {
                        return (
                          <button
                            className="timer-btn timer-play"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTimerButtonClick(project.id);
                            }}
                            title="התחל טיימר"
                            disabled={project.status === 'completed'}
                          >
                            <Play size={14} />
                          </button>
                        );
                      }

                      return (
                        <div className="timer-controls">
                          <span className="timer-elapsed">
                            {formatDurationHuman(
                              projectTimer.is_running 
                                ? projectTimer.accumulated_seconds + Math.floor((Date.now() - new Date(projectTimer.start_time).getTime()) / 1000)
                                : projectTimer.accumulated_seconds
                            )}
                          </span>
                          
                          {projectTimer.is_running ? (
                            <button
                              className="timer-btn timer-pause"
                              onClick={() => handleTimerButtonClick(project.id)}
                              title="השהה"
                            >
                              <Pause size={14} />
                            </button>
                          ) : (
                            <button
                              className="timer-btn timer-play"
                              onClick={() => handleTimerButtonClick(project.id)}
                              title="המשך"
                            >
                              <Play size={14} />
                            </button>
                          )}
                          
                          <button
                            className="timer-btn timer-stop"
                            onClick={() => handleStopTimerClick(projectTimer, project.name)}
                            title="עצור ושמור"
                          >
                            <Square size={14} />
                          </button>
                          
                          <button
                            className="timer-btn timer-discard"
                            onClick={(e) => { e.stopPropagation(); discardTimer(projectTimer.id); }}
                            title="בטל טיימר"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <div className="tab-content">
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

            {tasks.length === 0 ? (
              <div className="empty-state card">
                <div className="empty-state-icon">
                  <CheckSquare size={48} strokeWidth={1.5} />
                </div>
                <h3 className="empty-state-title">עדיין אין משימות</h3>
                <p>משימות מפרויקטים יופיעו כאן</p>
              </div>
            ) : (
              tasks.map(task => {
                const isCompleted = task.status === 'completed';
                return (
                  <div key={task.id} className={`list-item task-item ${isCompleted ? 'completed' : ''}`}>
                    <button
                      className={`task-checkbox ${isCompleted ? 'checked' : ''}`}
                      onClick={() => handleToggleTask(task)}
                      title={isCompleted ? 'סמן כלא הושלם' : 'סמן כהושלם'}
                    >
                      {isCompleted ? <CircleCheck size={16} /> : <Circle size={16} />}
                    </button>

                    <div className="list-item-content">
                      <div className="list-item-title">
                        <Link to={`/tasks/${task.id}`} className="list-item-link">
                          {task.name}
                        </Link>
                      </div>
                      
                      <div className="list-item-subtitle">
                        {task.created_at && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} title="תאריך יצירה">
                            {formatDate(task.created_at)}
                          </span>
                        )}
                        {task.project_name && (
                          <>
                            <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                            <Folder size={14} />
                            <Link to={`/projects/${task.project_id}`} className="clickable-name">
                              {task.project_name}
                            </Link>
                          </>
                        )}
                        <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                        <span>{formatDurationHuman(task.total_time || 0)}</span>
                      </div>
                    </div>

                    <div className="list-actions">
                      <Link to={`/tasks/${task.id}`} className="btn-icon-tiny" title="פתח">
                        <LinkIcon size={16} />
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Time Entries Tab */}
      {activeTab === 'time' && (() => {
        // Get active timers for this client's projects
        const projectIds = new Set(projects.map(p => p.id));
        const clientActiveTimers = activeTimers.filter(timer => projectIds.has(timer.project_id));
        
        return (
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

            {/* Active Timers for this client's projects */}
            {clientActiveTimers.map(timer => (
              <ActiveTimerEntry
                key={`active-${timer.id}`}
                timer={timer}
                showProject={true}
                showTask={true}
                onPause={() => pauseTimer(timer.id)}
                onResume={() => resumeTimer(timer.id)}
                onStop={() => handleStopTimerClick(timer, timer.project_name)}
              />
            ))}

          {timeEntries.length === 0 && clientActiveTimers.length === 0 ? (
              <div className="empty-state-inline">
                <Clock size={24} strokeWidth={1.5} />
                <span>עדיין אין רשומות זמן</span>
            </div>
          ) : (
              timeEntries.map(entry => {
                const entryTimer = entry.task_id
                  ? getTimerForProject(entry.project_id, entry.task_id)
                  : getTimerForProject(entry.project_id, null);

                return (
                  <TimeEntryItem
                    key={entry.id}
                    entry={entry}
                    timer={entryTimer}
                    showProject={true}
                    showTask={true}
                    onTimerClick={() => handleTimerButtonClick(entry.project_id)}
                    onStopClick={entryTimer ? () => handleStopTimerClick(entryTimer, entry.project_name) : null}
                    onEditClick={() => { setEditingEntry(entry); setShowTimeEntryModal(true); }}
                    onDeleteClick={() => handleDeleteEntry(entry.id)}
                  />
                );
              })
          )}
          </div>
        </div>
        );
      })()}

      {/* Payments Tab */}
      {activeTab === 'payments' && (
        <div className="tab-content">
          <div className="payments-list">
            {/* New Payment Button - List Style */}
            {projects.length > 0 && (
              <button
                onClick={() => setShowPaymentModal(true)}
                className="list-item new-payment-list-item"
              >
                <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
                <span style={{ fontWeight: 500 }}>הוסף תשלום חדש</span>
              </button>
            )}

          {payments.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-state-icon">
                <CreditCard size={48} strokeWidth={1.5} />
              </div>
              <h3 className="empty-state-title">עדיין אין תשלומים</h3>
              <p>תשלומים מפרויקטים יופיעו כאן</p>
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
                    {payment.project_name && (
                      <div className="payment-project">
                        <Folder size={14} />
                        פרויקט: <Link to={`/projects/${payment.project_id}`}>{payment.project_name}</Link>
                      </div>
                    )}
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
            entityType="client"
            entityId={id}
            files={files}
            onFilesChange={loadData}
          />
        </div>
      )}

      {/* Notes Tab */}
      {activeTab === 'notes' && isAddonEnabled('notes') && (
        <div className="tab-content">
          <NotesTab entityType="client" entityId={id} />
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

          {clientReminders.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-state-icon">
                <Bell size={48} strokeWidth={1.5} />
              </div>
              <h3 className="empty-state-title">עדיין אין תזכורות</h3>
              <p>הוסף תזכורות כדי לא לשכוח משימות חשובות</p>
            </div>
          ) : (
              clientReminders.map(reminder => (
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

      {/* Opportunities Tab */}
      {activeTab === 'opportunities' && isAddonEnabled('leads_management') && (
        <div className="tab-content">
          <div className="items-list">
            <button
              onClick={() => setShowLeadModal(true)}
              className="list-item new-project-list-item"
            >
              <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
              <span style={{ fontWeight: 500 }}>הזדמנות חדשה</span>
            </button>

            {opportunities.length === 0 ? (
              <div className="empty-state card">
                <div className="empty-state-icon">
                  <TrendingUp size={48} strokeWidth={1.5} />
                </div>
                <h3 className="empty-state-title">אין הזדמנויות פתוחות</h3>
                <p>צור הזדמנות חדשה למעקב אחרי עסקאות עם לקוח זה</p>
              </div>
            ) : (
              opportunities.map(lead => (
                <div key={lead.id} className="list-item" onClick={() => navigate(`/leads/${lead.id}`)} style={{ cursor: 'pointer' }}>
                  <div className="list-item-content">
                    <div className="list-item-title">
                      <Link to={`/leads/${lead.id}`} className="list-item-link" onClick={e => e.stopPropagation()}>
                        {lead.name}
                      </Link>
                    </div>
                    <div className="list-item-subtitle">
                      <LeadStatusBadge status={lead.status} size="sm" />
                      {lead.expected_value > 0 && (
                        <>
                          <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                          <span>₪{Number(lead.expected_value).toLocaleString('he-IL')}</span>
                        </>
                      )}
                      {lead.expected_close_date && (
                        <>
                          <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                          <span>{new Date(lead.expected_close_date).toLocaleDateString('he-IL')}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Client Details */}
      {(client.address || client.bank_name || client.notes) && (
        <div className="client-details-section">
          <h3>פרטים נוספים</h3>

          <div className="details-grid">
            {client.address && (
              <div className="detail-item">
                <span className="detail-label">כתובת</span>
                <span className="detail-value">{client.address}</span>
              </div>
            )}

            {client.bank_name && (
              <div className="detail-item">
                <span className="detail-label">פרטי בנק</span>
                <span className="detail-value ltr">
                  {client.bank_name} | סניף {client.bank_branch} | חשבון {client.bank_account}
                </span>
              </div>
            )}

            {client.notes && (
              <div className="detail-item">
                <span className="detail-label">הערות</span>
                <span className="detail-value">{client.notes}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {showProjectModal && (
        <ProjectModal
          project={editingProject}
          clientHourlyRate={client.hourly_rate}
          clientId={client.id}
          onSave={handleSaveProject}
          onClose={() => { setShowProjectModal(false); setEditingProject(null); }}
        />
      )}

      {showConflictModal && (
        <TimerConflictModal
          targetProject={pendingTimerStart?.projectName}
          targetTask={null}
          onCancel={() => { setShowConflictModal(false); setPendingTimerStart(null); }}
          onContinue={handleConflictContinue}
          onStopTimer={handleConflictStopTimer}
        />
      )}

      {showShareModal && (
        <ShareModal
          resourceType="client"
          resourceId={id}
          resourceName={client.name}
          existingLinks={shareLinks}
          onClose={() => setShowShareModal(false)}
          onSuccess={loadData}
        />
      )}

      {showReminderModal && (
        <RemindersModal
          isOpen={showReminderModal}
          onClose={() => setShowReminderModal(false)}
          initialAssociation={{ type: 'client', id: id, clientId: id }}
        />
      )}

      {showClientModal && (
        <ClientModal
          client={client}
          onSave={handleSaveClient}
          onClose={() => setShowClientModal(false)}
          onDelete={handleDeleteClient}
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

      {/* Client Timer Stop Modal */}
      {showClientTimerStopModal && clientTimer && createPortal(
        <div className="modal-overlay" onClick={() => setShowClientTimerStopModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">שמירת זמן עבודה</h3>
              <button onClick={() => setShowClientTimerStopModal(false)} className="btn btn-ghost btn-icon">✕</button>
            </div>
            <div className="modal-body">
              <div className="stop-summary">
                <p>זמן מצטבר: <strong className="ltr">{formatDurationHuman(clientTimerElapsed)}</strong></p>
                <p>לקוח: <strong>{client.name}</strong></p>
              </div>

              <div className="form-group">
                <label className="form-label">שייך לפרויקט *</label>
                {projects.length > 0 ? (
                  <select
                    className="form-input"
                    value={selectedProjectForTimer}
                    onChange={e => setSelectedProjectForTimer(e.target.value)}
                    required
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="empty-state-inline">
                    <p>אין פרויקטים ללקוח זה. יש ליצור פרויקט קודם.</p>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">הערות (אופציונלי)</label>
                <textarea
                  className="form-input"
                  value={clientTimerNotes}
                  onChange={e => setClientTimerNotes(e.target.value)}
                  placeholder="מה עשית בזמן הזה?"
                  rows={3}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={handleSaveClientTimer}
                className="btn btn-primary"
                disabled={projects.length === 0}
              >
                שמור
              </button>
              <button onClick={() => setShowClientTimerStopModal(false)} className="btn btn-secondary">
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
          clientId={id}
          projectId={null}
        />
      )}

      {showTimeEntryModal && (
        <TimeEntryModal
          entry={editingEntry}
          clientId={id}
          onSave={handleSaveTimeEntry}
          onClose={() => { setShowTimeEntryModal(false); setEditingEntry(null); }}
        />
      )}

      {showPaymentModal && (
        <PaymentModal
          payment={editingPayment}
          projects={projects}
          onSave={handleSavePayment}
          onClose={() => { setShowPaymentModal(false); setEditingPayment(null); }}
        />
      )}

      {showSmartPaymentModal && (
        <SmartPaymentModal
          client={client}
          projects={projects}
          onSave={handleSaveSmartPayment}
          onClose={() => setShowSmartPaymentModal(false)}
        />
      )}

      {showLeadModal && (
        <LeadModal
          isOpen={showLeadModal}
          onClose={() => setShowLeadModal(false)}
          onSaved={loadData}
          initialClientId={id}
        />
      )}

      <Forum
        entityType="client"
        entityId={id}
      />
    </div>
  );
}

export default ClientDetail;
