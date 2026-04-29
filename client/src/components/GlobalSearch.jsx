import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, User, Folder, CheckSquare, Phone, Mail, Loader2, Bell, Plus, ChevronLeft, ListChecks } from 'lucide-react';
import { clientsAPI, projectsAPI, tasksAPI, remindersAPI } from '../services/api';
import ClientModal from './ClientModal';
import ProjectModal from './ProjectModal';
import TaskModal from './TaskModal';
import './GlobalSearch.css';

function GlobalSearch({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ clients: [], projects: [], tasks: [], reminders: [], subtasks: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [allData, setAllData] = useState({ clients: [], projects: [], tasks: [], reminders: [] });
  const [dataLoaded, setDataLoaded] = useState(false);
  const inputRef = useRef(null);
  const overlayRef = useRef(null);

  // Scope chain for drill-down search
  const [scopeChain, setScopeChain] = useState([]);
  const [subtasks, setSubtasks] = useState([]);

  // Derived scope values
  const currentScope = scopeChain.length > 0 ? scopeChain[scopeChain.length - 1] : null;
  const scopeLevel = currentScope?.type || null;
  const scopedClientId = scopeChain.find(s => s.type === 'client')?.id || null;
  const scopedProjectId = scopeChain.find(s => s.type === 'project')?.id || null;
  const scopedTaskId = scopeChain.find(s => s.type === 'task')?.id || null;
  const hasScope = scopeChain.length > 0;

  // Modal states for quick create
  const [showClientModal, setShowClientModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);

  // Load all data when search opens
  useEffect(() => {
    if (isOpen && !dataLoaded) {
      loadAllData();
    }
  }, [isOpen, dataLoaded]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Reset query and data when closed
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setScopeChain([]);
      setSubtasks([]);
      setResults({ clients: [], projects: [], tasks: [], reminders: [], subtasks: [] });
      setDataLoaded(false); // Force reload next time
    }
  }, [isOpen]);

  // Handle escape key - cascade: clear query -> pop scope -> close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        if (query) {
          setQuery('');
        } else if (scopeChain.length > 0) {
          setScopeChain(prev => prev.slice(0, -1));
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, query, scopeChain]);

  // Load subtasks when scoped to task level
  useEffect(() => {
    if (scopedTaskId) {
      tasksAPI.getOne(scopedTaskId).then(task => {
        setSubtasks(task.subtasks || []);
      }).catch(err => {
        console.error('Failed to load subtasks:', err);
        setSubtasks([]);
      });
    } else {
      setSubtasks([]);
    }
  }, [scopedTaskId]);

  // Handle click outside
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [clients, projects, tasks, reminders] = await Promise.all([
        clientsAPI.getAll(),
        projectsAPI.getAll(),
        tasksAPI.getAll(),
        remindersAPI.getAll({ include_read: 'true' })
      ]);
      setAllData({ clients, projects, tasks, reminders });
      setDataLoaded(true);
    } catch (error) {
      console.error('Failed to load search data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Dynamic placeholder based on scope level
  const getScopePlaceholder = () => {
    if (!currentScope) return 'חפש לקוחות, פרויקטים, משימות...';
    switch (currentScope.type) {
      case 'client': return 'חפש פרויקטים ומשימות של הלקוח...';
      case 'project': return 'חפש משימות בפרויקט...';
      case 'task': return 'חפש תת-משימות...';
      default: return 'חפש...';
    }
  };

  // Scope management handlers
  const handleDrillDown = (type, item) => {
    switch (type) {
      case 'client': {
        setScopeChain(prev => [...prev, { type: 'client', id: item.id, name: item.name }]);
        break;
      }
      case 'project': {
        if (!scopedClientId && item.client_id) {
          const clientEntry = allData.clients.find(c => c.id === item.client_id);
          const clientScope = { type: 'client', id: item.client_id, name: clientEntry?.name || item.client_name || 'לקוח' };
          setScopeChain(prev => [...prev, clientScope, { type: 'project', id: item.id, name: item.name }]);
        } else {
          setScopeChain(prev => [...prev, { type: 'project', id: item.id, name: item.name }]);
        }
        break;
      }
      case 'task': {
        const chain = [...scopeChain];
        if (!scopedClientId && item.client_id) {
          const clientEntry = allData.clients.find(c => c.id === item.client_id);
          chain.push({ type: 'client', id: item.client_id, name: clientEntry?.name || item.client_name || 'לקוח' });
        }
        if (!scopedProjectId && item.project_id) {
          const projectEntry = allData.projects.find(p => p.id === item.project_id);
          chain.push({ type: 'project', id: item.project_id, name: projectEntry?.name || item.project_name || 'פרויקט' });
        }
        chain.push({ type: 'task', id: item.id, name: item.name });
        setScopeChain(chain);
        break;
      }
      default:
        return;
    }
    setQuery('');
    inputRef.current?.focus();
  };

  const handleRemoveScope = (index) => {
    setScopeChain(prev => prev.slice(0, index));
    setQuery('');
    inputRef.current?.focus();
  };

  const handleClearAll = () => {
    setScopeChain([]);
    setQuery('');
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Backspace' && query === '' && scopeChain.length > 0) {
      e.preventDefault();
      setScopeChain(prev => prev.slice(0, -1));
    }
  };

  // Filter reminders by client scope
  const filterRemindersByClient = (reminders, clientId) => {
    return reminders.filter(r => {
      if (r.association_type === 'client' && (r.association_id === clientId || r.client_id === clientId)) return true;
      if (r.association_type === 'project' && (r.project_client_id === clientId || r.client_id === clientId)) return true;
      if (r.association_type === 'task' && (r.task_client_id === clientId || r.client_id === clientId)) return true;
      return false;
    });
  };

  // Filter reminders by project scope
  const filterRemindersByProject = (reminders, projectId) => {
    return reminders.filter(r => {
      if (r.association_type === 'project' && r.association_id === projectId) return true;
      if (r.association_type === 'task' && (r.task_project_id === projectId || r.project_id === projectId)) return true;
      return false;
    });
  };

  // Debounced search - scope-aware
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = query.toLowerCase().trim();

      let matchedClients = [];
      let matchedProjects = [];
      let matchedTasks = [];
      let matchedReminders = [];
      let matchedSubtasks = [];

      if (!scopeLevel) {
        // --- NO SCOPE: original global search behavior ---
        if (!q) {
          setResults({ clients: [], projects: [], tasks: [], reminders: [], subtasks: [] });
          return;
        }
        matchedClients = allData.clients.filter(client => {
          const name = (client.name || '').toLowerCase();
          const phone = (client.phone || '').toLowerCase();
          const email = (client.email || '').toLowerCase();
          const description = (client.description || '').toLowerCase();
          const aliasesMatch = Array.isArray(client.aliases) && client.aliases.some(alias =>
            (alias || '').toLowerCase().includes(q)
          );
          return name.includes(q) || phone.includes(q) || email.includes(q) || description.includes(q) || aliasesMatch;
        }).slice(0, 5);
        matchedProjects = allData.projects.filter(p => (p.name || '').toLowerCase().includes(q)).slice(0, 5);
        matchedTasks = allData.tasks.filter(t => (t.name || '').toLowerCase().includes(q)).slice(0, 5);
        matchedReminders = allData.reminders.filter(r => (r.content || '').toLowerCase().includes(q)).slice(0, 5);

      } else if (scopeLevel === 'client') {
        // --- SCOPED TO CLIENT: show client's projects, tasks, reminders ---
        const clientProjects = allData.projects.filter(p => p.client_id === scopedClientId);
        const clientTasks = allData.tasks.filter(t => t.client_id === scopedClientId);
        const clientReminders = filterRemindersByClient(allData.reminders, scopedClientId);

        if (!q) {
          matchedProjects = clientProjects.slice(0, 10);
          matchedTasks = clientTasks.slice(0, 10);
          matchedReminders = clientReminders.slice(0, 5);
        } else {
          matchedProjects = clientProjects.filter(p => (p.name || '').toLowerCase().includes(q)).slice(0, 5);
          matchedTasks = clientTasks.filter(t => (t.name || '').toLowerCase().includes(q)).slice(0, 5);
          matchedReminders = clientReminders.filter(r => (r.content || '').toLowerCase().includes(q)).slice(0, 5);
        }

      } else if (scopeLevel === 'project') {
        // --- SCOPED TO PROJECT: show project's tasks, reminders ---
        const projectTasks = allData.tasks.filter(t => t.project_id === scopedProjectId);
        const projectReminders = filterRemindersByProject(allData.reminders, scopedProjectId);

        if (!q) {
          matchedTasks = projectTasks.slice(0, 10);
          matchedReminders = projectReminders.slice(0, 5);
        } else {
          matchedTasks = projectTasks.filter(t => (t.name || '').toLowerCase().includes(q)).slice(0, 5);
          matchedReminders = projectReminders.filter(r => (r.content || '').toLowerCase().includes(q)).slice(0, 5);
        }

      } else if (scopeLevel === 'task') {
        // --- SCOPED TO TASK: show subtasks ---
        if (!q) {
          matchedSubtasks = subtasks.slice(0, 15);
        } else {
          matchedSubtasks = subtasks.filter(s => (s.title || '').toLowerCase().includes(q)).slice(0, 10);
        }
      }

      setResults({
        clients: matchedClients,
        projects: matchedProjects,
        tasks: matchedTasks,
        reminders: matchedReminders,
        subtasks: matchedSubtasks
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [query, allData, scopeChain, subtasks]);

  const handleResultClick = (type, item) => {
    onClose();

    switch (type) {
      case 'client':
        navigate(`/clients/${item.id}`);
        break;
      case 'project':
        navigate(`/projects/${item.id}`);
        break;
      case 'task':
        navigate(`/tasks/${item.id}`);
        break;
      case 'reminder':
        navigate('/reminders');
        break;
      case 'subtask':
        if (scopedTaskId) {
          navigate(`/tasks/${scopedTaskId}`);
        }
        break;
    }
  };

  // Quick create handlers
  const handleClientSave = async (clientData) => {
    try {
      const newClient = await clientsAPI.create(clientData);
      setShowClientModal(false);
      onClose();
      navigate(`/clients/${newClient.id}`);
    } catch (error) {
      console.error('Failed to create client:', error);
    }
  };

  const handleProjectSave = async (projectData) => {
    try {
      const newProject = await projectsAPI.create(projectData);
      setShowProjectModal(false);
      onClose();
      navigate(`/projects/${newProject.id}`);
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const handleTaskSave = async (taskData) => {
    try {
      const newTask = await tasksAPI.create(taskData);
      setShowTaskModal(false);
      onClose();
      navigate(`/tasks/${newTask.id}`);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  const totalResults = results.clients.length + results.projects.length + results.tasks.length + results.reminders.length + results.subtasks.length;
  const hasQuery = query.trim().length > 0;

  if (!isOpen) return null;

  return (
    <div className="global-search-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="global-search-container">
        <div className="global-search-header">
          <div className="global-search-input-wrapper">
            <Search size={20} className="search-icon" />
            <div className="search-scope-area">
              {scopeChain.map((scope, index) => (
                <span
                  key={`${scope.type}-${scope.id}`}
                  className={`scope-tag scope-tag-${scope.type}`}
                >
                  <span className="scope-tag-label">{scope.name}</span>
                  <button
                    className="scope-tag-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveScope(index);
                    }}
                    title="הסר סינון"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {scopeChain.length > 0 && (
                <span className="scope-separator">{'>'}</span>
              )}
              <input
                ref={inputRef}
                type="text"
                className="global-search-input"
                placeholder={getScopePlaceholder()}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                autoComplete="off"
              />
            </div>
            {(query || hasScope) && (
              <button className="search-clear-btn" onClick={handleClearAll}>
                <X size={18} />
              </button>
            )}
          </div>
          <button className="global-search-close" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div className="global-search-results">
          {isLoading ? (
            <div className="search-loading">
              <Loader2 size={24} className="spinner" />
              <span>טוען נתונים...</span>
            </div>
          ) : (hasQuery || hasScope) && totalResults === 0 ? (
            <div className="search-no-results">
              <Search size={40} />
              <p>לא נמצאו תוצאות {hasQuery ? `עבור "${query}"` : ''}</p>
            </div>
          ) : (
            <>
              {/* Clients Results */}
              {results.clients.length > 0 && (
                <div className="search-results-section">
                  <h3 className="search-results-title">
                    <User size={16} />
                    לקוחות
                  </h3>
                  <ul className="search-results-list">
                    {results.clients.map(client => (
                      <li key={client.id} className="search-result-row">
                        <button
                          className="search-result-item"
                          onClick={() => handleResultClick('client', client)}
                        >
                          <div className="result-icon client-icon">
                            <User size={18} />
                          </div>
                          <div className="result-content">
                            <span className="result-title">{client.name}</span>
                            <div className="result-meta">
                              {client.phone && (
                                <span className="result-meta-item">
                                  <Phone size={12} />
                                  {client.phone}
                                </span>
                              )}
                              {client.email && (
                                <span className="result-meta-item">
                                  <Mail size={12} />
                                  {client.email}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        <button
                          className="drill-down-btn"
                          onClick={(e) => { e.stopPropagation(); handleDrillDown('client', client); }}
                          title={`חפש בתוך ${client.name}`}
                        >
                          <ChevronLeft size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Projects Results */}
              {results.projects.length > 0 && (
                <div className="search-results-section">
                  <h3 className="search-results-title">
                    <Folder size={16} />
                    פרויקטים
                  </h3>
                  <ul className="search-results-list">
                    {results.projects.map(project => (
                      <li key={project.id} className="search-result-row">
                        <button
                          className="search-result-item"
                          onClick={() => handleResultClick('project', project)}
                        >
                          <div className="result-icon project-icon">
                            <Folder size={18} />
                          </div>
                          <div className="result-content">
                            <span className="result-title">{project.name}</span>
                            {project.client_name && (
                              <span className="result-subtitle">{project.client_name}</span>
                            )}
                          </div>
                        </button>
                        <button
                          className="drill-down-btn"
                          onClick={(e) => { e.stopPropagation(); handleDrillDown('project', project); }}
                          title={`חפש בתוך ${project.name}`}
                        >
                          <ChevronLeft size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tasks Results */}
              {results.tasks.length > 0 && (
                <div className="search-results-section">
                  <h3 className="search-results-title">
                    <CheckSquare size={16} />
                    משימות
                  </h3>
                  <ul className="search-results-list">
                    {results.tasks.map(task => (
                      <li key={task.id} className="search-result-row">
                        <button
                          className="search-result-item"
                          onClick={() => handleResultClick('task', task)}
                        >
                          <div className="result-icon task-icon">
                            <CheckSquare size={18} />
                          </div>
                          <div className="result-content">
                            <span className="result-title">{task.name}</span>
                            {task.project_name && (
                              <span className="result-subtitle">{task.project_name}</span>
                            )}
                          </div>
                        </button>
                        <button
                          className="drill-down-btn"
                          onClick={(e) => { e.stopPropagation(); handleDrillDown('task', task); }}
                          title={`חפש בתוך ${task.name}`}
                        >
                          <ChevronLeft size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Subtasks Results */}
              {results.subtasks.length > 0 && (
                <div className="search-results-section">
                  <h3 className="search-results-title">
                    <ListChecks size={16} />
                    תת-משימות
                  </h3>
                  <ul className="search-results-list">
                    {results.subtasks.map(subtask => (
                      <li key={subtask.id}>
                        <button
                          className="search-result-item"
                          onClick={() => handleResultClick('subtask', subtask)}
                        >
                          <div className="result-icon subtask-icon">
                            <ListChecks size={18} />
                          </div>
                          <div className="result-content">
                            <span className="result-title">{subtask.title}</span>
                            {subtask.due_date && (
                              <span className="result-subtitle">
                                {new Date(subtask.due_date).toLocaleDateString('he-IL')}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Reminders Results */}
              {results.reminders.length > 0 && (
                <div className="search-results-section">
                  <h3 className="search-results-title">
                    <Bell size={16} />
                    תזכורות
                  </h3>
                  <ul className="search-results-list">
                    {results.reminders.map(reminder => (
                      <li key={reminder.id}>
                        <button
                          className="search-result-item"
                          onClick={() => handleResultClick('reminder', reminder)}
                        >
                          <div className="result-icon reminder-icon">
                            <Bell size={18} />
                          </div>
                          <div className="result-content">
                            <span className="result-title">{reminder.content}</span>
                            {(reminder.client_name || reminder.project_name || reminder.task_name) && (
                              <span className="result-subtitle">
                                {reminder.client_name || reminder.project_name || reminder.task_name}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Empty state when no query and no scope - show recent clients */}
              {!hasQuery && !hasScope && (
                <div className="search-suggestions">
                  {allData.clients.slice(0, 3).map(client => (
                    <button
                      key={client.id}
                      className="suggestion-item"
                      onClick={() => handleResultClick('client', client)}
                    >
                      <User size={14} />
                      <span>{client.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="global-search-footer">
          {hasQuery ? (
            <div className="quick-create-buttons">
              <button
                className="quick-create-btn client-btn"
                onClick={() => setShowClientModal(true)}
                title="הקמת לקוח חדש"
              >
                <User size={14} />
                <span>לקוח</span>
              </button>
              <button
                className="quick-create-btn project-btn"
                onClick={() => setShowProjectModal(true)}
                title="הקמת פרויקט חדש"
              >
                <Folder size={14} />
                <span>פרויקט</span>
              </button>
              <button
                className="quick-create-btn task-btn"
                onClick={() => setShowTaskModal(true)}
                title="הקמת משימה חדשה"
              >
                <CheckSquare size={14} />
                <span>משימה</span>
              </button>
            </div>
          ) : (
            <div></div>
          )}
          <span className="search-shortcut">
            {hasScope && <><kbd>Backspace</kbd> חזרה &nbsp;</>}
            <kbd>ESC</kbd> לסגירה
          </span>
        </div>
      </div>

      {/* Quick Create Modals */}
      {showClientModal && (
        <ClientModal
          client={null}
          onSave={handleClientSave}
          onClose={() => setShowClientModal(false)}
        />
      )}

      {showProjectModal && (
        <ProjectModal
          project={null}
          onSave={handleProjectSave}
          onClose={() => setShowProjectModal(false)}
        />
      )}

      {showTaskModal && (
        <TaskModal
          task={null}
          onSave={handleTaskSave}
          onClose={() => setShowTaskModal(false)}
        />
      )}
    </div>
  );
}

export default GlobalSearch;
