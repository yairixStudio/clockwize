import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import { tasksAPI, projectsAPI } from '../services/api';

function SubtaskModal({ subtask, onSave, onClose }) {
  useBodyScrollLock(true);
  const formRef = useRef(null);
  const [formData, setFormData] = useState({
    title: '',
    due_date: '',
    description: '',
    priority: 'normal',
    communication_platforms: [],
    task_id: ''
  });
  const [loading, setLoading] = useState(false);
  const [allTasks, setAllTasks] = useState([]);
  const [allProjects, setAllProjects] = useState([]);

  // Load tasks and projects for reassignment (only when editing)
  useEffect(() => {
    if (subtask) {
      const loadOptions = async () => {
        try {
          const [tasks, projects] = await Promise.all([
            tasksAPI.getAll(),
            projectsAPI.getAll()
          ]);
          setAllTasks(tasks);
          setAllProjects(projects);
        } catch (error) {
          console.error('Failed to load tasks/projects:', error);
        }
      };
      loadOptions();
    }
  }, [subtask]);

  useEffect(() => {
    if (subtask) {
      const platforms = subtask.communication_platforms
        ? (typeof subtask.communication_platforms === 'string' ? JSON.parse(subtask.communication_platforms) : subtask.communication_platforms)
        : [];
      setFormData({
        title: subtask.title || '',
        due_date: subtask.due_date ? subtask.due_date.split('T')[0] : '',
        description: subtask.description || '',
        priority: subtask.priority || 'normal',
        communication_platforms: platforms,
        task_id: subtask.task_id || ''
      });
    }
  }, [subtask]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePlatformToggle = (platform) => {
    setFormData(prev => {
      const current = prev.communication_platforms || [];
      const updated = current.includes(platform)
        ? current.filter(p => p !== platform)
        : [...current, platform];
      return { ...prev, communication_platforms: updated };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const form = formRef.current;
    const data = {
      title: form.title.value,
      due_date: form.due_date.value || null,
      description: form.description.value || null,
      priority: form.priority.value || 'normal',
      communication_platforms: formData.communication_platforms.length > 0 ? formData.communication_platforms : null
    };

    // Include task_id when editing (for reassignment)
    if (subtask && formData.task_id) {
      data.task_id = formData.task_id;
    }

    try {
      await onSave(data);
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{subtask ? 'עריכת תת-משימה' : 'תת-משימה חדשה'}</h3>
          <button onClick={onClose} className="btn btn-ghost btn-icon">
            <X size={20} />
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">כותרת *</label>
              <input
                type="text"
                name="title"
                className="form-input"
                defaultValue={formData.title}
                onChange={handleChange}
                required
              />
            </div>

            {subtask && allTasks.length > 0 && (
              <div className="form-group">
                <label className="form-label">שיוך למשימה</label>
                <select
                  name="task_id"
                  className="form-input"
                  value={formData.task_id}
                  onChange={handleChange}
                >
                  {(() => {
                    // Group tasks by project
                    const projectMap = {};
                    allProjects.forEach(p => { projectMap[p.id] = p.name; });
                    const grouped = {};
                    allTasks.filter(t => t.status !== 'cancelled').forEach(t => {
                      const projectName = projectMap[t.project_id] || 'ללא פרויקט';
                      if (!grouped[projectName]) grouped[projectName] = [];
                      grouped[projectName].push(t);
                    });
                    return Object.entries(grouped).map(([projectName, tasks]) => (
                      <optgroup key={projectName} label={projectName}>
                        {tasks.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </optgroup>
                    ));
                  })()}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">תאריך יעד</label>
              <input
                type="date"
                name="due_date"
                className="form-input"
                defaultValue={formData.due_date}
                onChange={handleChange}
                dir="ltr"
              />
            </div>

            <div className="form-group">
              <label className="form-label">עדיפות</label>
              <select
                name="priority"
                className="form-input"
                defaultValue={formData.priority}
                onChange={handleChange}
              >
                <option value="low">🔽 נמוכה</option>
                <option value="normal">➖ רגילה</option>
                <option value="high">🔼 גבוהה</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">📱 פלטפורמת התקשרות</label>
              <div className="platform-chips">
                {[
                  { value: 'whatsapp', label: 'ווצאפ' },
                  { value: 'email', label: 'מייל' },
                  { value: 'phone', label: 'טלפון' },
                  { value: 'other', label: 'אחר' }
                ].map(platform => (
                  <button
                    key={platform.value}
                    type="button"
                    className={`platform-chip ${(formData.communication_platforms || []).includes(platform.value) ? 'active' : ''}`}
                    onClick={() => handlePlatformToggle(platform.value)}
                  >
                    {platform.label}
                  </button>
                ))}
              </div>
              <small className="form-hint">בחר את הפלטפורמות שבהן התנהלה התקשורת עם הלקוח</small>
            </div>

            <div className="form-group">
              <label className="form-label">תיאור</label>
              <textarea
                name="description"
                className="form-input"
                defaultValue={formData.description}
                onChange={handleChange}
                rows={4}
                placeholder="תיאור תת-המשימה..."
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
    </div>,
    document.body
  );
}

export default SubtaskModal;
