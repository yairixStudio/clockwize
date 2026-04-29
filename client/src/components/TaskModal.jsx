import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import { projectsAPI, clientsAPI } from '../services/api';

function TaskModal({ task, projectHourlyRate, projectPricingType, onSave, onClose }) {
  useBodyScrollLock(true);
  const formRef = useRef(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    pricing_type: '',
    hourly_rate: '',
    status: 'pending',
    notes: '',
    paid_amount: '',
    estimated_hours: '',
    priority: 'normal',
    communication_platforms: [],
    project_id: ''
  });
  const [loading, setLoading] = useState(false);
  const [pricingType, setPricingType] = useState('');
  const [allProjects, setAllProjects] = useState([]);
  const [allClients, setAllClients] = useState([]);

  // Load projects and clients for reassignment (only when editing)
  useEffect(() => {
    if (task) {
      const loadOptions = async () => {
        try {
          const [projects, clients] = await Promise.all([
            projectsAPI.getAll(),
            clientsAPI.getAll()
          ]);
          setAllProjects(projects);
          setAllClients(clients);
        } catch (error) {
          console.error('Failed to load projects/clients:', error);
        }
      };
      loadOptions();
    }
  }, [task]);

  useEffect(() => {
    if (task) {
      const platforms = task.communication_platforms
        ? (typeof task.communication_platforms === 'string' ? JSON.parse(task.communication_platforms) : task.communication_platforms)
        : [];
      setFormData({
        name: task.name || '',
        description: task.description || '',
        pricing_type: task.pricing_type || '',
        hourly_rate: task.hourly_rate || '',
        status: task.status || 'pending',
        notes: task.notes || '',
        paid_amount: task.paid_amount || '',
        estimated_hours: task.estimated_hours || '',
        priority: task.priority || 'normal',
        communication_platforms: platforms,
        project_id: task.project_id || ''
      });
      setPricingType(task.pricing_type || '');
    }
  }, [task]);
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (name === 'pricing_type') {
      setPricingType(value);
    }
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
    
    // Read directly from form to support programmatic input
    const form = formRef.current;
    const currentPricingType = form.pricing_type ? form.pricing_type.value : '';
    const data = {
      name: form.name.value,
      description: form.description.value || null,
      pricing_type: currentPricingType || null,
      hourly_rate: currentPricingType === 'hourly' && form.hourly_rate && form.hourly_rate.value ? parseFloat(form.hourly_rate.value) : null,
      status: form.status ? form.status.value : 'pending',
      notes: form.notes ? form.notes.value : null,
      paid_amount: form.paid_amount ? parseFloat(form.paid_amount.value) : 0,
      estimated_hours: form.estimated_hours && form.estimated_hours.value ? parseFloat(form.estimated_hours.value) : null,
      priority: form.priority ? form.priority.value : 'normal',
      communication_platforms: formData.communication_platforms.length > 0 ? formData.communication_platforms : null
    };

    // Include project_id when editing (for reassignment)
    if (task && formData.project_id) {
      data.project_id = formData.project_id;
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
          <h3 className="modal-title">{task ? 'עריכת משימה' : 'משימה חדשה'}</h3>
          <button onClick={onClose} className="btn btn-ghost btn-icon">
            <X size={20} />
          </button>
        </div>
        
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">שם המשימה *</label>
              <input
                type="text"
                name="name"
                className="form-input"
                defaultValue={formData.name}
                onChange={handleChange}
                required
              />
            </div>
            
            {task && allProjects.length > 0 && (
              <div className="form-group">
                <label className="form-label">שיוך לפרויקט</label>
                <select
                  name="project_id"
                  className="form-input"
                  value={formData.project_id}
                  onChange={handleChange}
                >
                  {(() => {
                    // Group projects by client
                    const clientMap = {};
                    allClients.forEach(c => { clientMap[c.id] = c.name; });
                    const grouped = {};
                    allProjects.filter(p => p.status !== 'cancelled').forEach(p => {
                      const clientName = clientMap[p.client_id] || 'ללא לקוח';
                      if (!grouped[clientName]) grouped[clientName] = [];
                      grouped[clientName].push(p);
                    });
                    return Object.entries(grouped).map(([clientName, projects]) => (
                      <optgroup key={clientName} label={clientName}>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </optgroup>
                    ));
                  })()}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">תיאור</label>
              <textarea
                name="description"
                className="form-input"
                defaultValue={formData.description}
                onChange={handleChange}
                rows={3}
              />
            </div>

            <div className="form-group">
              <label className="form-label">סוג תמחור</label>
              <select
                name="pricing_type"
                className="form-input"
                value={formData.pricing_type}
                onChange={handleChange}
              >
                <option value="">ירושה מהפרויקט{projectPricingType === 'no_charge' ? ' (ללא תשלום)' : projectPricingType === 'fixed' ? ' (מחיר קבוע)' : ''}</option>
                <option value="hourly">לפי שעה</option>
                <option value="no_charge">ללא תשלום</option>
              </select>
            </div>
            
            {pricingType === 'hourly' && (
              <div className="form-group">
                <label className="form-label">מחיר לשעה (₪)</label>
                <input
                  type="number"
                  name="hourly_rate"
                  className="form-input"
                  defaultValue={formData.hourly_rate}
                  onChange={handleChange}
                  placeholder={projectHourlyRate ? `ברירת מחדל: ₪${projectHourlyRate}` : 'השאר ריק לשימוש בברירת המחדל'}
                  min="0"
                  step="0.01"
                  dir="ltr"
                />
              </div>
            )}
            
            <div className="form-group">
              <label className="form-label">סטטוס</label>
              <select
                name="status"
                className="form-input"
                defaultValue={formData.status}
                onChange={handleChange}
              >
                <option value="pending">⏳ ממתין</option>
                <option value="in_progress">🔄 בתהליך</option>
                <option value="stuck">🚫 תקוע</option>
                <option value="review">👀 בבדיקה</option>
                <option value="completed">✅ הושלם</option>
                <option value="cancelled">❌ בוטל</option>
              </select>
            </div>
            
            <div className="form-group">
              <label className="form-label">🎯 חשיבות</label>
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
              <label className="form-label">⏱️ שעות משוערות</label>
              <input
                type="number"
                name="estimated_hours"
                className="form-input"
                defaultValue={formData.estimated_hours}
                onChange={handleChange}
                placeholder="כמה שעות אתה מעריך שהמשימה תיקח?"
                min="0"
                step="0.5"
                dir="ltr"
              />
              <small className="form-hint">הזן את הערכת השעות למשימה זו כדי לעקוב אחרי ההתקדמות</small>
            </div>
            
            <div className="form-group">
              <label className="form-label">💵 סכום ששולם (₪)</label>
              <input
                type="number"
                name="paid_amount"
                className="form-input"
                defaultValue={formData.paid_amount}
                onChange={handleChange}
                placeholder="הזן סכום ששולם עבור משימה זו"
                min="0"
                step="0.01"
                dir="ltr"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">📝 פתק פרטי (לעצמך)</label>
              <textarea
                name="notes"
                className="form-input notes-input"
                defaultValue={formData.notes}
                onChange={handleChange}
                rows={4}
                placeholder="רשום כאן מה חשוב לזכור, דגשים מהלקוח, סיכומים..."
              />
              <small className="form-hint">הפתק הזה לא יופיע בדף השיתוף ללקוח</small>
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

export default TaskModal;
