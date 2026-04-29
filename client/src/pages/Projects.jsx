import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Plus, Search, Edit2, Trash2, Play, Pause, Square, Folder } from 'lucide-react';
import { projectsAPI } from '../services/api';
import useStore from '../store/useStore';
import { formatDurationHuman, formatDate } from '../utils/format';
import { getProjectStatus } from '../utils/status';
import { useModal } from '../components/Modal';
import ProjectModal from '../components/ProjectModal';
import TimerConflictModal from '../components/TimerConflictModal';
import './Projects.css';

function Projects() {
    const { activeTimers, startTimer, pauseTimer, resumeTimer, stopTimer, getTimerForProject } = useStore();
    const modal = useModal();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingProject, setEditingProject] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Timer conflict modal state
    const [showConflictModal, setShowConflictModal] = useState(false);
    const [pendingTimerStart, setPendingTimerStart] = useState(null);

    // Stop timer modal state
    const [showStopModal, setShowStopModal] = useState(false);
    const [stopNotes, setStopNotes] = useState('');
    const [stoppingTimer, setStoppingTimer] = useState(null);

    const loadProjects = async () => {
        try {
            const data = await projectsAPI.getAll();
            setProjects(data);
        } catch (error) {
            console.error('Failed to load projects:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadProjects();
    }, []);

    const handleSave = async (projectData) => {
        try {
            if (editingProject) {
                await projectsAPI.update(editingProject.id, projectData);
            } else {
                await projectsAPI.create(projectData);
            }
            loadProjects();
            setShowModal(false);
            setEditingProject(null);
            modal.success(editingProject ? 'הפרויקט עודכן בהצלחה' : 'הפרויקט נוצר בהצלחה');
        } catch (error) {
            modal.error(error.message);
        }
    };

    const handleDelete = async (id) => {
        const confirmed = await modal.confirm(
            'האם אתה בטוח שברצונך למחוק את הפרויקט? פעולה זו תמחק גם את כל המשימות שלו.',
            { title: 'מחיקת פרויקט', confirmText: 'מחק', type: 'error' }
        );

        if (confirmed) {
            try {
                await projectsAPI.delete(id);
                // Update state immediately for instant UI feedback
                setProjects(prev => prev.filter(p => p.id !== id));
                // Reload data in background to ensure consistency
                loadProjects();
                modal.success('הפרויקט נמחק בהצלחה');
            } catch (error) {
                modal.error(error.message);
                // Reload data on error to restore correct state
                loadProjects();
            }
        }
    };

    // Timer button click handler
    const handleTimerButtonClick = async (e, project) => {
        e.preventDefault();
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

    const handleStopTimerClick = (e, timer, projectName) => {
        e.preventDefault();
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
            loadProjects();
        } catch (error) {
            modal.error('שגיאה בשמירת הזמן');
        }
    };

    // Get timer button state for a project
    const getProjectTimerButton = (projectId) => {
        const projectTimer = getTimerForProject(projectId, null);

        if (projectTimer) {
            return {
                icon: projectTimer.is_running ? <Pause size={16} /> : <Play size={16} />,
                className: projectTimer.is_running ? 'btn-warning' : 'btn-success',
                title: projectTimer.is_running ? 'השהה טיימר' : 'המשך טיימר'
            };
        }

        return {
            icon: <Play size={16} />,
            className: 'btn-ghost',
            title: 'התחל טיימר'
        };
    };

    const openEditModal = (project) => {
        setEditingProject(project);
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setEditingProject(null);
    };

    const filteredProjects = projects.filter(project =>
        project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        project.client_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) {
        return <div className="loading"><div className="spinner"></div></div>;
    }

    return (
        <div className="page fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">פרויקטים</h1>
                    <p className="page-subtitle">ניהול הפרויקטים שלך</p>
                </div>
                <button onClick={() => setShowModal(true)} className="btn btn-primary">
                    <Plus size={18} />
                    <span>פרויקט חדש</span>
                </button>
            </div>

            <div className="projects-toolbar">
                <div className="search-box">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        className="form-input search-input"
                        placeholder="חיפוש פרויקטים..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {filteredProjects.length === 0 ? (
                <div className="empty-state card">
                    <div className="empty-state-icon">
                        <Folder size={48} strokeWidth={1.5} />
                    </div>
                    <h3 className="empty-state-title">
                        {searchTerm ? 'לא נמצאו תוצאות' : 'עדיין אין פרויקטים'}
                    </h3>
                    <p>
                        {searchTerm ? 'נסה לחפש משהו אחר' : 'הוסף את הפרויקט הראשון שלך כדי להתחיל'}
                    </p>
                    {!searchTerm && (
                        <button onClick={() => setShowModal(true)} className="btn btn-primary mt-4">
                            <Plus size={18} />
                            <span>הוסף פרויקט ראשון</span>
                        </button>
                    )}
                </div>
            ) : (
                <div className="items-list">
                    {/* New Project Button - List Style */}
                    <button
                        onClick={() => setShowModal(true)}
                        className="list-item new-project-list-item"
                    >
                        <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
                        <span style={{ fontWeight: 500 }}>צור פרויקט חדש</span>
                    </button>

                    {filteredProjects.map(project => {
                        const timerBtn = getProjectTimerButton(project.id);
                        const status = getProjectStatus ? getProjectStatus(project.status) : { label: project.status, badge: 'badge-default' };

                        return (
                            <div key={project.id} className="list-item">
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
                                        <span>{project.task_count || 0} משימות</span>
                                        <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                                        <span>{formatDurationHuman(project.total_time || 0)}</span>
                                        {project.client_name && (
                                            <>
                                                <span className="divider-vertical" style={{ height: '12px', margin: '0 0.5rem' }}></span>
                                                <Link to={`/clients/${project.client_id}`} className="client-link">
                                                    {project.client_name}
                                                </Link>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="list-actions">
                                    <button
                                        onClick={(e) => handleTimerButtonClick(e, project)}
                                        className={`btn ${timerBtn.className} btn-icon`}
                                        title={timerBtn.title}
                                    >
                                        {timerBtn.icon}
                                    </button>
                                    {getTimerForProject(project.id, null) && (
                                        <button
                                            onClick={(e) => handleStopTimerClick(e, getTimerForProject(project.id, null), project.name)}
                                            className="btn btn-error btn-icon"
                                            title="עצור ושמור"
                                        >
                                            <Square size={16} />
                                        </button>
                                    )}
                                    <span className={`badge ${status.badge}`}>
                                        {status.label}
                                    </span>
                                    <button
                                        onClick={() => openEditModal(project)}
                                        className="btn btn-ghost btn-icon"
                                        title="עריכה"
                                    >
                                        <Edit2 size={18} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(project.id)}
                                        className="btn btn-ghost btn-icon"
                                        title="מחיקה"
                                    >
                                        <Trash2 size={22} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {showModal && (
                <ProjectModal
                    project={editingProject}
                    onSave={handleSave}
                    onClose={closeModal}
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
        </div>
    );
}

export default Projects;
