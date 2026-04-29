import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown, ChevronUp, Check } from 'lucide-react';
import useStore from '../store/useStore';
import { clientsAPI, projectsAPI, tasksAPI, leadsAPI } from '../services/api';
import useBodyScrollLock from '../hooks/useBodyScrollLock';

const EMPTY_ASSOCIATION = {};

const RemindersModal = ({ isOpen, onClose, reminder, initialAssociation }) => {
  const stableInitialAssociation = useMemo(() => initialAssociation || EMPTY_ASSOCIATION, [initialAssociation?.type, initialAssociation?.id]);
  const prevIsOpenRef = useRef(false);
  useBodyScrollLock(isOpen);
  const { addReminder, updateReminder } = useStore();
  const [formData, setFormData] = useState({
    content: '',
    notes: '',
    due_date: new Date().toISOString().slice(0, 16),
    association_type: 'general',
    association_id: '',
    is_recurring: false,
    recurrence_interval: 'weekly'
  });

  const [clients, setClients] = useState([]);
  const [leads, setLeads] = useState([]);
  const [allProjects, setAllProjects] = useState([]); // All projects for multi-select
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedProjectIds, setSelectedProjectIds] = useState([]); // Multi-select project IDs
  const [loadingItems, setLoadingItems] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isProjectsDropdownOpen, setIsProjectsDropdownOpen] = useState(false);
  const projectsDropdownRef = useRef(null);

  // Load clients, leads, and all projects on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [clientsList, projectsList] = await Promise.all([
          clientsAPI.getAll(),
          projectsAPI.getAll() // Gets all projects with client_name included
        ]);
        setClients(clientsList);
        setAllProjects(projectsList);
        // Load leads (ignore errors if addon not enabled)
        try {
          const leadsList = await leadsAPI.getAll();
          setLeads(leadsList);
        } catch (e) { /* leads addon may not be enabled */ }
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };
    loadData();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (projectsDropdownRef.current && !projectsDropdownRef.current.contains(event.target)) {
        setIsProjectsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown when client changes
  useEffect(() => {
    setIsProjectsDropdownOpen(false);
  }, [selectedClient]);

  useEffect(() => {
    const justOpened = isOpen && !prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    // Only run initialization logic when modal just opened or reminder/initialAssociation changes while open
    if (!isOpen) return;

    if (reminder) {
      setFormData({
        content: reminder.content,
        notes: reminder.notes || '',
        due_date: new Date(reminder.due_date).toISOString().slice(0, 16),
        association_type: reminder.association_type || 'general',
        association_id: reminder.association_id || '',
        is_recurring: !!reminder.is_recurring,
        recurrence_interval: reminder.recurrence_interval || 'weekly'
      });

      // Load project associations if they exist
      if (reminder.project_associations && reminder.project_associations.length > 0) {
        setSelectedProjectIds(reminder.project_associations.map(a => a.project_id));
      } else {
        setSelectedProjectIds([]);
      }

      // If editing, set the hierarchy based on association
      if (reminder.association_type === 'project' || reminder.association_type === 'task') {
        // Load the client for this project/task
        setSelectedClient(reminder.client_id);
        if (reminder.client_id) {
          loadProjectsForClient(reminder.client_id);
        }
      }
      if (reminder.association_type === 'task') {
        setSelectedProject(reminder.project_id);
        if (reminder.project_id) {
          loadTasksForProject(reminder.project_id);
        }
      }
    } else if (stableInitialAssociation.type) {
      setFormData(prev => ({
        ...prev,
        association_type: stableInitialAssociation.type,
        association_id: stableInitialAssociation.id
      }));
      setSelectedProjectIds([]);

      // Set hierarchy based on initial association
      if (stableInitialAssociation.clientId) {
        setSelectedClient(stableInitialAssociation.clientId);
        loadProjectsForClient(stableInitialAssociation.clientId);
      }
      if (stableInitialAssociation.projectId) {
        setSelectedProject(stableInitialAssociation.projectId);
        loadTasksForProject(stableInitialAssociation.projectId);
      }
    } else if (justOpened) {
        // Reset form only when modal just opened (not on every render)
        setFormData({
            content: '',
            notes: '',
            due_date: new Date().toISOString().slice(0, 16),
            association_type: 'general',
            association_id: '',
            is_recurring: false,
            recurrence_interval: 'weekly'
        });
        setSelectedClient('');
        setSelectedProject('');
        setSelectedProjectIds([]);
    }
  }, [reminder, stableInitialAssociation, isOpen]);

  const loadProjectsForClient = async (clientId) => {
    if (!clientId) {
      setProjects([]);
      setTasks([]);
      setSelectedProject('');
      return;
    }

    setLoadingItems(true);
    try {
      const projectsList = await projectsAPI.getAll(clientId);
      setProjects(projectsList);
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const loadTasksForProject = async (projectId) => {
    if (!projectId) {
      setTasks([]);
      return;
    }

    setLoadingItems(true);
    try {
      const tasksList = await tasksAPI.getAll(projectId);
      setTasks(tasksList);
    } catch (error) {
      console.error('Error loading tasks:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const handleClientChange = (clientId) => {
    setSelectedClient(clientId);
    setSelectedProject('');
    setProjects([]);
    setTasks([]);
    // Clear selected project IDs when client changes
    setSelectedProjectIds([]);
    setIsProjectsDropdownOpen(false);

    if (clientId) {
      loadProjectsForClient(clientId);
      setFormData({...formData, association_type: 'client', association_id: clientId});
    } else {
      setFormData({...formData, association_type: 'general', association_id: ''});
    }
  };

  const handleProjectChange = (projectId) => {
    setSelectedProject(projectId);
    setTasks([]);

    if (projectId) {
      loadTasksForProject(projectId);
      setFormData({...formData, association_type: 'project', association_id: projectId});
    } else if (selectedClient) {
      setFormData({...formData, association_type: 'client', association_id: selectedClient});
    }
  };

  const handleTaskChange = (taskId) => {
    if (taskId) {
      setFormData({...formData, association_type: 'task', association_id: taskId});
    } else if (selectedProject) {
      setFormData({...formData, association_type: 'project', association_id: selectedProject});
    }
  };

  const handleProjectToggle = (projectId) => {
    setSelectedProjectIds(prev => {
      if (prev.includes(projectId)) {
        return prev.filter(id => id !== projectId);
      } else {
        return [...prev, projectId];
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Clean up the data before sending
      const dataToSend = {
        ...formData,
        // If association_id is empty string, set it to null
        association_id: formData.association_id || null,
        // Include project associations
        project_ids: selectedProjectIds
      };

      if (reminder) {
        await updateReminder(reminder.id, dataToSend);
      } else {
        await addReminder(dataToSend);
      }
      onClose();
    } catch (error) {
      console.error('Error saving reminder:', error);
      alert('שגיאה בשמירת התזכורת: ' + (error.message || 'שגיאה לא ידועה'));
    } finally {
        setLoading(false);
    }
  };

  // Filter projects by selected client and group by client for display
  const projectsByClient = useMemo(() => {
    const filteredProjects = selectedClient 
      ? allProjects.filter(project => project.client_id === selectedClient)
      : [];
    
    const grouped = {};
    filteredProjects.forEach(project => {
      const clientName = project.client_name || 'ללא לקוח';
      if (!grouped[clientName]) {
        grouped[clientName] = [];
      }
      grouped[clientName].push(project);
    });
    return grouped;
  }, [allProjects, selectedClient]);

  const getSelectedProjectsText = () => {
    if (!selectedClient) return 'בחר לקוח תחילה...';
    if (selectedProjectIds.length === 0) return 'בחר פרויקטים...';
    if (selectedProjectIds.length === 1) {
      const project = allProjects.find(p => p.id === selectedProjectIds[0]);
      return project ? project.name : 'פרויקט אחד נבחר';
    }
    return `${selectedProjectIds.length} פרויקטים נבחרו`;
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
            <h3 className="modal-title">{reminder ? 'עריכת תזכורת' : 'תזכורת חדשה'}</h3>
            <button onClick={onClose} className="btn btn-ghost btn-icon">
                <X size={20} />
            </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
                <label className="form-label">תאריך ושעה</label>
                <input
                className="form-input"
                type="datetime-local"
                required
                value={formData.due_date}
                onChange={e => setFormData({...formData, due_date: e.target.value})}
                />
            </div>

            <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                <input
                    type="checkbox"
                    id="is_recurring"
                    checked={formData.is_recurring}
                    onChange={e => setFormData({...formData, is_recurring: e.target.checked})}
                    style={{ width: 'auto' }}
                />
                <label htmlFor="is_recurring" className="form-label" style={{ marginBottom: 0, cursor: 'pointer' }}>תזכורת חוזרת</label>
            </div>

            {formData.is_recurring && (
                <div className="form-group">
                <label className="form-label">תדירות חזרה</label>
                <select
                    className="form-input"
                    value={formData.recurrence_interval}
                    onChange={e => setFormData({...formData, recurrence_interval: e.target.value})}
                >
                    <option value="daily">יומי</option>
                    <option value="weekly">שבועי</option>
                    <option value="monthly">חודשי</option>
                    <option value="yearly">שנתי</option>
                </select>
                </div>
            )}

            <div className="form-group">
                <label className="form-label">תוכן התזכורת</label>
                <textarea
                className="form-input"
                required
                value={formData.content}
                onChange={e => setFormData({...formData, content: e.target.value})}
                placeholder="מה צריך לזכור?"
                rows={3}
                />
            </div>

            <div className="form-group">
                <label className="form-label">הערות</label>
                <textarea
                className="form-input"
                value={formData.notes}
                onChange={e => setFormData({...formData, notes: e.target.value})}
                placeholder="הערות נוספות..."
                rows={2}
                />
            </div>

            {/* Lead association */}
            {leads.length > 0 && formData.association_type !== 'client' && formData.association_type !== 'project' && formData.association_type !== 'task' && (
              <div className="form-group">
                <label className="form-label">שיוך לליד (אופציונלי)</label>
                <select
                  className="form-input"
                  value={formData.association_type === 'lead' ? formData.association_id : ''}
                  onChange={e => {
                    if (e.target.value) {
                      setFormData({...formData, association_type: 'lead', association_id: e.target.value});
                      setSelectedClient('');
                    } else {
                      setFormData({...formData, association_type: 'general', association_id: ''});
                    }
                  }}
                  disabled={stableInitialAssociation.type === 'lead'}
                >
                  <option value="">ללא שיוך לליד</option>
                  {leads.map(lead => (
                    <option key={lead.id} value={lead.id}>{lead.name}{lead.company ? ` (${lead.company})` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
                <label className="form-label">לקוח (אופציונלי)</label>
                <select
                className="form-input"
                value={selectedClient}
                onChange={e => handleClientChange(e.target.value)}
                disabled={stableInitialAssociation.type === 'project' || stableInitialAssociation.type === 'task' || stableInitialAssociation.type === 'lead' || formData.association_type === 'lead'}
                >
                <option value="">ללא שיוך ללקוח</option>
                {clients.map(client => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                ))}
                </select>
            </div>

            {/* Multi-select Projects */}
            <div className="form-group">
              <label className="form-label">פרויקטים (אופציונלי)</label>
              <div className="multi-select-dropdown" ref={projectsDropdownRef}>
                <button
                  type="button"
                  className="form-input multi-select-trigger"
                  onClick={() => selectedClient && setIsProjectsDropdownOpen(!isProjectsDropdownOpen)}
                  disabled={!selectedClient}
                >
                  <span className="multi-select-text">{getSelectedProjectsText()}</span>
                  {isProjectsDropdownOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {isProjectsDropdownOpen && selectedClient && (
                  <div className="multi-select-options">
                    {Object.entries(projectsByClient).map(([clientName, clientProjects]) => (
                      <div key={clientName} className="multi-select-group">
                        <div className="multi-select-group-header">{clientName}</div>
                        {clientProjects.map(project => (
                          <label
                            key={project.id}
                            className={`multi-select-option ${selectedProjectIds.includes(project.id) ? 'selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedProjectIds.includes(project.id)}
                              onChange={() => handleProjectToggle(project.id)}
                            />
                            <span className="checkmark">
                              {selectedProjectIds.includes(project.id) && <Check size={14} />}
                            </span>
                            <span className="option-label">{project.name}</span>
                          </label>
                        ))}
                      </div>
                    ))}
                    {Object.keys(projectsByClient).length === 0 && (
                      <div className="multi-select-empty">אין פרויקטים זמינים ללקוח זה</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Selected projects tags */}
            {selectedProjectIds.length > 0 && (
              <div className="selected-projects-tags">
                {selectedProjectIds.map(projectId => {
                  const project = allProjects.find(p => p.id === projectId);
                  if (!project) return null;
                  return (
                    <span key={projectId} className="project-tag">
                      {project.name}
                      <button
                        type="button"
                        className="tag-remove"
                        onClick={() => handleProjectToggle(projectId)}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {selectedClient && (
                <div className="form-group">
                <label className="form-label">פרויקט ראשי (אופציונלי)</label>
                <select
                    className="form-input"
                    value={selectedProject}
                    onChange={e => handleProjectChange(e.target.value)}
                    disabled={loadingItems || stableInitialAssociation.type === 'task'}
                >
                    <option value="">ללא שיוך לפרויקט ראשי</option>
                    {projects.map(project => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                </select>
                </div>
            )}

            {selectedProject && (
                <div className="form-group">
                <label className="form-label">משימה (אופציונלי)</label>
                <select
                    className="form-input"
                    value={formData.association_type === 'task' ? formData.association_id : ''}
                    onChange={e => handleTaskChange(e.target.value)}
                    disabled={loadingItems || stableInitialAssociation.type === 'task'}
                >
                    <option value="">ללא שיוך למשימה</option>
                    {tasks.map(task => (
                    <option key={task.id} value={task.id}>{task.name}</option>
                    ))}
                </select>
                </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'שומר...' : 'שמור'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default RemindersModal;
