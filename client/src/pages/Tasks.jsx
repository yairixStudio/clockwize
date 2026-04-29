import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, CheckSquare, Clock, Circle, CircleCheck, Folder, Users, Link as LinkIcon, Copy } from 'lucide-react';
import { tasksAPI, projectsAPI, clientsAPI } from '../services/api';
import { useModal } from '../components/Modal';
import { formatDurationHuman, formatDate } from '../utils/format';
import './Tasks.css';

function Tasks() {
    const modal = useModal();
    const [tasks, setTasks] = useState([]);
    const [projects, setProjects] = useState([]);
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'pending', 'completed'

    const loadData = async () => {
        try {
            const [tasksData, projectsData, clientsData] = await Promise.all([
                tasksAPI.getAll(),
                projectsAPI.getAll(),
                clientsAPI.getAll()
            ]);
            setTasks(tasksData);
            setProjects(projectsData);
            setClients(clientsData);
        } catch (error) {
            console.error('Failed to load tasks:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

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

    const getProjectForTask = (taskProjectId) => {
        return projects.find(p => p.id === taskProjectId);
    };

    const getClientForProject = (project) => {
        if (!project) return null;
        return clients.find(c => c.id === project.client_id);
    };

    const filteredTasks = tasks
        .filter(task => {
            // Filter by status
            if (filterStatus === 'pending' && task.status === 'completed') return false;
            if (filterStatus === 'completed' && task.status !== 'completed') return false;
            
            // Filter by search term
            if (!searchTerm) return true;
            const project = getProjectForTask(task.project_id);
            const client = getClientForProject(project);
            const searchLower = searchTerm.toLowerCase();
            
            return (
                task.name.toLowerCase().includes(searchLower) ||
                project?.name?.toLowerCase().includes(searchLower) ||
                client?.name?.toLowerCase().includes(searchLower)
            );
        })
        .sort((a, b) => {
            // Sort: pending first, then by due date, then by creation date
            if (a.status !== b.status) {
                return a.status === 'completed' ? 1 : -1;
            }
            if (a.due_date && b.due_date) {
                return new Date(a.due_date) - new Date(b.due_date);
            }
            if (a.due_date) return -1;
            if (b.due_date) return 1;
            return new Date(b.created_at) - new Date(a.created_at);
        });

    const pendingCount = tasks.filter(t => t.status !== 'completed').length;
    const completedCount = tasks.filter(t => t.status === 'completed').length;

    // Export tasks as message
    const handleExportTasksAsMessage = async () => {
        const tasksToExport = filteredTasks;
        if (tasksToExport.length === 0) {
            modal.error('אין משימות לייצוא');
            return;
        }

        const includeSubtasks = await modal.confirm('לייצא כולל תתי-משימות?', {
            title: 'ייצוא משימות',
            confirmText: 'כולל תתי-משימות',
            cancelText: 'משימות בלבד'
        });

        let exportData = tasksToExport;
        if (includeSubtasks) {
            try {
                const allWithSubtasks = await tasksAPI.getAll(null, { includeSubtasks: true });
                const filteredIds = new Set(tasksToExport.map(t => t.id));
                exportData = allWithSubtasks.filter(t => filteredIds.has(t.id));
            } catch (err) {
                modal.error('שגיאה בטעינת תתי-המשימות');
                return;
            }
        }

        const lines = [];
        exportData.forEach(task => {
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

    if (loading) {
        return <div className="loading"><div className="spinner"></div></div>;
    }

    return (
        <div className="page fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">משימות</h1>
                    <p className="page-subtitle">
                        {pendingCount} פתוחות · {completedCount} הושלמו
                    </p>
                </div>
            </div>

            <div className="tasks-toolbar">
                <div className="search-box">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        className="form-input search-input"
                        placeholder="חיפוש משימות..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="filter-buttons">
                    <button 
                        className={`btn btn-sm ${filterStatus === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setFilterStatus('all')}
                    >
                        הכל ({tasks.length})
                    </button>
                    <button 
                        className={`btn btn-sm ${filterStatus === 'pending' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setFilterStatus('pending')}
                    >
                        פתוחות ({pendingCount})
                    </button>
                    <button 
                        className={`btn btn-sm ${filterStatus === 'completed' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setFilterStatus('completed')}
                    >
                        הושלמו ({completedCount})
                    </button>
                </div>
            </div>

            {filteredTasks.length === 0 ? (
                <div className="empty-state card">
                    <div className="empty-state-icon">
                        <CheckSquare size={48} strokeWidth={1.5} />
                    </div>
                    <h3 className="empty-state-title">
                        {searchTerm || filterStatus !== 'all' ? 'לא נמצאו תוצאות' : 'עדיין אין משימות'}
                    </h3>
                    <p>
                        {searchTerm ? 'נסה לחפש משהו אחר' : 'צור משימות מתוך דף פרויקט'}
                    </p>
                </div>
            ) : (
                <div className="items-list">
                    {/* Export Tasks Button */}
                    <button
                        onClick={handleExportTasksAsMessage}
                        className="list-item export-tasks-list-item"
                        style={{ backgroundColor: 'var(--bg-secondary)', borderStyle: 'dashed' }}
                    >
                        <Copy size={18} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
                        <span style={{ fontWeight: 500 }}>יצוא כהודעה</span>
                    </button>
                    {filteredTasks.map(task => {
                        const project = getProjectForTask(task.project_id);
                        const client = getClientForProject(project);
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
                                        {client && (
                                            <>
                                                <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                                                <Link to={`/clients/${client.id}`} className="clickable-name">
                                                    <Users size={14} />
                                                    <span>{client.name}</span>
                                                </Link>
                                            </>
                                        )}
                                        {project && (
                                            <>
                                                <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                                                <Folder size={14} />
                                                <Link to={`/projects/${project.id}`} className="clickable-name">
                                                    {project.name}
                                                </Link>
                                            </>
                                        )}
                                        <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                                        <span>{formatDurationHuman(task.total_time || 0)}</span>
                                        {task.due_date && (
                                            <>
                                                <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                                                <span className="task-due-date">
                                                    <Clock size={14} />
                                                    <span>{new Date(task.due_date).toLocaleDateString('he-IL')}</span>
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="list-actions">
                                    <Link to={`/tasks/${task.id}`} className="btn-icon-tiny" title="פתח">
                                        <LinkIcon size={16} />
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default Tasks;
