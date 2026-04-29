import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useOutletContext } from 'react-router-dom';
import { Users, Folder, Play, Pause, Square, X, ChevronRight, ChevronDown, Clock, Plus, MessageSquare, Search, CheckCircle2, ExternalLink, Circle, CircleCheck, Star, GripVertical, MoreVertical } from 'lucide-react';
import useStore from '../store/useStore';
import { clientsAPI, projectsAPI, tasksAPI, timerAPI } from '../services/api';
import { formatDurationHuman, formatCurrency } from '../utils/format';
import { getClientStatus, getProjectStatus } from '../utils/status';
import { useModal } from '../components/Modal';
import TimerConflictModal from '../components/TimerConflictModal';
import ClientModal from '../components/ClientModal';
import ProjectModal from '../components/ProjectModal';
import TaskModal from '../components/TaskModal';
import TimeEntryModal from '../components/TimeEntryModal';
import Forum from '../components/Forum';
import PaymentStatusBadge, { calculateProjectEarnings } from '../components/PaymentStatusBadge';
import './Dashboard.css';

function Dashboard() {
  const { user, dashboardStats, loadDashboardStats, startTimer, pauseTimer, resumeTimer, stopTimer, discardTimer, activeTimers, getTimerForProject } = useStore();
  const outletContext = useOutletContext();
  const setStats = outletContext?.setStats;
  const selectedMonth = outletContext?.selectedMonth;
  const dateRange = outletContext?.dateRange;
  const modal = useModal();
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [expandedClients, setExpandedClients] = useState({});
  const [expandedProjects, setExpandedProjects] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [selectedProjectForTask, setSelectedProjectForTask] = useState(null);
  
  // Carousel states
  const [taskCarouselIndex, setTaskCarouselIndex] = useState(0);
  const [projectCarouselIndex, setProjectCarouselIndex] = useState(0);
  const taskCarouselRef = useRef(null);
  const projectCarouselRef = useRef(null);
  const isScrollingProgrammatically = useRef(false);

  // Filter states for tasks
  const [taskStatusFilter, setTaskStatusFilter] = useState('open'); // 'open', 'completed', 'all'
  const [taskPriorityFilter, setTaskPriorityFilter] = useState('all'); // 'all', 'high', 'normal', 'low'
  
  // Filter states for projects
  const [projectStatusFilter, setProjectStatusFilter] = useState('active'); // 'active', 'completed', 'all'
  const [projectPriorityFilter, setProjectPriorityFilter] = useState('all'); // 'all', 'high', 'normal', 'low'
  
  // Project editing state
  const [editingProject, setEditingProject] = useState(null);

  // Timer conflict modal state
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [pendingTimerStart, setPendingTimerStart] = useState(null);

  // Stop timer modal state
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopNotes, setStopNotes] = useState('');
  const [stoppingTimer, setStoppingTimer] = useState(null);

  // Drag and drop state
  const [draggedClient, setDraggedClient] = useState(null);
  const [dragOverClient, setDragOverClient] = useState(null);
  const [customOrder, setCustomOrder] = useState(() => {
    const saved = localStorage.getItem('dashboard_client_order');
    return saved ? JSON.parse(saved) : { favorites: [], nonFavorites: [] };
  });

  // Client-level timer state (local timers, saved to backend when stopped)
  // Format: { [clientId]: { startTime: number, isPaused: boolean, accumulatedSeconds: number, clientName: string } }
  const [clientTimers, setClientTimers] = useState(() => {
    const saved = localStorage.getItem('clientTimers');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return {};
      }
    }
    return {};
  });
  const [clientTimerElapsed, setClientTimerElapsed] = useState({}); // For display updates
  const timerIntervalRef = useRef(null);

  // Persist client timers to localStorage
  useEffect(() => {
    localStorage.setItem('clientTimers', JSON.stringify(clientTimers));
  }, [clientTimers]);

  // Time entry modal for client timer
  const [showTimeEntryModal, setShowTimeEntryModal] = useState(false);
  const [timeEntryData, setTimeEntryData] = useState(null);

  // Reload stats when selectedMonth or dateRange changes
  useEffect(() => {
    const reloadStats = async () => {
      let statsParams = {};
      
      if (dateRange) {
        // Custom date range mode
        statsParams = {
          startDate: dateRange.start.toISOString(),
          endDate: dateRange.end.toISOString()
        };
      } else if (selectedMonth) {
        // Monthly mode
        statsParams = {
          month: selectedMonth.getMonth(),
          year: selectedMonth.getFullYear()
        };
      }
      
      await loadDashboardStats(statsParams);
    };
    reloadStats();
  }, [selectedMonth, dateRange, loadDashboardStats]);
  
  // Load other data on mount
  useEffect(() => {
    loadData();
  }, []);

  // Reset carousel index when filter changes
  useEffect(() => {
    setTaskCarouselIndex(0);
  }, [taskPriorityFilter, taskStatusFilter]);

  useEffect(() => {
    setProjectCarouselIndex(0);
  }, [projectPriorityFilter, projectStatusFilter]);

  // Programmatic scroll handler for task carousel
  const scrollToTaskCard = (index) => {
    isScrollingProgrammatically.current = true;
    setTaskCarouselIndex(index);
    
    if (taskCarouselRef.current) {
      const cards = taskCarouselRef.current.querySelectorAll('.task-card');
      if (cards.length > index) {
        cards[index].scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'start'
        });
      }
    }
    
    setTimeout(() => {
      isScrollingProgrammatically.current = false;
    }, 500);
  };

  // Sync task carousel index with scroll position (manual scroll)
  useEffect(() => {
    const carousel = taskCarouselRef.current;
    if (!carousel) return;

    let scrollTimeout;
    const handleScroll = () => {
      if (isScrollingProgrammatically.current) return;

      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const cards = carousel.querySelectorAll('.task-card');
        if (cards.length === 0) return;

        const carouselRect = carousel.getBoundingClientRect();
        const carouselCenter = carouselRect.left + carouselRect.width / 2;

        let closestIndex = 0;
        let closestDistance = Infinity;

        cards.forEach((card, index) => {
          const cardRect = card.getBoundingClientRect();
          const cardCenter = cardRect.left + cardRect.width / 2;
          const distance = Math.abs(cardCenter - carouselCenter);

          if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
          }
        });

        setTaskCarouselIndex(closestIndex);
      }, 100);
    };

    carousel.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      clearTimeout(scrollTimeout);
      carousel.removeEventListener('scroll', handleScroll);
    };
  }, [tasks.length]);

  // Programmatic scroll handler for project carousel
  const scrollToProjectCard = (index) => {
    isScrollingProgrammatically.current = true;
    setProjectCarouselIndex(index);
    
    if (projectCarouselRef.current) {
      const cards = projectCarouselRef.current.querySelectorAll('.task-card');
      if (cards.length > index) {
        cards[index].scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'start'
        });
      }
    }
    
    setTimeout(() => {
      isScrollingProgrammatically.current = false;
    }, 500);
  };

  // Sync project carousel index with scroll position (manual scroll)
  useEffect(() => {
    const carousel = projectCarouselRef.current;
    if (!carousel) return;

    let scrollTimeout;
    const handleScroll = () => {
      if (isScrollingProgrammatically.current) return;

      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const cards = carousel.querySelectorAll('.task-card');
        if (cards.length === 0) return;

        const carouselRect = carousel.getBoundingClientRect();
        const carouselCenter = carouselRect.left + carouselRect.width / 2;

        let closestIndex = 0;
        let closestDistance = Infinity;

        cards.forEach((card, index) => {
          const cardRect = card.getBoundingClientRect();
          const cardCenter = cardRect.left + cardRect.width / 2;
          const distance = Math.abs(cardCenter - carouselCenter);

          if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
          }
        });

        setProjectCarouselIndex(closestIndex);
      }, 100);
    };

    carousel.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      clearTimeout(scrollTimeout);
      carousel.removeEventListener('scroll', handleScroll);
    };
  }, [projects.length]);

  // Update client timer display every second
  useEffect(() => {
    const hasRunningTimer = Object.values(clientTimers).some(t => !t.isPaused);
    
    if (hasRunningTimer) {
      timerIntervalRef.current = setInterval(() => {
        setClientTimerElapsed(prev => {
          const newElapsed = { ...prev };
          Object.entries(clientTimers).forEach(([clientId, timer]) => {
            if (!timer.isPaused) {
              const elapsed = Math.floor((Date.now() - timer.startTime) / 1000) + timer.accumulatedSeconds;
              newElapsed[clientId] = elapsed;
            }
          });
          return newElapsed;
        });
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [clientTimers]);

  useEffect(() => {
    if (dashboardStats && setStats) {
      // Determine the period label based on current filter
      let periodLabel = 'החודש';
      if (dateRange) {
        periodLabel = 'בטווח';
      } else if (selectedMonth) {
        const now = new Date();
        const isCurrentMonth = selectedMonth.getMonth() === now.getMonth() && 
                              selectedMonth.getFullYear() === now.getFullYear();
        periodLabel = isCurrentMonth ? 'החודש' : 'בחודש';
      }
      
      setStats([
        { label: 'לקוחות', value: dashboardStats.clients || 0, icon: <Users size={20} />, path: null },
        { label: 'פרויקטים פעילים', value: dashboardStats.projects?.active || 0, icon: <Folder size={20} />, path: '/projects' },
        { label: `שעות ${periodLabel}`, value: formatDurationHuman(dashboardStats.time?.thisMonth || 0), icon: <Clock size={20} />, path: '/time-entries' },
        { label: `הכנסות ${periodLabel}`, value: formatCurrency(dashboardStats.earnings?.thisMonth || 0), icon: '💰', path: '/payments' }
      ]);
    }
  }, [dashboardStats, setStats, dateRange, selectedMonth]);

  const loadData = async () => {
    try {
      const [clientsData, projectsData, tasksData] = await Promise.all([
        clientsAPI.getAll(),
        projectsAPI.getAll(),
        tasksAPI.getAll()
      ]);
      setClients(clientsData);
      setProjects(projectsData);
      setTasks(tasksData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleClient = (clientId) => {
    setExpandedClients(prev => ({
      ...prev,
      [clientId]: !prev[clientId]
    }));
  };

  const toggleProject = (projectId) => {
    setExpandedProjects(prev => ({
      ...prev,
      [projectId]: !prev[projectId]
    }));
  };

  // Filter data based on search query and sort by custom order
  const getFilteredData = () => {
    let result = clients;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();

      // Filter clients that match name, aliases, OR have projects/tasks that match
      result = clients.filter(client => {
        const clientNameMatches = client.name.toLowerCase().includes(query);

        // Check if any alias matches
        const aliasMatches = Array.isArray(client.aliases) && 
          client.aliases.some(alias => alias.toLowerCase().includes(query));

        const hasMatchingProjects = projects.some(p =>
          p.client_id === client.id && (
            p.name.toLowerCase().includes(query) ||
            tasks.some(t => t.project_id === p.id && t.name.toLowerCase().includes(query))
          )
        );

        return clientNameMatches || aliasMatches || hasMatchingProjects;
      });
    }

    // Separate favorites and non-favorites
    const favorites = result.filter(c => c.is_favorite);
    const nonFavorites = result.filter(c => !c.is_favorite);

    // Sort each group by custom order
    const sortByCustomOrder = (items, orderList) => {
      if (!orderList || orderList.length === 0) return items;
      return [...items].sort((a, b) => {
        const indexA = orderList.indexOf(a.id);
        const indexB = orderList.indexOf(b.id);
        // Items not in the order list go to the end
        if (indexA === -1 && indexB === -1) return 0;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      });
    };

    const sortedFavorites = sortByCustomOrder(favorites, customOrder.favorites);
    const sortedNonFavorites = sortByCustomOrder(nonFavorites, customOrder.nonFavorites);

    return [...sortedFavorites, ...sortedNonFavorites];
  };

  const filteredClients = getFilteredData();

  // Drag and drop handlers
  const handleDragStart = (e, client) => {
    setDraggedClient(client);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', client.id);
    // Add dragging class after a small delay to not affect the drag image
    setTimeout(() => {
      e.target.closest('.client-group-wrapper')?.classList.add('dragging');
    }, 0);
  };

  const handleDragEnd = (e) => {
    e.target.closest('.client-group-wrapper')?.classList.remove('dragging');
    setDraggedClient(null);
    setDragOverClient(null);
  };

  const handleDragOver = (e, client) => {
    e.preventDefault();
    if (!draggedClient || draggedClient.id === client.id) return;
    // Only allow drag within same zone (favorites <-> favorites, non-favorites <-> non-favorites)
    if (draggedClient.is_favorite !== client.is_favorite) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.dataTransfer.dropEffect = 'move';
    setDragOverClient(client);
  };

  const handleDragLeave = () => {
    setDragOverClient(null);
  };

  const handleDrop = (e, targetClient) => {
    e.preventDefault();
    if (!draggedClient || draggedClient.id === targetClient.id) return;
    // Only allow drop within same zone
    if (draggedClient.is_favorite !== targetClient.is_favorite) return;

    const isFavorite = draggedClient.is_favorite;
    const orderKey = isFavorite ? 'favorites' : 'nonFavorites';
    
    // Get current clients in this zone
    const zoneClients = filteredClients.filter(c => c.is_favorite === isFavorite);
    const currentIds = zoneClients.map(c => c.id);
    
    // Remove dragged item from its position
    const newOrder = currentIds.filter(id => id !== draggedClient.id);
    
    // Find target index and insert
    const targetIndex = newOrder.indexOf(targetClient.id);
    newOrder.splice(targetIndex, 0, draggedClient.id);

    // Save to state and localStorage
    const newCustomOrder = {
      ...customOrder,
      [orderKey]: newOrder
    };
    setCustomOrder(newCustomOrder);
    localStorage.setItem('dashboard_client_order', JSON.stringify(newCustomOrder));

    setDraggedClient(null);
    setDragOverClient(null);
  };

  const handleSaveClient = async (clientData) => {
    try {
      await clientsAPI.create(clientData);
      loadData();
      setShowClientModal(false);
      modal.success('הלקוח נוסף בהצלחה');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDeleteClient = async () => {
    loadData();
  };

  const handleSaveProject = async (projectData) => {
    try {
      if (editingProject) {
        await projectsAPI.update(editingProject.id, projectData);
        modal.success('הפרויקט עודכן בהצלחה');
      } else {
        await projectsAPI.create(projectData);
        modal.success('הפרויקט נוסף בהצלחה');
      }
      loadData();
      setShowProjectModal(false);
      setEditingProject(null);
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleEditProject = (e, project) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingProject(project);
    setShowProjectModal(true);
  };

  const handleSaveTask = async (taskData) => {
    try {
      if (!selectedProjectForTask) {
        modal.error('יש לבחור פרויקט');
        return;
      }
      await tasksAPI.create({ ...taskData, project_id: selectedProjectForTask.id });
      loadData();
      setShowTaskModal(false);
      setSelectedProjectForTask(null);
      modal.success('המשימה נוספה בהצלחה');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleCreateTaskClick = () => {
    if (projects.length === 0) {
      modal.error('אין פרויקטים זמינים. יש ליצור פרויקט קודם');
      return;
    }
    if (projects.length === 1) {
      // If only one project, use it directly
      setSelectedProjectForTask(projects[0]);
      setShowTaskModal(true);
    } else {
      // Show project selection modal
      setShowProjectSelector(true);
    }
  };

  const handleSelectProjectForTask = (project) => {
    setSelectedProjectForTask(project);
    setShowProjectSelector(false);
    setShowTaskModal(true);
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

  // Timer button click handler
  const handleTimerButtonClick = async (project) => {
    const existingTimer = getTimerForProject(project.id, null);

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
      setPendingTimerStart({ projectId: project.id, projectName: project.name });
      setShowConflictModal(true);
      return;
    }

    // No conflicts, start timer directly
    await doStartTimer(project.id);
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

  const handleToggleFavorite = async (e, client) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await clientsAPI.toggleFavorite(client.id, !client.is_favorite);
      loadData(); // Reload to re-sort
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  // Client timer handlers - local timers that save to server when stopped
  const handleStartClientTimer = (e, client) => {
    e.stopPropagation();
    setClientTimers(prev => ({
      ...prev,
      [client.id]: {
        startTime: Date.now(),
        isPaused: false,
        accumulatedSeconds: 0,
        clientName: client.name,
        clientId: client.id
      }
    }));
    setClientTimerElapsed(prev => ({ ...prev, [client.id]: 0 }));
  };

  const handlePauseClientTimer = (e, clientId) => {
    e.stopPropagation();
    setClientTimers(prev => {
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

  const handleResumeClientTimer = (e, clientId) => {
    e.stopPropagation();
    setClientTimers(prev => {
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

  const handleStopClientTimer = (e, client) => {
    e.stopPropagation();
    const timer = clientTimers[client.id];
    if (!timer) return;

    // Calculate total elapsed time
    let totalSeconds = timer.accumulatedSeconds;
    if (!timer.isPaused) {
      totalSeconds += Math.floor((Date.now() - timer.startTime) / 1000);
    }

    // Prepare data for time entry modal
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - totalSeconds * 1000);

    setTimeEntryData({
      clientId: client.id,
      durationSeconds: totalSeconds,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString()
    });
    setShowTimeEntryModal(true);
  };

  const handleSaveTimeEntry = async (data) => {
    try {
      await timerAPI.createEntry(data);
      
      // Clear the client timer
      if (timeEntryData?.clientId) {
        setClientTimers(prev => {
          const newTimers = { ...prev };
          delete newTimers[timeEntryData.clientId];
          return newTimers;
        });
        setClientTimerElapsed(prev => {
          const newElapsed = { ...prev };
          delete newElapsed[timeEntryData.clientId];
          return newElapsed;
        });
      }
      
      setShowTimeEntryModal(false);
      setTimeEntryData(null);
      modal.success('הזמן נשמר בהצלחה!');
      loadData();
    } catch (error) {
      modal.error(error.message || 'שגיאה בשמירת הזמן');
    }
  };

  const handleCancelTimeEntry = () => {
    setShowTimeEntryModal(false);
    setTimeEntryData(null);
    // Timer continues running - not cleared until saved
  };

  const handleDiscardClientTimer = (e, clientId) => {
    e.stopPropagation();
    // Simply remove the timer without saving
    setClientTimers(prev => {
      const newTimers = { ...prev };
      delete newTimers[clientId];
      return newTimers;
    });
    setClientTimerElapsed(prev => {
      const newElapsed = { ...prev };
      delete newElapsed[clientId];
      return newElapsed;
    });
  };

  // Get client timer state for display
  const getClientTimerState = (clientId) => {
    const timer = clientTimers[clientId];
    if (!timer) return null;
    
    return {
      isRunning: !timer.isPaused,
      elapsed: clientTimerElapsed[clientId] || timer.accumulatedSeconds
    };
  };

  // Get timer button state for a project
  const getProjectTimerButton = (projectId) => {
    const projectTimer = getTimerForProject(projectId, null);

    if (projectTimer) {
      return {
        icon: projectTimer.is_running ? '⏸' : '▶',
        text: projectTimer.is_running ? 'השהה' : 'המשך',
        className: 'btn-timer',
        iconColor: projectTimer.is_running ? 'warning' : 'success'
      };
    }

    return {
      icon: '▶',
      text: 'התחל',
      className: 'btn-timer',
      iconColor: 'primary'
    };
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  const stats = dashboardStats || {};

  // Priority order for sorting (high first, then normal, then low)
  const priorityOrder = { high: 0, normal: 1, low: 2 };

  // Get all pending tasks with client and project info
  const getFilteredTasks = () => {
    return tasks
      .filter(task => {
        // Status filter
        if (taskStatusFilter === 'open') return task.status !== 'completed';
        if (taskStatusFilter === 'completed') return task.status === 'completed';
        return true; // 'all'
      })
      .map(task => {
        const project = projects.find(p => p.id === task.project_id);
        const client = project ? clients.find(c => c.id === project.client_id) : null;
        return {
          ...task,
          projectName: project?.name,
          clientName: client?.name,
          projectId: project?.id,
          clientId: client?.id
        };
      })
      .filter(task => task.projectName) // Only tasks with projects
      .filter(task => taskPriorityFilter === 'all' || (task.priority || 'normal') === taskPriorityFilter) // Priority filter
      .sort((a, b) => {
        // First sort by priority (high > normal > low)
        const priorityA = priorityOrder[a.priority] ?? 1;
        const priorityB = priorityOrder[b.priority] ?? 1;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        // Then by due date if available
        if (a.due_date && b.due_date) {
          return new Date(a.due_date) - new Date(b.due_date);
        }
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });
  };

  const filteredTasks = getFilteredTasks();

  // Get active projects sorted by priority
  const getFilteredProjects = () => {
    return projects
      .filter(p => {
        // Status filter
        if (projectStatusFilter === 'active') return p.status === 'active';
        if (projectStatusFilter === 'completed') return p.status === 'completed';
        return true; // 'all'
      })
      .filter(p => projectPriorityFilter === 'all' || (p.priority || 'normal') === projectPriorityFilter) // Priority filter
      .sort((a, b) => {
        const priorityA = priorityOrder[a.priority] ?? 1;
        const priorityB = priorityOrder[b.priority] ?? 1;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return new Date(b.created_at) - new Date(a.created_at);
      })
      .slice(0, 10);
  };

  const filteredProjects = getFilteredProjects();

  // Helper to get priority indicator
  const getPriorityIndicator = (priority) => {
    switch (priority) {
      case 'high': return { icon: '🔼', label: 'גבוהה', className: 'priority-high' };
      case 'low': return { icon: '🔽', label: 'נמוכה', className: 'priority-low' };
      default: return null; // Don't show indicator for normal
    }
  };

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">שלום, {user?.name}!</h1>
        </div>
      </div>

      {/* Horizontal Task Cards */}
      {(filteredTasks.length > 0 || taskPriorityFilter !== 'all' || taskStatusFilter !== 'open') && (
        <div className="tasks-carousel-wrapper">
          <div className="section-header-inline">
            <Link to="/tasks" className="section-header-link">משימות</Link>
            <select 
              className="section-header-dropdown"
              value={taskStatusFilter}
              onChange={(e) => setTaskStatusFilter(e.target.value)}
            >
              <option value="open">פתוחות</option>
              <option value="completed">סגורות</option>
              <option value="all">הכל</option>
            </select>
            <span className="section-header-text">בחשיבות</span>
            <select 
              className="section-header-dropdown"
              value={taskPriorityFilter}
              onChange={(e) => setTaskPriorityFilter(e.target.value)}
            >
              <option value="all">כלשהי</option>
              <option value="high">גבוהה</option>
              <option value="normal">רגילה</option>
              <option value="low">נמוכה</option>
            </select>
            <span className="section-header-count">({filteredTasks.length})</span>
            <button 
              onClick={handleCreateTaskClick}
              className="section-header-add-btn"
              title="הוסף משימה חדשה"
            >
              <Plus size={16} />
              <span>משימה חדשה</span>
            </button>
          </div>
          {filteredTasks.length === 0 ? (
            <div className="carousel-empty-state">
              אין משימות {taskStatusFilter === 'open' ? 'פתוחות' : taskStatusFilter === 'completed' ? 'סגורות' : ''} 
              {taskPriorityFilter !== 'all' && ` בחשיבות ${taskPriorityFilter === 'high' ? 'גבוהה' : taskPriorityFilter === 'low' ? 'נמוכה' : 'רגילה'}`}
            </div>
          ) : (
          <>
          <div className="carousel-container">
            <button 
              className="carousel-arrow carousel-arrow-right"
              onClick={() => scrollToTaskCard(Math.max(0, taskCarouselIndex - 1))}
              disabled={taskCarouselIndex === 0}
            >
              <ChevronRight size={20} />
            </button>
            <div className="tasks-carousel" ref={taskCarouselRef}>
              {filteredTasks.map(task => {
                const priorityInfo = getPriorityIndicator(task.priority);
                return (
                  <Link 
                    key={task.id} 
                    to={`/tasks/${task.id}`} 
                    className={`task-card ${priorityInfo ? priorityInfo.className : ''}`}
                  >
                    <div className="task-card-header">
                      <button
                        className="task-card-status-btn"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleToggleTask(task);
                        }}
                        title="סמן כהושלם"
                      >
                        <Circle size={14} />
                      </button>
                      <h4 className="task-card-title">{task.name}</h4>
                      {priorityInfo && (
                        <span className="priority-badge" title={`חשיבות ${priorityInfo.label}`}>
                          {priorityInfo.icon}
                        </span>
                      )}
                    </div>
                    <div className="task-card-meta">
                      {task.clientName && (
                        <Link 
                          to={`/clients/${task.clientId}`}
                          className="task-card-meta-item task-card-meta-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Users size={12} />
                          <span>{task.clientName}</span>
                        </Link>
                      )}
                      {task.projectName && (
                        <Link 
                          to={`/projects/${task.projectId}`}
                          className="task-card-meta-item task-card-meta-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Folder size={12} />
                          <span>{task.projectName}</span>
                        </Link>
                      )}
                    </div>
                    {task.due_date && (
                      <div className="task-card-footer">
                        <Clock size={10} />
                        <span className="task-card-due-date">
                          {new Date(task.due_date).toLocaleDateString('he-IL')}
                        </span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
            <button 
              className="carousel-arrow carousel-arrow-left"
              onClick={() => scrollToTaskCard(Math.min(filteredTasks.length - 1, taskCarouselIndex + 1))}
              disabled={taskCarouselIndex >= filteredTasks.length - 1}
            >
              <ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} />
            </button>
          </div>
          <div className="carousel-dots">
            {filteredTasks.map((_, index) => (
              <button
                key={index}
                className={`carousel-dot ${index === taskCarouselIndex ? 'active' : ''}`}
                onClick={() => scrollToTaskCard(index)}
              />
            ))}
          </div>
          </>
          )}
        </div>
      )}

      {/* Recent Projects Section */}
      {(filteredProjects.length > 0 || projectPriorityFilter !== 'all' || projectStatusFilter !== 'active') && (
        <div className="tasks-carousel-wrapper">
          <div className="section-header-inline">
            <Link to="/projects" className="section-header-link">פרויקטים</Link>
            <select 
              className="section-header-dropdown"
              value={projectStatusFilter}
              onChange={(e) => setProjectStatusFilter(e.target.value)}
            >
              <option value="active">פעילים</option>
              <option value="completed">סגורים</option>
              <option value="all">הכל</option>
            </select>
            <span className="section-header-text">בחשיבות</span>
            <select 
              className="section-header-dropdown"
              value={projectPriorityFilter}
              onChange={(e) => setProjectPriorityFilter(e.target.value)}
            >
              <option value="all">כלשהי</option>
              <option value="high">גבוהה</option>
              <option value="normal">רגילה</option>
              <option value="low">נמוכה</option>
            </select>
            <span className="section-header-count">({filteredProjects.length})</span>
            <button 
              onClick={() => setShowProjectModal(true)}
              className="section-header-add-btn"
              title="הוסף פרויקט חדש"
            >
              <Plus size={16} />
              <span>פרויקט חדש</span>
            </button>
          </div>
          {filteredProjects.length === 0 ? (
            <div className="carousel-empty-state">
              אין פרויקטים {projectStatusFilter === 'active' ? 'פעילים' : projectStatusFilter === 'completed' ? 'סגורים' : ''} 
              {projectPriorityFilter !== 'all' && ` בחשיבות ${projectPriorityFilter === 'high' ? 'גבוהה' : projectPriorityFilter === 'low' ? 'נמוכה' : 'רגילה'}`}
            </div>
          ) : (
          <>
          <div className="carousel-container">
            <button 
              className="carousel-arrow carousel-arrow-right"
              onClick={() => scrollToProjectCard(Math.max(0, projectCarouselIndex - 1))}
              disabled={projectCarouselIndex === 0}
            >
              <ChevronRight size={20} />
            </button>
            <div className="tasks-carousel" ref={projectCarouselRef}>
              {filteredProjects.map(project => {
                const client = clients.find(c => c.id === project.client_id);
                const projectTimer = getTimerForProject(project.id, null);
                const priorityInfo = getPriorityIndicator(project.priority);
                
                // Calculate progress based on completed tasks
                const projectTasks = tasks.filter(t => t.project_id === project.id);
                const completedCount = projectTasks.filter(t => t.status === 'completed').length;
                const totalCount = projectTasks.length;
                const progressPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
                
                return (
                  <div key={project.id} className="task-card-wrapper" style={{ position: 'relative' }}>
                    <Link 
                      to={`/projects/${project.id}`} 
                      className={`task-card ${priorityInfo ? priorityInfo.className : ''}`}
                    >
                      <div className="task-card-header">
                        <Folder size={14} color="var(--accent-primary)" />
                        <h4 className="task-card-title">{project.name}</h4>
                        {priorityInfo && (
                          <span className="priority-badge" title={`חשיבות ${priorityInfo.label}`}>
                            {priorityInfo.icon}
                          </span>
                        )}
                        <button
                          className="project-card-menu-btn"
                          onClick={(e) => handleEditProject(e, project)}
                          title="ערוך פרויקט"
                        >
                          <MoreVertical size={14} />
                        </button>
                      </div>
                    <div className="task-card-meta">
                      {client && (
                        <Link 
                          to={`/clients/${client.id}`}
                          className="task-card-meta-item task-card-meta-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Users size={12} />
                          <span>{client.name}</span>
                        </Link>
                      )}
                      {projectTimer && (
                        <div className="task-card-meta-item">
                          <Clock size={12} />
                          <span>{formatDurationHuman(projectTimer.accumulated_seconds)}</span>
                        </div>
                      )}
                      <PaymentStatusBadge
                        totalEarned={calculateProjectEarnings(project, client)}
                        paidAmount={project.paid_amount || 0}
                        compact
                      />
                    </div>
                    {totalCount > 0 && (
                      <div className="task-card-progress-bar">
                        <div
                          className="task-card-progress-bar-fill"
                          style={{ width: `${progressPercentage}%` }}
                        />
                      </div>
                    )}
                    </Link>
                  </div>
                );
              })}
            </div>
            <button 
              className="carousel-arrow carousel-arrow-left"
              onClick={() => {
                scrollToProjectCard(Math.min(filteredProjects.length - 1, projectCarouselIndex + 1));
              }}
              disabled={projectCarouselIndex >= filteredProjects.length - 1}
            >
              <ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} />
            </button>
          </div>
          <div className="carousel-dots">
            {filteredProjects.map((_, index) => (
              <button
                key={index}
                className={`carousel-dot ${index === projectCarouselIndex ? 'active' : ''}`}
                onClick={() => scrollToProjectCard(index)}
              />
            ))}
          </div>
          </>
          )}
        </div>
      )}

      <div className="section-header-row">
        <h3 className="section-header-title">הלקוחות שלך ({clients.length})</h3>
        <button 
          onClick={() => setShowClientModal(true)}
          className="section-header-add-btn"
          title="הוסף לקוח חדש"
        >
          <Plus size={16} />
          <span>לקוח חדש</span>
        </button>
      </div>

          {filteredClients.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                {searchQuery ? <Search size={48} strokeWidth={1.5} /> : <Users size={48} strokeWidth={1.5} />}
              </div>
              <p>{searchQuery ? 'לא נמצאו תוצאות' : 'עדיין אין לקוחות'}</p>
              {!searchQuery && (
                <button onClick={() => setShowClientModal(true)} className="btn btn-primary btn-sm mt-4">
                  <Plus size={16} />
                  <span>הוסף לקוח ראשון</span>
                </button>
              )}
            </div>
          ) : (
            <div className="items-list">
              {filteredClients.map((client, index) => {
                // Check if we need to show a separator between favorites and non-favorites
                const prevClient = index > 0 ? filteredClients[index - 1] : null;
                const showSeparator = prevClient && !!prevClient.is_favorite && !client.is_favorite;
                // Filter projects for this client
                let clientProjects = projects.filter(p => p.client_id === client.id && p.status === 'active');

                // Apply search filter to projects if needed
                if (searchQuery.trim()) {
                  const query = searchQuery.toLowerCase();
                  clientProjects = clientProjects.filter(p =>
                    p.name.toLowerCase().includes(query) ||
                    client.name.toLowerCase().includes(query) ||
                    tasks.some(t => t.project_id === p.id && t.name.toLowerCase().includes(query))
                  );
                }

                const isExpanded = expandedClients[client.id] || searchQuery.trim().length > 0;

                return (
                  <React.Fragment key={client.id}>
                    {showSeparator && (
                      <div className="zone-separator">
                        <span>לקוחות נוספים</span>
                      </div>
                    )}
                    <div 
                      className={`client-group-wrapper ${dragOverClient?.id === client.id ? 'drag-over' : ''} ${draggedClient?.id === client.id ? 'dragging' : ''}`}
                      role="group" 
                      aria-label={`לקוח: ${client.name}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, client)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, client)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, client)}
                    >
                    <div 
                      className="list-item client-item"
                      onClick={() => clientProjects.length > 0 && toggleClient(client.id)}
                      style={{ cursor: clientProjects.length > 0 ? 'pointer' : 'default' }}
                    >
                      <button
                        className={`btn-icon-star-dashboard ${client.is_favorite ? 'is-favorite' : ''}`}
                        onClick={(e) => handleToggleFavorite(e, client)}
                        title={client.is_favorite ? 'הסר ממועדפים' : 'הוסף למועדפים'}
                      >
                        <Star size={16} fill={client.is_favorite ? "currentColor" : "none"} />
                      </button>
                      <div className="list-item-content">
                        <div className="list-item-title">
                          <Link 
                            to={`/clients/${client.id}`} 
                            onClick={(e) => e.stopPropagation()}
                            className="list-item-link"
                          >
                            {client.name}
                            <ExternalLink size={12} className="link-icon" />
                          </Link>
                        </div>
                        <div className="list-item-subtitle">
                          <div>{client.project_count > 0 ? `פרויקטים פתוחים: ${client.project_count}` : 'אין פרויקטים פעילים'}</div>
                          {client.total_amount_due > 0 && (
                            <div className="text-warning">
                              סכום לתשלום: {formatCurrency(client.total_amount_due)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="client-timer-area">
                        {/* Client Quick Timer */}
                        {(() => {
                          const timerState = getClientTimerState(client.id);
                          
                          if (!timerState) {
                            // No timer - show play button
                            return (
                              <button
                                className="client-timer-btn client-timer-play"
                                onClick={(e) => handleStartClientTimer(e, client)}
                                title="התחל טיימר"
                              >
                                <Play size={14} />
                              </button>
                            );
                          }
                          
                          // Timer active - show pause/resume, stop, and discard
                          return (
                            <div className="client-timer-controls">
                              <button
                                className="client-timer-btn client-timer-discard"
                                onClick={(e) => handleDiscardClientTimer(e, client.id)}
                                title="בטל טיימר"
                              >
                                <X size={14} />
                              </button>
                              <button
                                className="client-timer-btn client-timer-stop"
                                onClick={(e) => handleStopClientTimer(e, client)}
                                title="עצור ושמור"
                              >
                                <Square size={14} />
                              </button>
                              {timerState.isRunning ? (
                                <button
                                  className="client-timer-btn client-timer-pause"
                                  onClick={(e) => handlePauseClientTimer(e, client.id)}
                                  title="השהה"
                                >
                                  <Pause size={14} />
                                </button>
                              ) : (
                                <button
                                  className="client-timer-btn client-timer-resume"
                                  onClick={(e) => handleResumeClientTimer(e, client.id)}
                                  title="המשך"
                                >
                                  <Play size={14} />
                                </button>
                              )}
                              <span className="client-timer-elapsed">
                                {formatDurationHuman(timerState.elapsed)}
                              </span>
                            </div>
                          );
                        })()}
                        
                        <span className={`client-status-badge ${getClientStatus(client.status).badge}`}>
                          {getClientStatus(client.status).label}
                        </span>
                      </div>
                    </div>

                    {isExpanded && clientProjects.length > 0 && (
                      <div className="nested-projects" role="group" aria-label={`פרויקטים של ${client.name}`}>
                        {clientProjects.map(project => {
                          // Filter tasks for this project
                          let projectTasks = tasks.filter(t => t.project_id === project.id);

                          // Sort: pending first, then completed
                          projectTasks.sort((a, b) => {
                            if (a.status === b.status) return 0;
                            return a.status === 'completed' ? 1 : -1;
                          });

                          // Apply search filter to tasks if needed
                          if (searchQuery.trim()) {
                            const query = searchQuery.toLowerCase();
                            projectTasks = projectTasks.filter(t =>
                              t.name.toLowerCase().includes(query) ||
                              project.name.toLowerCase().includes(query) ||
                              client.name.toLowerCase().includes(query)
                            );
                          }

                          const isProjectExpanded = expandedProjects[project.id] || searchQuery.trim().length > 0;
                          const timerBtn = getProjectTimerButton(project.id);
                          
                          // Count only open (non-completed) tasks
                          const openTasksCount = projectTasks.filter(t => t.status !== 'completed').length;

                          return (
                            <div key={project.id} className="project-group-wrapper" role="group" aria-label={`פרויקט: ${project.name}`}>
                              <div 
                                className="list-item project-item"
                                onClick={() => projectTasks.length > 0 && toggleProject(project.id)}
                                style={{ cursor: projectTasks.length > 0 ? 'pointer' : 'default' }}
                              >
                                <div className="list-item-content">
                                  <div className="list-item-title">
                                    <Link 
                                      to={`/projects/${project.id}`} 
                                      onClick={(e) => e.stopPropagation()}
                                      className="list-item-link"
                                    >
                                      {project.name}
                                      <ExternalLink size={12} className="link-icon" />
                                    </Link>
                                  </div>
                                  <div className="list-item-subtitle">
                                    {openTasksCount > 0 ? `משימות פתוחות ״${openTasksCount}״` : 'אין משימות פתוחות'}
                                  </div>
                                </div>
                                <div className="project-timer-area">
                                  {(() => {
                                    const projectTimer = getTimerForProject(project.id, null);
                                    
                                    if (!projectTimer) {
                                      // No timer - show play button
                                      return (
                                        <button
                                          className="client-timer-btn client-timer-play"
                                          onClick={(e) => { e.stopPropagation(); handleTimerButtonClick(project); }}
                                          title="התחל טיימר"
                                        >
                                          <Play size={14} />
                                        </button>
                                      );
                                    }
                                    
                                    // Timer active - show controls
                                    return (
                                      <div className="client-timer-controls">
                                        <span className="client-timer-elapsed">
                                          {formatDurationHuman(
                                            projectTimer.is_running 
                                              ? projectTimer.accumulated_seconds + Math.floor((Date.now() - new Date(projectTimer.start_time).getTime()) / 1000)
                                              : projectTimer.accumulated_seconds
                                          )}
                                        </span>
                                        {projectTimer.is_running ? (
                                          <button
                                            className="client-timer-btn client-timer-pause"
                                            onClick={(e) => { e.stopPropagation(); handleTimerButtonClick(project); }}
                                            title="השהה"
                                          >
                                            <Pause size={14} />
                                          </button>
                                        ) : (
                                          <button
                                            className="client-timer-btn client-timer-resume"
                                            onClick={(e) => { e.stopPropagation(); handleTimerButtonClick(project); }}
                                            title="המשך"
                                          >
                                            <Play size={14} />
                                          </button>
                                        )}
                                        <button
                                          className="client-timer-btn client-timer-stop"
                                          onClick={(e) => { e.stopPropagation(); handleStopTimerClick(projectTimer, project.name); }}
                                          title="עצור ושמור"
                                        >
                                          <Square size={14} />
                                        </button>
                                        <button
                                          className="client-timer-btn client-timer-discard"
                                          onClick={(e) => { e.stopPropagation(); discardTimer(projectTimer.id); }}
                                          title="בטל טיימר"
                                        >
                                          <X size={14} />
                                        </button>
                                      </div>
                                    );
                                  })()}
                                  
                                  <span className={`client-status-badge ${getProjectStatus(project.status).badge}`}>
                                    {getProjectStatus(project.status).label}
                                  </span>
                                </div>
                              </div>

                              {isProjectExpanded && projectTasks.length > 0 && (
                                <div className="nested-tasks" role="group" aria-label={`משימות של ${project.name}`}>
                                  {projectTasks.map(task => (
                                    <div key={task.id} className={`list-item task-item ${task.status === 'completed' ? 'completed' : ''}`}>
                                      <button
                                        className={`task-checkbox ${task.status === 'completed' ? 'checked' : ''}`}
                                        onClick={() => handleToggleTask(task)}
                                        title={task.status === 'completed' ? 'סמן כלא הושלם' : 'סמן כהושלם'}
                                      >
                                        {task.status === 'completed' ? <CircleCheck size={16} /> : <Circle size={16} />}
                                      </button>
                                      <div className="list-item-content">
                                        <div className="list-item-title">
                                          <Link to={`/tasks/${task.id}`} onClick={(e) => e.stopPropagation()} className="clickable-name">
                                            {task.name}
                                          </Link>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  </React.Fragment>
                );
              })}
            </div>
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

      {showClientModal && (
        <ClientModal
          onSave={handleSaveClient}
          onClose={() => setShowClientModal(false)}
          onDelete={handleDeleteClient}
        />
      )}

      {showProjectModal && (
        <ProjectModal
          project={editingProject}
          onSave={handleSaveProject}
          onClose={() => {
            setShowProjectModal(false);
            setEditingProject(null);
          }}
        />
      )}

      {showProjectSelector && createPortal(
        <div className="modal-overlay" onClick={() => setShowProjectSelector(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3 className="modal-title">בחר פרויקט</h3>
              <button onClick={() => setShowProjectSelector(false)} className="btn btn-ghost btn-icon">
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {projects.map(project => {
                  const client = clients.find(c => c.id === project.client_id);
                  return (
                    <button
                      key={project.id}
                      onClick={() => handleSelectProjectForTask(project)}
                      className="btn btn-secondary"
                      style={{ justifyContent: 'flex-start', textAlign: 'right' }}
                    >
                      <Folder size={16} style={{ marginLeft: '0.5rem' }} />
                      <span>{project.name}</span>
                      {client && (
                        <span style={{ marginRight: 'auto', opacity: 0.7, fontSize: '0.875rem' }}>
                          ({client.name})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showTaskModal && selectedProjectForTask && (
        <TaskModal
          projectHourlyRate={selectedProjectForTask.hourly_rate}
          projectPricingType={selectedProjectForTask.pricing_type}
          onSave={handleSaveTask}
          onClose={() => {
            setShowTaskModal(false);
            setSelectedProjectForTask(null);
          }}
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

      <Forum
        entityType="dashboard"
      />

      {showTimeEntryModal && timeEntryData && (
        <TimeEntryModal
          clientId={timeEntryData.clientId}
          durationSeconds={timeEntryData.durationSeconds}
          startTime={timeEntryData.startTime}
          endTime={timeEntryData.endTime}
          isFromTimer={true}
          onSave={handleSaveTimeEntry}
          onClose={handleCancelTimeEntry}
        />
      )}
    </div>
  );
}

export default Dashboard;
