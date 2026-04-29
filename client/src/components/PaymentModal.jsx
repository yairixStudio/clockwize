import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DollarSign, Calendar, FileText, CreditCard, Clock, Tag, Link2, Plus, X } from 'lucide-react';
import { projectsAPI, tasksAPI } from '../services/api';
import useBodyScrollLock from '../hooks/useBodyScrollLock';

const PAYMENT_STATUSES = [
    { value: 'draft', label: 'טיוטה', color: 'gray' },
    { value: 'sent', label: 'נשלח', color: 'blue' },
    { value: 'pending', label: 'ממתין לתשלום', color: 'yellow' },
    { value: 'paid', label: 'שולם', color: 'green' },
    { value: 'cancelled', label: 'בוטל', color: 'red' },
    { value: 'overdue', label: 'באיחור', color: 'darkred' }
];

const PAYMENT_METHODS = [
    { value: 'bank_transfer', label: 'העברה בנקאית' },
    { value: 'credit_card', label: 'כרטיס אשראי' },
    { value: 'cash', label: 'מזומן' },
    { value: 'check', label: "צ'ק" },
    { value: 'bit', label: 'Bit / PayBox' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'other', label: 'אחר' }
];

function PaymentModal({ payment, projectId, projects, tasks, onSave, onClose }) {
    useBodyScrollLock(true);

    const [formData, setFormData] = useState({
        amount: '',
        date: new Date().toISOString().split('T')[0],
        notes: '',
        project_id: projectId || '',
        task_id: '',
        status: 'paid',
        due_date: '',
        payment_method: 'bank_transfer'
    });
    const [loading, setLoading] = useState(false);
    
    // Additional associations state
    const [additionalAssociations, setAdditionalAssociations] = useState([]);
    const [showAddAssociation, setShowAddAssociation] = useState(false);
    const [allProjects, setAllProjects] = useState([]);
    const [allTasks, setAllTasks] = useState([]);

    // Filter tasks based on selected project
    const projectTasks = tasks?.filter(t => t.project_id === formData.project_id) || [];

    // Load all projects and tasks for associations
    useEffect(() => {
        const loadAllData = async () => {
            try {
                const [projectsData, tasksData] = await Promise.all([
                    projectsAPI.getAll(),
                    tasksAPI.getAll()
                ]);
                setAllProjects(projectsData);
                setAllTasks(tasksData);
            } catch (error) {
                console.error('Error loading projects/tasks:', error);
            }
        };
        loadAllData();
    }, []);

    useEffect(() => {
        if (payment) {
            setFormData({
                amount: payment.amount,
                date: payment.date?.split('T')[0] || new Date().toISOString().split('T')[0],
                notes: payment.notes || '',
                project_id: payment.project_id || projectId || '',
                task_id: payment.task_id || '',
                status: payment.status || 'paid',
                due_date: payment.due_date?.split('T')[0] || '',
                payment_method: payment.payment_method || 'bank_transfer'
            });
            // Load existing associations
            if (payment.additional_associations && payment.additional_associations.length > 0) {
                setAdditionalAssociations(payment.additional_associations.map(a => ({
                    project_id: a.project_id || '',
                    task_id: a.task_id || ''
                })));
                setShowAddAssociation(true);
            }
        } else if (projectId) {
            setFormData(prev => ({ ...prev, project_id: projectId }));
        }
    }, [payment, projectId]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => {
            const newData = { ...prev, [name]: value };
            // Clear task when project changes
            if (name === 'project_id') {
                newData.task_id = '';
            }
            return newData;
        });
    };

    // Association handlers
    const handleAddAssociation = () => {
        setAdditionalAssociations(prev => [...prev, { project_id: '', task_id: '' }]);
    };

    const handleRemoveAssociation = (index) => {
        setAdditionalAssociations(prev => prev.filter((_, i) => i !== index));
    };

    const handleAssociationChange = (index, field, value) => {
        setAdditionalAssociations(prev => {
            const newAssocs = [...prev];
            newAssocs[index] = { ...newAssocs[index], [field]: value };
            // Clear task when project changes
            if (field === 'project_id') {
                newAssocs[index].task_id = '';
            }
            return newAssocs;
        });
    };

    const getTasksForProject = (projectId) => {
        return allTasks.filter(t => t.project_id === projectId);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            // Filter out empty associations
            const validAssociations = additionalAssociations.filter(a => a.project_id || a.task_id);
            
            await onSave({
                ...formData,
                project_id: formData.project_id || projectId || null,
                task_id: formData.task_id || null,
                due_date: formData.due_date || null,
                type: 'income',
                additional_associations: validAssociations
            });
        } catch (error) {
            console.error('Save payment error:', error);
        } finally {
            setLoading(false);
        }
    };

    const showProjectSelect = !projectId && projects && projects.length > 0;

    const isEditing = !!payment;

    return createPortal(
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
                <div className="modal-header">
                    <h3 className="modal-title">
                        {isEditing ? 'עריכת תשלום' : 'הוספת תשלום חדש'}
                    </h3>
                    <button onClick={onClose} className="btn btn-ghost btn-icon">✕</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        {showProjectSelect && (
                            <div className="form-group">
                                <label className="form-label">
                                    <Tag size={16} style={{ marginLeft: '0.25rem' }} />
                                    פרויקט
                                </label>
                                <select
                                    name="project_id"
                                    className="form-input"
                                    value={formData.project_id}
                                    onChange={handleChange}
                                >
                                    <option value="">ללא פרויקט</option>
                                    {projects.map(project => (
                                        <option key={project.id} value={project.id}>
                                            {project.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {formData.project_id && projectTasks.length > 0 && (
                            <div className="form-group">
                                <label className="form-label">משימה (אופציונלי)</label>
                                <select
                                    name="task_id"
                                    className="form-input"
                                    value={formData.task_id}
                                    onChange={handleChange}
                                >
                                    <option value="">ללא משימה ספציפית</option>
                                    {projectTasks.map(task => (
                                        <option key={task.id} value={task.id}>
                                            {task.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label className="form-label">
                                    <DollarSign size={16} style={{ marginLeft: '0.25rem' }} />
                                    סכום
                                </label>
                                <input
                                    type="number"
                                    name="amount"
                                    className="form-input"
                                    value={formData.amount}
                                    onChange={handleChange}
                                    required
                                    min="0"
                                    step="0.01"
                                    placeholder="0.00"
                                    dir="ltr"
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    <Clock size={16} style={{ marginLeft: '0.25rem' }} />
                                    סטטוס
                                </label>
                                <select
                                    name="status"
                                    className="form-input"
                                    value={formData.status}
                                    onChange={handleChange}
                                >
                                    {PAYMENT_STATUSES.map(s => (
                                        <option key={s.value} value={s.value}>{s.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label className="form-label">
                                    <Calendar size={16} style={{ marginLeft: '0.25rem' }} />
                                    תאריך תשלום
                                </label>
                                <input
                                    type="date"
                                    name="date"
                                    className="form-input"
                                    value={formData.date}
                                    onChange={handleChange}
                                    required
                                    dir="ltr"
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    <Calendar size={16} style={{ marginLeft: '0.25rem' }} />
                                    תאריך יעד
                                </label>
                                <input
                                    type="date"
                                    name="due_date"
                                    className="form-input"
                                    value={formData.due_date}
                                    onChange={handleChange}
                                    dir="ltr"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">
                                <CreditCard size={16} style={{ marginLeft: '0.25rem' }} />
                                אמצעי תשלום
                            </label>
                            <select
                                name="payment_method"
                                className="form-input"
                                value={formData.payment_method}
                                onChange={handleChange}
                            >
                                {PAYMENT_METHODS.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-label">
                                <FileText size={16} style={{ marginLeft: '0.25rem' }} />
                                הערות
                            </label>
                            <textarea
                                name="notes"
                                className="form-input"
                                value={formData.notes}
                                onChange={handleChange}
                                rows={3}
                                placeholder="פרטים נוספים על התשלום..."
                            />
                        </div>

                        {/* Additional Associations Section */}
                        <div className="form-group" style={{ marginTop: '1rem' }}>
                            <button
                                type="button"
                                onClick={() => setShowAddAssociation(!showAddAssociation)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--primary)',
                                    cursor: 'pointer',
                                    padding: '0.5rem 0',
                                    fontSize: '0.9rem'
                                }}
                            >
                                <Link2 size={16} />
                                {showAddAssociation ? 'הסתר קישורים נוספים' : 'קשר לפרויקטים/משימות נוספים'}
                            </button>

                            {showAddAssociation && (
                                <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                                    {additionalAssociations.map((assoc, index) => (
                                        <div key={index} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                                            <div style={{ flex: 1 }}>
                                                <select
                                                    className="form-input"
                                                    value={assoc.project_id}
                                                    onChange={(e) => handleAssociationChange(index, 'project_id', e.target.value)}
                                                    style={{ fontSize: '0.85rem', padding: '0.4rem' }}
                                                >
                                                    <option value="">בחר פרויקט...</option>
                                                    {allProjects.map(p => (
                                                        <option key={p.id} value={p.id}>{p.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <select
                                                    className="form-input"
                                                    value={assoc.task_id}
                                                    onChange={(e) => handleAssociationChange(index, 'task_id', e.target.value)}
                                                    disabled={!assoc.project_id}
                                                    style={{ fontSize: '0.85rem', padding: '0.4rem' }}
                                                >
                                                    <option value="">בחר משימה (אופציונלי)...</option>
                                                    {getTasksForProject(assoc.project_id).map(t => (
                                                        <option key={t.id} value={t.id}>{t.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveAssociation(index)}
                                                className="btn btn-ghost btn-icon btn-sm"
                                                style={{ padding: '0.3rem' }}
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={handleAddAssociation}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.35rem',
                                            background: 'none',
                                            border: '1px dashed var(--border-color)',
                                            borderRadius: 'var(--radius-sm)',
                                            color: 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            padding: '0.4rem 0.6rem',
                                            fontSize: '0.8rem',
                                            width: '100%',
                                            justifyContent: 'center'
                                        }}
                                    >
                                        <Plus size={14} />
                                        הוסף קישור
                                    </button>
                                </div>
                            )}
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

export default PaymentModal;
