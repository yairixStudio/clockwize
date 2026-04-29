import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Pause, Square, X as XIcon, User, Timer, Plus, Trash2, Edit2, Link2 } from 'lucide-react';
import useStore from '../store/useStore';
import { useModal } from './Modal';
import { formatDuration, formatDurationHuman } from '../utils/format';
import { timerAPI, clientsAPI, projectsAPI, tasksAPI } from '../services/api';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import TimeEntryModal from './TimeEntryModal';
import './ActiveTimer.css';

// Client timer item component (local timers)
function ClientTimerItem({ timer, clientId, onPause, onResume, onStop, onDiscard, onEditStartTime }) {
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    const calculateElapsed = () => {
      let total = timer.accumulatedSeconds || 0;
      if (!timer.isPaused) {
        const startTime = timer.startTime;
        const now = Date.now();
        total += Math.floor((now - startTime) / 1000);
      }
      return total;
    };
    
    setElapsed(calculateElapsed());
    
    if (!timer.isPaused) {
      const interval = setInterval(() => {
        setElapsed(calculateElapsed());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const label = timer.clientName || 'לקוח';
  
  return (
    <div className={`active-timer-item ${!timer.isPaused ? 'running' : 'paused'} client-timer`}>
      <div className="timer-info">
        <span className="timer-label client-timer-label" title={label}>
          <User size={12} className="client-timer-icon" />
          <Link to={`/clients/${clientId}`} className="clickable-name" onClick={e => e.stopPropagation()}>
            {label}
          </Link>
        </span>
        <span className="timer-time ltr">{formatDuration(elapsed)}</span>
      </div>
      
      <div className="timer-actions">
        <button onClick={() => onEditStartTime({ isClientTimer: true, clientId, timer })} className="timer-btn edit" title="ערוך זמן התחלה">
          <Edit2 size={14} />
        </button>
        {!timer.isPaused ? (
          <button onClick={() => onPause(clientId)} className="timer-btn pause" title="השהה">
            <Pause size={16} />
          </button>
        ) : (
          <button onClick={() => onResume(clientId)} className="timer-btn play" title="המשך">
            <Play size={16} />
          </button>
        )}
        
        <button onClick={() => onStop(clientId, timer)} className="timer-btn stop" title="עצור ושמור">
          <Square size={16} />
        </button>
        
        <button onClick={() => onDiscard(clientId)} className="timer-btn discard" title="בטל">
          <XIcon size={16} />
        </button>
      </div>
    </div>
  );
}

// Single timer item component
function TimerItem({ timer, onPause, onResume, onStop, onDiscard, onEditStartTime }) {
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    const calculateElapsed = () => {
      let total = timer.accumulated_seconds || 0;
      if (timer.is_running) {
        const startTime = new Date(timer.start_time).getTime();
        const now = Date.now();
        total += Math.floor((now - startTime) / 1000);
      }
      return total;
    };
    
    setElapsed(calculateElapsed());
    
    if (timer.is_running) {
      const interval = setInterval(() => {
        setElapsed(calculateElapsed());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const label = timer.task_name 
    ? `${timer.project_name} / ${timer.task_name}`
    : timer.project_name || 'טיימר פעיל';
  
  return (
    <div className={`active-timer-item ${timer.is_running ? 'running' : 'paused'}`}>
      <div className="timer-info">
        <span className="timer-label" title={label}>
          {timer.project_id ? (
            <>
              <Link to={`/projects/${timer.project_id}`} className="clickable-name" onClick={e => e.stopPropagation()}>
                {timer.project_name}
              </Link>
              {timer.task_name && (
                <>
                  {' / '}
                  <Link to={`/tasks/${timer.task_id}`} className="clickable-name" onClick={e => e.stopPropagation()}>
                    {timer.task_name}
                  </Link>
                </>
              )}
            </>
          ) : (
            label
          )}
        </span>
        <span className="timer-time ltr">{formatDuration(elapsed)}</span>
      </div>
      
      <div className="timer-actions">
        <button onClick={() => onEditStartTime(timer)} className="timer-btn edit" title="ערוך זמן התחלה">
          <Edit2 size={14} />
        </button>
        {timer.is_running ? (
          <button onClick={() => onPause(timer)} className="timer-btn pause" title="השהה">
            <Pause size={16} />
          </button>
        ) : (
          <button onClick={() => onResume(timer)} className="timer-btn play" title="המשך">
            <Play size={16} />
          </button>
        )}
        
        <button onClick={() => onStop(timer)} className="timer-btn stop" title="עצור ושמור">
          <Square size={16} />
        </button>
        
        <button onClick={() => onDiscard(timer)} className="timer-btn discard" title="בטל">
          <XIcon size={16} />
        </button>
      </div>
    </div>
  );
}

// Collapsed timer indicator for sidebar
function CollapsedTimerIndicator({ timers, totalCount, onPause, onResume }) {
  const [elapsed, setElapsed] = useState(0);
  const primaryTimer = timers[0];
  
  useEffect(() => {
    const calculateElapsed = () => {
      let total = primaryTimer.accumulated_seconds || 0;
      if (primaryTimer.is_running) {
        const startTime = new Date(primaryTimer.start_time).getTime();
        const now = Date.now();
        total += Math.floor((now - startTime) / 1000);
      }
      return total;
    };
    
    setElapsed(calculateElapsed());
    
    if (primaryTimer.is_running) {
      const interval = setInterval(() => {
        setElapsed(calculateElapsed());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [primaryTimer]);

  const handleClick = () => {
    if (primaryTimer.is_running) {
      onPause(primaryTimer);
    } else {
      onResume(primaryTimer);
    }
  };

  const displayCount = totalCount || timers.length;

  return (
    <div 
      className={`collapsed-timer-indicator ${primaryTimer.is_running ? 'running' : 'paused'}`}
      onClick={handleClick}
      title={primaryTimer.is_running ? 'לחץ להשהיה' : 'לחץ להמשך'}
    >
      <div className="collapsed-timer-icon">
        {primaryTimer.is_running ? <Pause size={14} /> : <Play size={14} />}
      </div>
      <span className="collapsed-timer-time ltr">{formatDuration(elapsed)}</span>
      {displayCount > 1 && (
        <span className="collapsed-timer-count">+{displayCount - 1}</span>
      )}
    </div>
  );
}

function ActiveTimer({ isSidebar = false, isCollapsed = false }) {
  const { activeTimers, pauseTimer, resumeTimer, stopTimer, discardTimer, updateTimerStartTime } = useStore();
  const modal = useModal();
  const navigate = useNavigate();
  const [showStopModal, setShowStopModal] = useState(false);
  const [selectedTimer, setSelectedTimer] = useState(null);
  const [notes, setNotes] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [intervals, setIntervals] = useState([]);
  const [loadingIntervals, setLoadingIntervals] = useState(false);
  const [showIntervals, setShowIntervals] = useState(true);
  const [intervalsError, setIntervalsError] = useState(null);
  const [showEditStartTimeModal, setShowEditStartTimeModal] = useState(false);
  const [editTimer, setEditTimer] = useState(null);
  const [editStartDate, setEditStartDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  
  // TimeEntryModal state for client timers
  const [showTimeEntryModal, setShowTimeEntryModal] = useState(false);
  const [timeEntryData, setTimeEntryData] = useState(null);

  // Project/Task/Subtask selection state for stop modal
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [subtasks, setSubtasks] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedSubtaskId, setSelectedSubtaskId] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  
  // Additional associations state
  const [additionalAssociations, setAdditionalAssociations] = useState([]);
  const [showAddAssociation, setShowAddAssociation] = useState(false);
  const [allProjects, setAllProjects] = useState([]);
  const [allTasks, setAllTasks] = useState([]);

  // Client timers from localStorage
  const [clientTimers, setClientTimers] = useState({});
  
  // Load client timers from localStorage
  useEffect(() => {
    const loadClientTimers = () => {
      const saved = localStorage.getItem('clientTimers');
      if (saved) {
        try {
          setClientTimers(JSON.parse(saved));
        } catch {
          setClientTimers({});
        }
      } else {
        setClientTimers({});
      }
    };
    
    loadClientTimers();
    
    // Listen for storage changes (from other tabs or Dashboard updates)
    const handleStorage = (e) => {
      if (e.key === 'clientTimers') {
        loadClientTimers();
      }
    };
    
    // Also poll periodically in case Dashboard updates
    const interval = setInterval(loadClientTimers, 1000);
    
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(interval);
    };
  }, []);
  
  // Update localStorage helper
  const updateClientTimers = useCallback((updater) => {
    setClientTimers(prev => {
      const newTimers = typeof updater === 'function' ? updater(prev) : updater;
      localStorage.setItem('clientTimers', JSON.stringify(newTimers));
      return newTimers;
    });
  }, []);
  
  // Lock body scroll when stop modal is open
  useBodyScrollLock(showStopModal);
  
  const clientTimerEntries = Object.entries(clientTimers);
  const hasServerTimers = activeTimers && activeTimers.length > 0;
  const hasClientTimers = clientTimerEntries.length > 0;
  
  if (!hasServerTimers && !hasClientTimers) return null;
  
  const handlePause = async (timer) => {
    try {
      await pauseTimer(timer.id);
    } catch (error) {
      modal.error('שגיאה בהשהיית הטיימר');
    }
  };
  
  const handleResume = async (timer) => {
    try {
      await resumeTimer(timer.id);
    } catch (error) {
      modal.error('שגיאה בהמשך הטיימר');
    }
  };
  
  // Load clients
  const loadClients = async () => {
    try {
      const data = await clientsAPI.getAll();
      setClients(data);
      return data;
    } catch (error) {
      console.error('Failed to load clients:', error);
      return [];
    }
  };

  // Load projects for a client
  const loadProjects = async (clientId) => {
    if (!clientId) {
      setProjects([]);
      return [];
    }
    try {
      const data = await projectsAPI.getAll(clientId);
      setProjects(data);
      return data;
    } catch (error) {
      console.error('Failed to load projects:', error);
      return [];
    }
  };

  // Load tasks for a project
  const loadTasks = async (projectId) => {
    if (!projectId) {
      setTasks([]);
      return [];
    }
    try {
      const data = await tasksAPI.getAll(projectId);
      setTasks(data);
      return data;
    } catch (error) {
      console.error('Failed to load tasks:', error);
      return [];
    }
  };

  // Load subtasks for a task
  const loadSubtasks = async (taskId) => {
    if (!taskId) {
      setSubtasks([]);
      return [];
    }
    try {
      const taskData = await tasksAPI.getOne(taskId);
      setSubtasks(taskData.subtasks || []);
      return taskData.subtasks || [];
    } catch (error) {
      console.error('Failed to load subtasks:', error);
      setSubtasks([]);
      return [];
    }
  };

  // Load all projects and tasks for additional associations
  const loadAllProjectsAndTasks = async () => {
    try {
      const [projectsData, tasksData] = await Promise.all([
        projectsAPI.getAll(),
        tasksAPI.getAll()
      ]);
      setAllProjects(projectsData);
      setAllTasks(tasksData);
    } catch (error) {
      console.error('Failed to load all projects/tasks:', error);
    }
  };

  // Additional associations handlers
  const handleAddAssociation = () => {
    setAdditionalAssociations(prev => [...prev, {
      id: `new-${Date.now()}`,
      project_id: '',
      task_id: ''
    }]);
  };

  const handleRemoveAssociation = (index) => {
    setAdditionalAssociations(prev => prev.filter((_, i) => i !== index));
  };

  const handleAssociationChange = (index, field, value) => {
    setAdditionalAssociations(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'project_id') {
        updated[index].task_id = '';
      }
      return updated;
    });
  };

  const getTasksForProject = (projectId) => {
    return allTasks.filter(t => t.project_id === projectId);
  };

  const openStopModal = async (timer) => {
    setSelectedTimer(timer);
    setNotes('');
    setIntervals([]);
    setShowIntervals(true);
    setIntervalsError(null);
    setShowStopModal(true);

    // Reset selection state
    setShowNewProject(false);
    setNewProjectName('');
    setShowNewTask(false);
    setNewTaskName('');
    
    // Reset additional associations
    setAdditionalAssociations([]);
    setShowAddAssociation(false);
    
    // Load clients and all projects/tasks for additional associations
    const clientsList = await loadClients();
    loadAllProjectsAndTasks();

    // Load intervals if this is a server timer (not client timer)
    if (!timer.isClientTimer && timer.id) {
      setLoadingIntervals(true);
      try {
        console.log('Loading intervals for timer:', timer.id);
        const data = await timerAPI.getTimerIntervals(timer.id);
        console.log('Loaded intervals:', data);
        setIntervals(data || []);
        if (data && data.length > 0) {
          setShowIntervals(true);
        } else {
          console.log('No intervals found for timer');
        }
      } catch (error) {
        console.error('Failed to load intervals:', error);
        setIntervalsError('שגיאה בטעינת האינטרוולים: ' + (error.message || 'שגיאה לא ידועה'));
      } finally {
        setLoadingIntervals(false);
      }

      // Set initial project/task selection based on timer
      if (timer.project_id) {
        // Find the client for this project
        try {
          const projectData = await projectsAPI.getOne(timer.project_id);
          if (projectData && projectData.client_id) {
            setSelectedClientId(projectData.client_id);
            await loadProjects(projectData.client_id);
          }
        } catch (error) {
          console.error('Failed to load project info:', error);
        }
        setSelectedProjectId(timer.project_id);
        await loadTasks(timer.project_id);
      } else {
        setSelectedClientId('');
        setSelectedProjectId('');
        setProjects([]);
        setTasks([]);
      }

      if (timer.task_id) {
        setSelectedTaskId(timer.task_id);
        await loadSubtasks(timer.task_id);
      } else {
        setSelectedTaskId('');
        setSubtasks([]);
      }

      setSelectedSubtaskId('');
    } else {
      console.log('Skipping interval load - isClientTimer:', timer.isClientTimer, 'id:', timer.id);
      setSelectedClientId('');
      setSelectedProjectId('');
      setSelectedTaskId('');
      setSelectedSubtaskId('');
      setProjects([]);
      setTasks([]);
      setSubtasks([]);
    }
  };
  
  // Handle client selection change
  const handleClientChange = async (e) => {
    const clientId = e.target.value;
    setSelectedClientId(clientId);
    setSelectedProjectId('');
    setSelectedTaskId('');
    setSelectedSubtaskId('');
    setShowNewProject(false);
    setNewProjectName('');
    setShowNewTask(false);
    setNewTaskName('');
    setTasks([]);
    setSubtasks([]);

    if (clientId) {
      await loadProjects(clientId);
    } else {
      setProjects([]);
    }
  };

  // Handle project selection change
  const handleProjectChange = async (e) => {
    const value = e.target.value;

    if (value === '__new__') {
      setShowNewProject(true);
      setNewProjectName('');
      return;
    }

    setShowNewProject(false);
    setNewProjectName('');
    setSelectedProjectId(value);
    setSelectedTaskId('');
    setSelectedSubtaskId('');
    setShowNewTask(false);
    setNewTaskName('');
    setSubtasks([]);

    if (value) {
      await loadTasks(value);
    } else {
      setTasks([]);
    }
  };

  // Handle task selection change
  const handleTaskChange = async (e) => {
    const value = e.target.value;

    if (value === '__new__') {
      setShowNewTask(true);
      setNewTaskName('');
      return;
    }

    setShowNewTask(false);
    setNewTaskName('');
    setSelectedTaskId(value);
    setSelectedSubtaskId('');

    if (value) {
      await loadSubtasks(value);
    } else {
      setSubtasks([]);
    }
  };

  // Handle subtask selection change
  const handleSubtaskChange = (e) => {
    setSelectedSubtaskId(e.target.value);
  };

  // Helper to format time for input
  const formatTimeForInput = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toTimeString().slice(0, 5);
  };

  // Helper to format date for input
  const formatDateForInput = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Open edit start time modal
  const handleEditStartTime = (timer) => {
    setEditTimer(timer);
    if (timer.isClientTimer) {
      // For client timers, timer is the actual timer object
      const timerData = clientTimers[timer.clientId];
      if (timerData) {
        const startDate = new Date(timerData.startTime);
        setEditStartDate(formatDateForInput(startDate.toISOString()));
        setEditStartTime(formatTimeForInput(startDate.toISOString()));
      }
    } else {
      setEditStartDate(formatDateForInput(timer.start_time));
      setEditStartTime(formatTimeForInput(timer.start_time));
    }
    setShowEditStartTimeModal(true);
  };

  // Save edited start time
  const handleSaveStartTime = async () => {
    if (!editTimer || !editStartDate || !editStartTime) {
      modal.error('נא למלא את כל השדות');
      return;
    }

    try {
      const newStartTime = new Date(`${editStartDate}T${editStartTime}`).toISOString();
      
      if (editTimer.isClientTimer) {
        // Update client timer in localStorage
        updateClientTimers(prev => {
          const timer = prev[editTimer.clientId];
          if (!timer) return prev;
          
          const newStartTimeMs = new Date(newStartTime).getTime();
          const oldStartTimeMs = timer.startTime;
          
          // Calculate elapsed time from old start to now
          const now = Date.now();
          let elapsed = 0;
          if (!timer.isPaused) {
            elapsed = Math.floor((now - oldStartTimeMs) / 1000);
          }
          
          // Calculate what elapsed would be with new start time
          let newElapsed = 0;
          if (!timer.isPaused) {
            newElapsed = Math.floor((now - newStartTimeMs) / 1000);
          }
          
          // Adjust accumulated seconds
          let newAccumulated = timer.accumulatedSeconds + elapsed - newElapsed;
          if (newAccumulated < 0) newAccumulated = 0;
          
          return {
            ...prev,
            [editTimer.clientId]: {
              ...timer,
              startTime: newStartTimeMs,
              accumulatedSeconds: newAccumulated
            }
          };
        });
        modal.success('זמן ההתחלה עודכן בהצלחה');
      } else {
        // Update server timer
        await updateTimerStartTime(editTimer.id, newStartTime);
        modal.success('זמן ההתחלה עודכן בהצלחה');
      }
      
      setShowEditStartTimeModal(false);
      setEditTimer(null);
      setEditStartDate('');
      setEditStartTime('');
    } catch (error) {
      console.error('Error updating start time:', error);
      modal.error('שגיאה בעדכון זמן ההתחלה');
    }
  };

  // Update interval
  const handleIntervalChange = (index, field, value) => {
    setIntervals(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      
      // Recalculate duration for this interval
      if (field === 'start_time_input' || field === 'end_time_input' || 
          field === 'start_date_input' || field === 'end_date_input') {
        const interval = updated[index];
        const startDate = interval.start_date_input || formatDateForInput(interval.start_time);
        const startTime = interval.start_time_input || formatTimeForInput(interval.start_time);
        const endDate = interval.end_date_input || formatDateForInput(interval.end_time);
        const endTime = interval.end_time_input || formatTimeForInput(interval.end_time);
        
        if (startDate && startTime && endDate && endTime) {
          const start = new Date(`${startDate}T${startTime}`);
          const end = new Date(`${endDate}T${endTime}`);
          const durationSeconds = Math.max(0, Math.floor((end - start) / 1000));
          updated[index].duration_seconds = durationSeconds;
        }
      }
      
      return updated;
    });
  };

  // Delete interval
  const handleDeleteInterval = (index) => {
    setIntervals(prev => prev.filter((_, i) => i !== index));
  };

  // Add new interval
  const handleAddInterval = () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    
    setIntervals(prev => [...prev, {
      id: `new-${Date.now()}`,
      start_time: oneHourAgo.toISOString(),
      end_time: now.toISOString(),
      duration_seconds: 3600,
      isNew: true
    }]);
  };

  // Calculate total duration from intervals
  const calculateTotalFromIntervals = () => {
    return intervals.reduce((sum, interval) => {
      return sum + (interval.duration_seconds || 0);
    }, 0);
  };

  const handleStop = async () => {
    if (!selectedTimer) return;

    try {
      // Prepare intervals for sending (convert input fields to ISO strings)
      const intervalsToSend = intervals.map(interval => {
        const startDate = interval.start_date_input || formatDateForInput(interval.start_time);
        const startTime = interval.start_time_input || formatTimeForInput(interval.start_time);
        const endDate = interval.end_date_input || formatDateForInput(interval.end_time);
        const endTime = interval.end_time_input || formatTimeForInput(interval.end_time);

        return {
          id: interval.id,
          start_time: startDate && startTime ? new Date(`${startDate}T${startTime}`).toISOString() : interval.start_time,
          end_time: endDate && endTime ? new Date(`${endDate}T${endTime}`).toISOString() : interval.end_time,
          duration_seconds: interval.duration_seconds || 0
        };
      });

      // Create new project if needed
      let projectId = selectedProjectId || null;
      if (showNewProject && newProjectName.trim() && selectedClientId) {
        try {
          const newProject = await projectsAPI.create({
            name: newProjectName.trim(),
            client_id: selectedClientId
          });
          projectId = newProject.id;
        } catch (error) {
          console.error('Failed to create new project:', error);
          modal.error('שגיאה ביצירת פרויקט חדש');
          return;
        }
      }

      // Create new task if needed
      let taskId = selectedTaskId || null;
      if (showNewTask && newTaskName.trim() && projectId) {
        try {
          const newTask = await tasksAPI.create({
            name: newTaskName.trim(),
            project_id: projectId
          });
          taskId = newTask.id;
        } catch (error) {
          console.error('Failed to create new task:', error);
          modal.error('שגיאה ביצירת משימה חדשה');
          return;
        }
      }

      // Prepare additional associations (filter out empty ones)
      const validAssociations = additionalAssociations
        .filter(a => a.project_id || a.task_id)
        .map(a => ({
          project_id: a.project_id || null,
          task_id: a.task_id || null
        }));

      // Use the store's stopTimer function with project/task options
      const options = {
        project_id: projectId,
        task_id: taskId,
        subtask_id: selectedSubtaskId || null,
        additional_associations: validAssociations
      };

      await stopTimer(
        selectedTimer.id,
        notes,
        intervalsToSend.length > 0 ? intervalsToSend : undefined,
        options
      );

      setShowStopModal(false);
      setSelectedTimer(null);
      setNotes('');
      setIntervals([]);
      setShowIntervals(false);
      // Reset selection state
      setSelectedClientId('');
      setSelectedProjectId('');
      setSelectedTaskId('');
      setSelectedSubtaskId('');
      setShowNewProject(false);
      setNewProjectName('');
      setShowNewTask(false);
      setNewTaskName('');
      // Reset additional associations
      setAdditionalAssociations([]);
      setShowAddAssociation(false);
      modal.success('הזמן נשמר בהצלחה!');
    } catch (error) {
      console.error('Stop timer error:', error);
      modal.error('שגיאה בשמירת הזמן');
    }
  };
  
  const handleDiscard = async (timer) => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך לבטל את הטיימר? הזמן שנספר לא יישמר.',
      { title: 'ביטול טיימר', confirmText: 'בטל', type: 'warning' }
    );
    
    if (confirmed) {
      try {
        await discardTimer(timer.id);
      } catch (error) {
        modal.error('שגיאה בביטול הטיימר');
      }
    }
  };

  // Client timer handlers
  const handleClientPause = (clientId) => {
    updateClientTimers(prev => {
      const timer = prev[clientId];
      if (!timer || timer.isPaused) return prev;
      
      const elapsed = Math.floor((Date.now() - timer.startTime) / 1000);
      return {
        ...prev,
        [clientId]: {
          ...timer,
          isPaused: true,
          accumulatedSeconds: timer.accumulatedSeconds + elapsed
        }
      };
    });
  };

  const handleClientResume = (clientId) => {
    updateClientTimers(prev => {
      const timer = prev[clientId];
      if (!timer || !timer.isPaused) return prev;
      
      return {
        ...prev,
        [clientId]: {
          ...timer,
          startTime: Date.now(),
          isPaused: false
        }
      };
    });
  };

  const handleClientStop = (clientId, timer) => {
    // Calculate total elapsed time
    let totalSeconds = timer.accumulatedSeconds || 0;
    if (!timer.isPaused) {
      totalSeconds += Math.floor((Date.now() - timer.startTime) / 1000);
    }
    
    // Prepare data for TimeEntryModal (same as Dashboard)
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - totalSeconds * 1000);

    setTimeEntryData({
      clientId: clientId,
      durationSeconds: totalSeconds,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString()
    });
    setShowTimeEntryModal(true);
  };

  const handleClientDiscard = async (clientId) => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך לבטל את הטיימר? הזמן שנספר לא יישמר.',
      { title: 'ביטול טיימר', confirmText: 'בטל', type: 'warning' }
    );
    
    if (confirmed) {
      updateClientTimers(prev => {
        const newTimers = { ...prev };
        delete newTimers[clientId];
        return newTimers;
      });
    }
  };

  // Save time entry from client timer (via TimeEntryModal)
  const handleSaveTimeEntry = async (data) => {
    try {
      await timerAPI.createEntry(data);
      
      // Clear the client timer
      if (timeEntryData?.clientId) {
        updateClientTimers(prev => {
          const newTimers = { ...prev };
          delete newTimers[timeEntryData.clientId];
          return newTimers;
        });
      }
      
      setShowTimeEntryModal(false);
      setTimeEntryData(null);
      modal.success('הזמן נשמר בהצלחה!');
    } catch (error) {
      console.error('Error saving time entry:', error);
      modal.error('שגיאה בשמירת הזמן');
    }
  };

  // Calculate elapsed time for selected timer (for stop modal)
  const getElapsed = (timer) => {
    if (!timer) return 0;
    // Handle client timer
    if (timer.isClientTimer) {
      return timer.accumulatedSeconds || 0;
    }
    // Handle server timer
    let total = timer.accumulated_seconds || 0;
    if (timer.is_running) {
      const startTime = new Date(timer.start_time).getTime();
      total += Math.floor((Date.now() - startTime) / 1000);
    }
    return total;
  };

  // Combine all timers for counting
  const allTimers = [...(activeTimers || [])];
  const totalTimerCount = allTimers.length + clientTimerEntries.length;
  
  // In sidebar - always show all timers; in mobile header - show first timer, expandable
  const hasMultiple = totalTimerCount > 1;
  const visibleServerTimers = isSidebar ? allTimers : (expanded ? allTimers : (allTimers.length > 0 ? [allTimers[0]] : []));
  
  // Show collapsed indicator when sidebar is collapsed
  if (isCollapsed) {
    // Create a combined timer for collapsed view
    const primaryTimer = allTimers[0] || (clientTimerEntries.length > 0 ? {
      is_running: !clientTimerEntries[0][1].isPaused,
      accumulated_seconds: clientTimerEntries[0][1].accumulatedSeconds,
      start_time: new Date(clientTimerEntries[0][1].startTime).toISOString(),
      project_name: clientTimerEntries[0][1].clientName,
      isClientTimer: true,
      clientId: clientTimerEntries[0][0]
    } : null);
    
    if (!primaryTimer) return null;
    
    const allForCollapsed = allTimers.length > 0 ? allTimers : [primaryTimer];
    
    return (
      <CollapsedTimerIndicator 
        timers={allForCollapsed}
        totalCount={totalTimerCount}
        onPause={primaryTimer.isClientTimer ? () => handleClientPause(primaryTimer.clientId) : handlePause}
        onResume={primaryTimer.isClientTimer ? () => handleClientResume(primaryTimer.clientId) : handleResume}
      />
    );
  }
  
  return (
    <>
      <div className={`active-timers-container ${isSidebar ? 'is-sidebar' : ''}`}>
        {hasMultiple && !isSidebar && (
          <button 
            className="timers-expand-btn"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'צמצם' : `עוד ${totalTimerCount - 1} טיימרים`}
          >
            <span className="timer-count">{totalTimerCount}</span>
            <span className="expand-icon">{expanded ? '▲' : '▼'}</span>
          </button>
        )}
        
        {hasMultiple && isSidebar && (
          <div className="sidebar-timers-header">
            <span className="sidebar-timer-count">{totalTimerCount} טיימרים פעילים</span>
          </div>
        )}
        
        <div className={`active-timers-list ${expanded ? 'expanded' : ''} ${isSidebar ? 'sidebar-list' : ''}`}>
          {/* Server timers */}
          {visibleServerTimers.map(timer => (
            <TimerItem
              key={timer.id}
              timer={timer}
              onPause={handlePause}
              onResume={handleResume}
              onStop={openStopModal}
              onDiscard={handleDiscard}
              onEditStartTime={handleEditStartTime}
            />
          ))}
          
          {/* Client timers (local) */}
          {(isSidebar || expanded || visibleServerTimers.length === 0) && clientTimerEntries.map(([clientId, timer]) => (
            <ClientTimerItem
              key={`client-${clientId}`}
              clientId={clientId}
              timer={timer}
              onPause={handleClientPause}
              onResume={handleClientResume}
              onStop={handleClientStop}
              onDiscard={handleClientDiscard}
              onEditStartTime={handleEditStartTime}
            />
          ))}
        </div>
      </div>
      
      {showStopModal && selectedTimer && createPortal(
        <div className="modal-overlay" onClick={() => setShowStopModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">שמירת זמן עבודה</h3>
              <button onClick={() => setShowStopModal(false)} className="btn btn-ghost btn-icon">✕</button>
            </div>
            <div className="modal-body">
              <div className="stop-summary">
                <p>זמן מצטבר: <strong className="ltr">
                  {intervals.length > 0 && showIntervals
                    ? formatDuration(calculateTotalFromIntervals())
                    : formatDuration(getElapsed(selectedTimer))
                  }
                </strong></p>
              </div>

              {selectedTimer.isClientTimer ? (
                <div className="client-timer-stop-info">
                  <p>כדי לשמור את הזמן, יש לבחור פרויקט.</p>
                  <p>לחץ על "עבור לדשבורד" ושם תוכל לעצור ולשמור את הטיימר.</p>
                </div>
              ) : (
                <>
                  {/* Client selector */}
                  <div className="form-group">
                    <label className="form-label">לקוח</label>
                    <select
                      className="form-input"
                      value={selectedClientId}
                      onChange={handleClientChange}
                    >
                      <option value="">בחר לקוח...</option>
                      {clients.map(client => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Project selector */}
                  <div className="form-group">
                    <label className="form-label">פרויקט</label>
                    <select
                      className="form-input"
                      value={showNewProject ? '__new__' : selectedProjectId}
                      onChange={handleProjectChange}
                      disabled={!selectedClientId}
                    >
                      <option value="">בחר פרויקט...</option>
                      {projects.map(project => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                      {selectedClientId && (
                        <option value="__new__">+ פרויקט חדש...</option>
                      )}
                    </select>

                    {showNewProject && (
                      <div className="new-item-inline">
                        <input
                          type="text"
                          className="form-input"
                          placeholder="שם הפרויקט החדש"
                          value={newProjectName}
                          onChange={e => setNewProjectName(e.target.value)}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setShowNewProject(false);
                            setNewProjectName('');
                          }}
                        >
                          ביטול
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Task selector */}
                  <div className="form-group">
                    <label className="form-label">משימה (אופציונלי)</label>
                    <select
                      className="form-input"
                      value={showNewTask ? '__new__' : selectedTaskId}
                      onChange={handleTaskChange}
                      disabled={!selectedProjectId && !showNewProject}
                    >
                      <option value="">ללא משימה</option>
                      {tasks.map(task => (
                        <option key={task.id} value={task.id}>
                          {task.name}
                        </option>
                      ))}
                      {(selectedProjectId || showNewProject) && (
                        <option value="__new__">+ משימה חדשה...</option>
                      )}
                    </select>

                    {showNewTask && (
                      <div className="new-item-inline">
                        <input
                          type="text"
                          className="form-input"
                          placeholder="שם המשימה החדשה"
                          value={newTaskName}
                          onChange={e => setNewTaskName(e.target.value)}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setShowNewTask(false);
                            setNewTaskName('');
                          }}
                        >
                          ביטול
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Subtask selector */}
                  {selectedTaskId && subtasks.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">תת-משימה (אופציונלי)</label>
                      <select
                        className="form-input"
                        value={selectedSubtaskId}
                        onChange={handleSubtaskChange}
                      >
                        <option value="">ללא תת-משימה</option>
                        {subtasks.map(subtask => (
                          <option key={subtask.id} value={subtask.id}>
                            {subtask.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Additional Associations Section */}
                  <div className="additional-associations-section" style={{ margin: '1rem 0', paddingTop: '1rem', borderTop: '1px dashed var(--border-color)' }}>
                    {!showAddAssociation ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ width: '100%', justifyContent: 'center', gap: '0.5rem', border: '1px dashed var(--border-color)', padding: '0.75rem' }}
                        onClick={() => {
                          setShowAddAssociation(true);
                          if (additionalAssociations.length === 0) {
                            handleAddAssociation();
                          }
                        }}
                      >
                        <Link2 size={14} />
                        שייך לפרויקטים/משימות נוספים
                      </button>
                    ) : (
                      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontWeight: 600, fontSize: '0.875rem' }}>
                          <Link2 size={16} style={{ color: 'var(--primary)' }} />
                          <span>שיוכים נוספים</span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ marginRight: 'auto' }}
                            onClick={() => setShowAddAssociation(false)}
                          >
                            הסתר
                          </button>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {additionalAssociations.map((assoc, index) => (
                            <div key={assoc.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <select
                                className="form-input"
                                style={{ flex: 1, fontSize: '0.875rem', padding: '0.5rem' }}
                                value={assoc.project_id}
                                onChange={(e) => handleAssociationChange(index, 'project_id', e.target.value)}
                              >
                                <option value="">בחר פרויקט...</option>
                                {allProjects.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.client_name} / {p.name}
                                  </option>
                                ))}
                              </select>
                              
                              <select
                                className="form-input"
                                style={{ flex: 1, fontSize: '0.875rem', padding: '0.5rem' }}
                                value={assoc.task_id}
                                onChange={(e) => handleAssociationChange(index, 'task_id', e.target.value)}
                                disabled={!assoc.project_id}
                              >
                                <option value="">משימה (אופציונלי)</option>
                                {getTasksForProject(assoc.project_id).map(t => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                              
                              <button
                                type="button"
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => handleRemoveAssociation(index)}
                                title="הסר שיוך"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                        
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ marginTop: '0.75rem', width: '100%', justifyContent: 'center', gap: '0.5rem', border: '1px dashed var(--border-color)' }}
                          onClick={handleAddAssociation}
                        >
                          <Plus size={14} />
                          הוסף שיוך נוסף
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {!selectedTimer.isClientTimer && (
                <>
                  {/* Intervals section */}
                  {!loadingIntervals && (
                    <div className="intervals-section-main" style={{ marginBottom: '1rem' }}>
                      <div className="intervals-header-main" style={{ cursor: 'pointer' }} onClick={() => setShowIntervals(!showIntervals)}>
                        <Timer size={16} />
                        <span>קטעי זמן {intervals.length > 0 ? `(${intervals.length})` : ''}</span>
                        {intervals.length > 0 && (
                          <span className="intervals-total-badge">
                            סה״כ: {formatDurationHuman(calculateTotalFromIntervals())}
                          </span>
                        )}
                        <span style={{ marginRight: 'auto', fontSize: '0.875rem' }}>
                          {showIntervals ? '▼' : '▶'}
                        </span>
                      </div>

                      {intervalsError && (
                        <div style={{ padding: '0.5rem', color: 'var(--error)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                          {intervalsError}
                        </div>
                      )}

                      {showIntervals && (
                        <>
                          {intervals.length > 0 ? (
                            <div className="intervals-list-edit">
                              {intervals.map((interval, index) => (
                                <div key={interval.id || index} className="interval-edit-item">
                                  <span className="interval-edit-number">{index + 1}</span>
                                  
                                  <div className="interval-edit-fields">
                                    <div className="interval-edit-row">
                                      <label>התחלה:</label>
                                      <input
                                        type="date"
                                        value={interval.start_date_input || formatDateForInput(interval.start_time)}
                                        onChange={(e) => handleIntervalChange(index, 'start_date_input', e.target.value)}
                                        className="form-input interval-date-input"
                                        dir="ltr"
                                      />
                                      <input
                                        type="time"
                                        value={interval.start_time_input || formatTimeForInput(interval.start_time)}
                                        onChange={(e) => handleIntervalChange(index, 'start_time_input', e.target.value)}
                                        className="form-input interval-time-input"
                                        dir="ltr"
                                      />
                                    </div>
                                    <div className="interval-edit-row">
                                      <label>סיום:</label>
                                      <input
                                        type="date"
                                        value={interval.end_date_input || formatDateForInput(interval.end_time)}
                                        onChange={(e) => handleIntervalChange(index, 'end_date_input', e.target.value)}
                                        className="form-input interval-date-input"
                                        dir="ltr"
                                      />
                                      <input
                                        type="time"
                                        value={interval.end_time_input || formatTimeForInput(interval.end_time)}
                                        onChange={(e) => handleIntervalChange(index, 'end_time_input', e.target.value)}
                                        className="form-input interval-time-input"
                                        dir="ltr"
                                      />
                                    </div>
                                  </div>

                                  <div className="interval-edit-duration">
                                    {formatDurationHuman(interval.duration_seconds || 0)}
                                  </div>

                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-icon btn-sm interval-delete-btn"
                                    onClick={() => handleDeleteInterval(index)}
                                    title="מחק קטע"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                              אין אינטרוולים. הזמן נשמר כרשומה אחת.
                            </div>
                          )}

                          <button 
                            type="button" 
                            className="btn btn-ghost btn-sm add-interval-btn"
                            onClick={handleAddInterval}
                          >
                            <Plus size={14} />
                            הוסף קטע זמן
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {loadingIntervals && (
                    <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>
                      טוען אינטרוולים...
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label">הערות (אופציונלי)</label>
                    <textarea 
                      className="form-input"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="מה עשית בזמן הזה?"
                      rows={3}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              {selectedTimer.isClientTimer ? (
                <button 
                  onClick={() => {
                    setShowStopModal(false);
                    navigate('/');
                  }} 
                  className="btn btn-primary"
                >
                  עבור לדשבורד
                </button>
              ) : (
                <button onClick={handleStop} className="btn btn-primary">
                  שמור
                </button>
              )}
              <button onClick={() => setShowStopModal(false)} className="btn btn-secondary">
                ביטול
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Start Time Modal */}
      {showEditStartTimeModal && editTimer && createPortal(
        <div className="modal-overlay" onClick={() => setShowEditStartTimeModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">ערוך זמן התחלה</h3>
              <button onClick={() => setShowEditStartTimeModal(false)} className="btn btn-ghost btn-icon">✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">תאריך</label>
                <input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                  className="form-input"
                  dir="ltr"
                />
              </div>
              <div className="form-group">
                <label className="form-label">שעה</label>
                <input
                  type="time"
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                  className="form-input"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={handleSaveStartTime} className="btn btn-primary">
                שמור
              </button>
              <button onClick={() => setShowEditStartTimeModal(false)} className="btn btn-secondary">
                ביטול
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* TimeEntryModal for client timers */}
      {showTimeEntryModal && timeEntryData && (
        <TimeEntryModal
          clientId={timeEntryData.clientId}
          durationSeconds={timeEntryData.durationSeconds}
          startTime={timeEntryData.startTime}
          endTime={timeEntryData.endTime}
          isFromTimer={true}
          onSave={handleSaveTimeEntry}
          onClose={() => {
            setShowTimeEntryModal(false);
            setTimeEntryData(null);
          }}
        />
      )}
    </>
  );
}

export default ActiveTimer;
