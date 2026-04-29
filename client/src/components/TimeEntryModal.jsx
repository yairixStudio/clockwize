import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Timer, Plus, Trash2, ChevronDown, ChevronUp, Link2, Sparkles, FolderOpen, CheckSquare } from 'lucide-react';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import { clientsAPI, projectsAPI, tasksAPI, timerAPI } from '../services/api';
import { formatDurationHuman } from '../utils/format';

function TimeEntryModal({ entry, projectId, taskId, clientId, durationSeconds, startTime: propStartTime, endTime: propEndTime, isFromTimer = false, onSave, onClose }) {
  useBodyScrollLock(true);
  const formRef = useRef(null);

  // Intervals state
  const [intervals, setIntervals] = useState([]);
  const [loadingIntervals, setLoadingIntervals] = useState(false);
  const [showIntervals, setShowIntervals] = useState(false);

  // Determine if this is from timer (either explicitly or by having durationSeconds with startTime/endTime)
  const isTimerEntry = isFromTimer || (durationSeconds && propStartTime && propEndTime);

  // Helper to format date as YYYY-MM-DD for inputs
  const toInputDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Default values for new entry
  const now = propEndTime ? new Date(propEndTime) : new Date();
  const defaultDuration = durationSeconds || 3600; // 1 hour default
  const computedStartTime = propStartTime ? new Date(propStartTime) : new Date(now.getTime() - defaultDuration * 1000);

  const defaultStartDate = toInputDate(computedStartTime);
  const defaultEndDate = toInputDate(now);
  
  const defaultStartTimeStr = computedStartTime.toTimeString().slice(0, 5);
  const defaultEndTimeStr = now.toTimeString().slice(0, 5);

  // Pre-calculate duration hours and minutes if durationSeconds is provided
  const prefilledHours = durationSeconds ? Math.floor(durationSeconds / 3600) : '';
  const prefilledMinutes = durationSeconds ? Math.floor((durationSeconds % 3600) / 60) : '';

  const [formData, setFormData] = useState({
    start_date: defaultStartDate,
    end_date: defaultEndDate,
    start_time: defaultStartTimeStr,
    end_time: defaultEndTimeStr,
    duration_hours: prefilledHours,
    duration_minutes: prefilledMinutes,
    notes: '',
    use_duration: false, // Always show start/end by default
    client_id: clientId || '',
    project_id: projectId || '',
    task_id: taskId || '',
    subtask_id: ''
  });
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [subtasks, setSubtasks] = useState([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  
  // Additional associations state (for multi-project/task support)
  const [additionalAssociations, setAdditionalAssociations] = useState([]);
  const [showAddAssociation, setShowAddAssociation] = useState(false);
  const [allProjects, setAllProjects] = useState([]);
  const [allTasks, setAllTasks] = useState([]);

  useEffect(() => {
    loadClients();
    loadAllProjectsAndTasks();
    
    // Load intervals if editing
    if (entry?.id) {
      loadIntervals(entry.id);
    }
    
    // Load existing additional associations if editing
    if (entry?.additional_associations) {
      setAdditionalAssociations(entry.additional_associations.map(a => ({
        id: a.id,
        project_id: a.project_id || '',
        task_id: a.task_id || '',
        project_name: a.project_name || '',
        task_name: a.task_name || ''
      })));
      if (entry.additional_associations.length > 0) {
        setShowAddAssociation(true);
      }
    }
  }, []);

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

  // Quick suggestions for unassigned entries based on creation date proximity
  const quickSuggestions = useMemo(() => {
    // Only show suggestions when entry has no project assigned
    if (formData.project_id || formData.task_id) return [];

    const entryDate = new Date(formData.start_date);
    if (isNaN(entryDate.getTime())) return [];

    const MAX_DAYS_DIFF = 7; // Show suggestions within 7 days
    const MAX_SUGGESTIONS = 5;

    const suggestions = [];

    // Score projects by date proximity
    allProjects.forEach(project => {
      if (!project.created_at || project.status === 'archived') return;
      const createdDate = new Date(project.created_at);
      const daysDiff = Math.abs((entryDate - createdDate) / (1000 * 60 * 60 * 24));
      if (daysDiff <= MAX_DAYS_DIFF) {
        suggestions.push({
          type: 'project',
          id: project.id,
          name: project.name,
          client_id: project.client_id,
          client_name: project.client_name,
          daysDiff: Math.round(daysDiff),
          created_at: project.created_at
        });
      }
    });

    // Score tasks by date proximity
    allTasks.forEach(task => {
      if (!task.created_at || task.status === 'completed') return;
      const createdDate = new Date(task.created_at);
      const daysDiff = Math.abs((entryDate - createdDate) / (1000 * 60 * 60 * 24));
      if (daysDiff <= MAX_DAYS_DIFF) {
        const parentProject = allProjects.find(p => p.id === task.project_id);
        suggestions.push({
          type: 'task',
          id: task.id,
          name: task.name,
          project_id: task.project_id,
          project_name: task.project_name || parentProject?.name || '',
          client_id: parentProject?.client_id || '',
          client_name: parentProject?.client_name || '',
          daysDiff: Math.round(daysDiff),
          created_at: task.created_at
        });
      }
    });

    // Sort by proximity (closest first)
    suggestions.sort((a, b) => a.daysDiff - b.daysDiff);

    return suggestions.slice(0, MAX_SUGGESTIONS);
  }, [allProjects, allTasks, formData.start_date, formData.project_id, formData.task_id]);

  const handleQuickSuggestion = (suggestion) => {
    if (suggestion.type === 'task') {
      setFormData(prev => ({
        ...prev,
        client_id: suggestion.client_id,
        project_id: suggestion.project_id,
        task_id: suggestion.id
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        client_id: suggestion.client_id,
        project_id: suggestion.id,
        task_id: ''
      }));
    }
  };

  const loadIntervals = async (entryId) => {
    setLoadingIntervals(true);
    try {
      const data = await timerAPI.getEntryIntervals(entryId);
      setIntervals(data);
      if (data.length > 0) {
        setShowIntervals(true);
      }
    } catch (error) {
      console.error('Failed to load intervals:', error);
    } finally {
      setLoadingIntervals(false);
    }
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
      // Reset task if project changes
      if (field === 'project_id') {
        updated[index].task_id = '';
      }
      return updated;
    });
  };

  const getTasksForProject = (projectId) => {
    return allTasks.filter(t => t.project_id === projectId);
  };

  // Calculate total duration from intervals
  const calculateTotalFromIntervals = () => {
    return intervals.reduce((sum, interval) => {
      return sum + (interval.duration_seconds || 0);
    }, 0);
  };

  useEffect(() => {
    if (formData.client_id) {
      loadProjects(formData.client_id);
    } else {
      setProjects([]);
    }
  }, [formData.client_id]);

  useEffect(() => {
    if (formData.project_id) {
      loadTasks(formData.project_id);
    } else {
      setTasks([]);
    }
  }, [formData.project_id]);

  useEffect(() => {
    if (formData.task_id) {
      loadSubtasks(formData.task_id);
    } else {
      setSubtasks([]);
    }
  }, [formData.task_id]);

  const loadClients = async () => {
    try {
      const data = await clientsAPI.getAll();
      setClients(data);
    } catch (error) {
      console.error('Failed to load clients:', error);
    }
  };

  const loadProjects = async (clientId) => {
    try {
      const data = await projectsAPI.getAll(clientId);
      setProjects(data);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  const loadTasks = async (projId) => {
    try {
      const data = await tasksAPI.getAll(projId);
      setTasks(data);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    }
  };

  const loadSubtasks = async (taskId) => {
    try {
      const taskData = await tasksAPI.getOne(taskId);
      setSubtasks(taskData.subtasks || []);
    } catch (error) {
      console.error('Failed to load subtasks:', error);
      setSubtasks([]);
    }
  };

  useEffect(() => {
    if (entry) {
      const startDate = new Date(entry.start_time);
      const endDate = entry.end_time ? new Date(entry.end_time) : null;

      const hours = Math.floor((entry.duration || 0) / 3600);
      const minutes = Math.floor(((entry.duration || 0) % 3600) / 60);

      // Format date manually to ensure local time
      const startYear = startDate.getFullYear();
      const startMonth = String(startDate.getMonth() + 1).padStart(2, '0');
      const startDay = String(startDate.getDate()).padStart(2, '0');
      const startDateStr = `${startYear}-${startMonth}-${startDay}`;

      let endDateStr = startDateStr;
      if (endDate) {
          const endYear = endDate.getFullYear();
          const endMonth = String(endDate.getMonth() + 1).padStart(2, '0');
          const endDay = String(endDate.getDate()).padStart(2, '0');
          endDateStr = `${endYear}-${endMonth}-${endDay}`;
      }

      setFormData({
        start_date: startDateStr,
        end_date: endDateStr,
        start_time: startDate.toTimeString().slice(0, 5),
        end_time: endDate ? endDate.toTimeString().slice(0, 5) : '',
        duration_hours: hours > 0 ? hours.toString() : '',
        duration_minutes: minutes > 0 ? minutes.toString() : '',
        notes: entry.notes || '',
        use_duration: false,
        client_id: entry.client_id || clientId || '', 
        project_id: entry.project_id || projectId || '',
        task_id: entry.task_id || taskId || '',
        subtask_id: entry.subtask_id || ''
      });
    } else if (projectId) {
      // If creating new and we have projectId, find its client to pre-fill
      projectsAPI.getOne(projectId).then(proj => {
        setFormData(prev => ({
          ...prev,
          client_id: proj.client_id,
          project_id: projectId,
          task_id: taskId || '',
          subtask_id: ''
        }));
      });
    } else if (clientId && !formData.client_id) {
      // If only clientId is provided and not already set, set it
      setFormData(prev => ({
        ...prev,
        client_id: clientId
      }));
    }
  }, [entry, projectId, taskId, clientId]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    // Handle special case of creating new project
    if (name === 'project_id' && value === '__new__') {
      setShowNewProject(true);
      setNewProjectName('');
      return;
    }
    
    // If selecting a real project, hide new project form
    if (name === 'project_id') {
      setShowNewProject(false);
      setNewProjectName('');
    }
    
    // Handle special case of creating new task
    if (name === 'task_id' && value === '__new__') {
      setShowNewTask(true);
      setNewTaskName('');
      return;
    }
    
    // If selecting a real task, hide new task form
    if (name === 'task_id') {
      setShowNewTask(false);
      setNewTaskName('');
    }
    
    setFormData(prev => {
      const newData = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      };

      // Reset child fields when parent changes
      if (name === 'client_id') {
        newData.project_id = '';
        newData.task_id = '';
        newData.subtask_id = '';
        setShowNewProject(false);
        setNewProjectName('');
        setShowNewTask(false);
        setNewTaskName('');
      } else if (name === 'project_id') {
        newData.task_id = '';
        newData.subtask_id = '';
        setShowNewTask(false);
        setNewTaskName('');
      } else if (name === 'task_id') {
        newData.subtask_id = '';
      }
      
      // If start_date changes, and end_date was same as old start_date, update end_date too (user convenience)
      if (name === 'start_date' && prev.end_date === prev.start_date) {
        newData.end_date = value;
      }
      
      return newData;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const form = formRef.current;
      let start_time, end_time, duration;

      if (formData.use_duration) {
        // Using duration input
        const hours = parseInt(formData.duration_hours) || 0;
        const minutes = parseInt(formData.duration_minutes) || 0;
        duration = (hours * 3600) + (minutes * 60);

        // Create start time from date and time
        start_time = `${formData.start_date}T${formData.start_time}:00`;
        // Calculate end time based on duration
        const startMs = new Date(start_time).getTime();
        end_time = new Date(startMs + duration * 1000).toISOString();
      } else {
        // Using start/end time
        start_time = `${formData.start_date}T${formData.start_time}:00`;
        end_time = `${formData.end_date}T${formData.end_time}:00`;

        // Calculate duration
        const startMs = new Date(start_time).getTime();
        const endMs = new Date(end_time).getTime();
        duration = Math.floor((endMs - startMs) / 1000);
      }

      // If intervals were modified, recalculate duration from them
      let finalDuration = duration;
      let finalStartTime = start_time;
      let finalEndTime = end_time;
      
      // Prepare intervals data
      let intervalsData = null;
      if (intervals.length > 0) {
        intervalsData = intervals.map(interval => {
          const startDate = interval.start_date_input || formatDateForInput(interval.start_time);
          const startTime = interval.start_time_input || formatTimeForInput(interval.start_time);
          const endDate = interval.end_date_input || formatDateForInput(interval.end_time);
          const endTime = interval.end_time_input || formatTimeForInput(interval.end_time);
          
          return {
            id: interval.isNew ? null : interval.id,
            start_time: `${startDate}T${startTime}:00`,
            end_time: `${endDate}T${endTime}:00`,
            duration_seconds: interval.duration_seconds || 0
          };
        });

        // Calculate total duration from intervals
        finalDuration = intervalsData.reduce((sum, i) => sum + (i.duration_seconds || 0), 0);
        
        // Update start/end times based on intervals
        if (intervalsData.length > 0) {
          finalStartTime = intervalsData[0].start_time;
          finalEndTime = intervalsData[intervalsData.length - 1].end_time;
        }
      }

      // If creating a new project, create it first
      let projectId = formData.project_id || null;
      if (showNewProject && newProjectName.trim() && formData.client_id) {
        const newProject = await projectsAPI.create({
          name: newProjectName.trim(),
          client_id: formData.client_id
        });
        projectId = newProject.id;
      }

      // If creating a new task, create it after project is resolved
      let taskId = formData.task_id || null;
      if (showNewTask && newTaskName.trim() && projectId) {
        const newTask = await tasksAPI.create({
          name: newTaskName.trim(),
          project_id: projectId
        });
        taskId = newTask.id;
      }

      // Prepare additional associations (filter out empty ones)
      const validAssociations = additionalAssociations
        .filter(a => a.project_id || a.task_id)
        .map(a => ({
          project_id: a.project_id || null,
          task_id: a.task_id || null
        }));

      const data = {
        start_time: finalStartTime,
        end_time: finalEndTime,
        duration: finalDuration,
        notes: formData.notes || null,
        project_id: projectId,
        task_id: taskId,
        subtask_id: formData.subtask_id || null,
        intervals: intervalsData,
        additional_associations: validAssociations
      };

      await onSave(data);
    } catch (error) {
      console.error('Save time entry error:', error);
      // Log the full error details if available
      if (error.details) {
        console.error('Server error details:', error.details);
      }
    } finally {
      setLoading(false);
    }
  };

  const isEditing = !!entry;
  const isManualEntry = !isEditing && !isTimerEntry;

  // Determine modal title
  const getModalTitle = () => {
    if (isEditing) return 'עריכת רשומת זמן';
    if (isTimerEntry) return 'שמירת זמן עבודה';
    return 'הוספת רשומת זמן ידנית';
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">
            {getModalTitle()}
          </h3>
          <button onClick={onClose} className="btn btn-ghost btn-icon">✕</button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            {isManualEntry && (
              <div className="manual-entry-notice">
                <span className="notice-icon">✏️</span>
                <span>רשומה ידנית תסומן בסימון מיוחד</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">לקוח</label>
              <select
                name="client_id"
                className="form-input"
                value={formData.client_id}
                onChange={handleChange}
                required={!isEditing} // Optional on edit if we want, but usually required
              >
                <option value="">בחר לקוח...</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Quick suggestions for unassigned entries */}
            {quickSuggestions.length > 0 && (
              <div className="quick-suggestions">
                <div className="quick-suggestions-header">
                  <Sparkles size={14} />
                  <span>הצעות שיוך מהיר</span>
                </div>
                <div className="quick-suggestions-list">
                  {quickSuggestions.map(suggestion => (
                    <button
                      key={`${suggestion.type}-${suggestion.id}`}
                      type="button"
                      className="quick-suggestion-chip"
                      onClick={() => handleQuickSuggestion(suggestion)}
                      title={`נוצר ${suggestion.daysDiff === 0 ? 'היום' : `לפני ${suggestion.daysDiff} ימים`}`}
                    >
                      {suggestion.type === 'project' ? (
                        <FolderOpen size={12} />
                      ) : (
                        <CheckSquare size={12} />
                      )}
                      <span className="suggestion-name">
                        {suggestion.client_name && `${suggestion.client_name} / `}
                        {suggestion.type === 'task' && suggestion.project_name && `${suggestion.project_name} / `}
                        {suggestion.name}
                      </span>
                      {suggestion.daysDiff === 0 && <span className="suggestion-badge">היום</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">פרויקט (אופציונלי)</label>
              <select
                name="project_id"
                className="form-input"
                value={showNewProject ? '__new__' : formData.project_id}
                onChange={handleChange}
                disabled={!formData.client_id}
              >
                <option value="">ללא פרויקט</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
                {formData.client_id && (
                  <option value="__new__">+ פרויקט חדש...</option>
                )}
              </select>
              
              {showNewProject && (
                <div className="new-project-inline">
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

            <div className="form-group">
              <label className="form-label">משימה (אופציונלי)</label>
              <select
                name="task_id"
                className="form-input"
                value={showNewTask ? '__new__' : formData.task_id}
                onChange={handleChange}
                disabled={!formData.project_id && !showNewProject}
              >
                <option value="">ללא משימה</option>
                {tasks.map(task => (
                  <option key={task.id} value={task.id}>
                    {task.name}
                  </option>
                ))}
                {(formData.project_id || showNewProject) && (
                  <option value="__new__">+ משימה חדשה...</option>
                )}
              </select>
              
              {showNewTask && (
                <div className="new-project-inline">
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

            {formData.task_id && subtasks.length > 0 && (
              <div className="form-group">
                <label className="form-label">תת-משימה (אופציונלי)</label>
                <select
                  name="subtask_id"
                  className="form-input"
                  value={formData.subtask_id}
                  onChange={handleChange}
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
            <div className="additional-associations-section">
              {!showAddAssociation ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm add-association-toggle"
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
                <div className="associations-container">
                  <div className="associations-header">
                    <Link2 size={16} />
                    <span>שיוכים נוספים</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowAddAssociation(false)}
                    >
                      הסתר
                    </button>
                  </div>
                  
                  <div className="associations-list">
                    {additionalAssociations.map((assoc, index) => (
                      <div key={assoc.id} className="association-item">
                        <select
                          className="form-input association-select"
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
                          className="form-input association-select"
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
                    className="btn btn-ghost btn-sm add-association-btn"
                    onClick={handleAddAssociation}
                  >
                    <Plus size={14} />
                    הוסף שיוך נוסף
                  </button>
                </div>
              )}
            </div>

            {/* Time inputs */}
            {intervals.length > 0 ? (
              /* Intervals-based editing */
              <div className="intervals-section-main">
                <div className="intervals-header-main">
                  <Timer size={16} />
                  <span>קטעי זמן</span>
                  <span className="intervals-total-badge">
                    סה״כ: {formatDurationHuman(calculateTotalFromIntervals())}
                  </span>
                </div>

                <div className="intervals-list-edit">
                  {intervals.map((interval, index) => (
                    <div key={interval.id} className="interval-edit-item">
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

                <button
                  type="button"
                  className="btn btn-ghost btn-sm add-interval-btn"
                  onClick={handleAddInterval}
                >
                  <Plus size={14} />
                  הוסף קטע זמן
                </button>
              </div>
            ) : (
              /* Regular time input fields */
              <>
                <div className="form-group">
                  <label className="form-checkbox">
                    <input
                      type="checkbox"
                      name="use_duration"
                      checked={formData.use_duration}
                      onChange={handleChange}
                    />
                    <span>הזן משך זמן במקום שעת התחלה וסיום</span>
                  </label>
                </div>

                {formData.use_duration ? (
                  <>
                    <div className="form-group">
                      <label className="form-label">תאריך</label>
                      <input
                        type="date"
                        name="start_date"
                        className="form-input"
                        value={formData.start_date}
                        onChange={handleChange}
                        required
                        dir="ltr"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">שעת התחלה</label>
                      <input
                        type="time"
                        name="start_time"
                        className="form-input"
                        value={formData.start_time}
                        onChange={handleChange}
                        required
                        dir="ltr"
                      />
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">שעות</label>
                        <input
                          type="number"
                          name="duration_hours"
                          className="form-input"
                          value={formData.duration_hours}
                          onChange={handleChange}
                          min="0"
                          placeholder="0"
                          dir="ltr"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">דקות</label>
                        <input
                          type="number"
                          name="duration_minutes"
                          className="form-input"
                          value={formData.duration_minutes}
                          onChange={handleChange}
                          min="0"
                          max="59"
                          placeholder="0"
                          dir="ltr"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="time-range-container">
                    <div className="form-row time-row">
                      <div className="form-group date-group">
                        <label className="form-label">תאריך התחלה</label>
                        <input
                          type="date"
                          name="start_date"
                          className="form-input"
                          value={formData.start_date}
                          onChange={handleChange}
                          required
                          dir="ltr"
                        />
                      </div>
                      <div className="form-group time-group">
                        <label className="form-label">שעה</label>
                        <input
                          type="time"
                          name="start_time"
                          className="form-input"
                          value={formData.start_time}
                          onChange={handleChange}
                          required
                          dir="ltr"
                        />
                      </div>
                    </div>

                    <div className="form-row time-row">
                      <div className="form-group date-group">
                        <label className="form-label">תאריך סיום</label>
                        <input
                          type="date"
                          name="end_date"
                          className="form-input"
                          value={formData.end_date}
                          onChange={handleChange}
                          required
                          dir="ltr"
                        />
                      </div>
                      <div className="form-group time-group">
                        <label className="form-label">שעה</label>
                        <input
                          type="time"
                          name="end_time"
                          className="form-input"
                          value={formData.end_time}
                          onChange={handleChange}
                          required
                          dir="ltr"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Button to switch to intervals mode */}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm add-interval-btn"
                  onClick={handleAddInterval}
                  style={{ marginTop: '0.5rem' }}
                >
                  <Timer size={14} />
                  הוסף קטעי זמן (אינטרוולים)
                </button>
              </>
            )}

            <div className="form-group">
              <label className="form-label">הערות</label>
              <textarea
                name="notes"
                className="form-input"
                value={formData.notes}
                onChange={handleChange}
                rows={3}
                placeholder="מה עשית בזמן הזה..."
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'שומר...' : 'שמור'}
            </button>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              ביטול
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .manual-entry-notice {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: var(--radius-md);
          margin-bottom: 1rem;
          font-size: 0.9rem;
          color: #f59e0b;
        }
        .notice-icon {
          font-size: 1.1rem;
        }
        .form-row {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1rem;
        }
        .form-checkbox {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          font-size: 0.9rem;
          color: var(--text-secondary);
          margin-bottom: 1rem;
        }
        .form-checkbox input {
          width: 18px;
          height: 18px;
          cursor: pointer;
        }
        .time-range-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .time-row {
          grid-template-columns: 2fr 1fr;
        }

        /* Intervals Section - Main */
        .intervals-section-main {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          padding: 1rem;
          margin-bottom: 1rem;
        }

        .intervals-header-main {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .intervals-header-main svg {
          color: var(--primary);
        }

        .intervals-total-badge {
          margin-right: auto;
          background: var(--primary-light);
          color: var(--primary);
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.8rem;
          font-weight: 600;
        }

        .intervals-list-edit {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .interval-edit-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem;
          background: var(--bg-primary);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-color);
          transition: border-color 0.2s;
        }

        .interval-edit-item:hover {
          border-color: var(--primary-light);
        }

        .interval-edit-number {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          background: var(--primary-light);
          color: var(--primary);
          border-radius: 50%;
          font-size: 0.8rem;
          font-weight: 600;
          flex-shrink: 0;
        }

        .interval-edit-fields {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .interval-edit-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
        }

        .interval-edit-row label {
          width: 55px;
          color: var(--text-secondary);
          font-weight: 500;
          flex-shrink: 0;
        }

        .interval-date-input {
          width: 130px !important;
          padding: 0.4rem 0.5rem !important;
          font-size: 0.8rem !important;
        }

        .interval-time-input {
          width: 90px !important;
          padding: 0.4rem 0.5rem !important;
          font-size: 0.8rem !important;
        }

        .interval-edit-duration {
          font-weight: 600;
          color: var(--primary);
          font-size: 0.875rem;
          min-width: 70px;
          text-align: center;
          padding: 0.35rem 0.5rem;
          background: var(--bg-tertiary);
          border-radius: var(--radius-sm);
        }

        .interval-delete-btn {
          color: var(--error) !important;
          opacity: 0.6;
          transition: opacity 0.2s;
        }

        .interval-edit-item:hover .interval-delete-btn {
          opacity: 1;
        }

        .interval-delete-btn:hover {
          background: var(--error-light) !important;
        }

        .add-interval-btn {
          margin-top: 0.75rem;
          width: 100%;
          justify-content: center;
          border: 1px dashed var(--border-color);
          color: var(--text-secondary);
        }

        .add-interval-btn:hover {
          border-color: var(--primary);
          color: var(--primary);
          background: var(--primary-light);
        }

        /* Quick Suggestions Styles */
        .quick-suggestions {
          background: rgba(99, 102, 241, 0.06);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: var(--radius-md);
          padding: 0.75rem;
          margin-bottom: 1rem;
        }

        .quick-suggestions-header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--primary);
          margin-bottom: 0.5rem;
        }

        .quick-suggestions-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }

        .quick-suggestion-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.35rem 0.65rem;
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: 9999px;
          font-size: 0.78rem;
          color: var(--text-primary);
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
          max-width: 100%;
        }

        .quick-suggestion-chip:hover {
          border-color: var(--primary);
          background: var(--primary-light);
          color: var(--primary);
        }

        .quick-suggestion-chip svg {
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        .quick-suggestion-chip:hover svg {
          color: var(--primary);
        }

        .suggestion-name {
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .suggestion-badge {
          background: var(--primary);
          color: white;
          font-size: 0.65rem;
          padding: 0.1rem 0.4rem;
          border-radius: 9999px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .new-project-inline {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.5rem;
          align-items: center;
        }

        .new-project-inline .form-input {
          flex: 1;
        }

        .new-project-inline .btn {
          flex-shrink: 0;
        }

        /* Additional Associations Styles */
        .additional-associations-section {
          margin: 1rem 0;
          padding-top: 1rem;
          border-top: 1px dashed var(--border-color);
        }

        .add-association-toggle {
          width: 100%;
          justify-content: center;
          gap: 0.5rem;
          color: var(--text-secondary);
          border: 1px dashed var(--border-color);
          padding: 0.75rem;
        }

        .add-association-toggle:hover {
          color: var(--primary);
          border-color: var(--primary);
          background: var(--primary-light);
        }

        .associations-container {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          padding: 1rem;
        }

        .associations-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
          font-weight: 600;
          font-size: 0.875rem;
          color: var(--text-primary);
        }

        .associations-header svg {
          color: var(--primary);
        }

        .associations-header .btn {
          margin-right: auto;
        }

        .associations-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .association-item {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .association-select {
          flex: 1;
          font-size: 0.875rem !important;
          padding: 0.5rem !important;
        }

        .add-association-btn {
          margin-top: 0.75rem;
          width: 100%;
          justify-content: center;
          gap: 0.5rem;
          border: 1px dashed var(--border-color);
        }

        .add-association-btn:hover {
          border-color: var(--primary);
          color: var(--primary);
          background: var(--primary-light);
        }

        @media (max-width: 600px) {
          .interval-edit-item {
            flex-wrap: wrap;
            padding: 0.5rem;
          }
          .interval-edit-fields {
            width: 100%;
            order: 1;
            margin-top: 0.5rem;
          }
          .interval-edit-row {
            flex-wrap: wrap;
          }
          .interval-edit-row label {
            width: 100%;
            margin-bottom: 0.25rem;
          }
          .interval-date-input,
          .interval-time-input {
            flex: 1;
            min-width: 0;
          }
          .interval-edit-duration {
            margin-right: auto;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}

export default TimeEntryModal;
