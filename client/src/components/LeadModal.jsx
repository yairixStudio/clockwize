import { useState, useEffect } from 'react';
import { X, Building2 } from 'lucide-react';
import { leadsAPI, clientSourcesAPI, clientsAPI } from '../services/api';
import { useModal } from './Modal';
import { LEAD_STATUSES, LEAD_PRIORITIES, LEAD_SOURCE_TYPES } from '../utils/leadStatus';

function LeadModal({ isOpen, onClose, lead = null, onSaved, workspaceMembers = [], initialClientId = null }) {
  const modal = useModal();
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState([]);
  const [clients, setClients] = useState([]);
  const [isOpportunity, setIsOpportunity] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    source_type: 'other',
    source_id: '',
    source_detail: '',
    status: 'new',
    priority: 'warm',
    expected_value: '',
    expected_close_date: '',
    assigned_to: '',
    tags: '',
    notes: '',
    client_id: ''
  });

  useEffect(() => {
    if (isOpen) {
      loadSources();
      loadClients();
      if (lead) {
        setIsOpportunity(!!lead.is_opportunity || !!lead.client_id);
        setForm({
          name: lead.name || '',
          email: lead.email || '',
          phone: lead.phone || '',
          company: lead.company || '',
          source_type: lead.source_type || 'other',
          source_id: lead.source_id || '',
          source_detail: lead.source_detail || '',
          status: lead.status || 'new',
          priority: lead.priority || 'warm',
          expected_value: lead.expected_value || '',
          expected_close_date: lead.expected_close_date || '',
          assigned_to: lead.assigned_to || '',
          tags: lead.tags ? (typeof lead.tags === 'string' ? JSON.parse(lead.tags) : lead.tags).join(', ') : '',
          notes: lead.notes || '',
          client_id: lead.client_id || ''
        });
      } else {
        setIsOpportunity(!!initialClientId);
        setForm({
          name: '', email: '', phone: '', company: '',
          source_type: 'other', source_id: '', source_detail: '',
          status: 'new', priority: 'warm',
          expected_value: '', expected_close_date: '',
          assigned_to: '', tags: '', notes: '',
          client_id: initialClientId || ''
        });
      }
    }
  }, [isOpen, lead]);

  const loadSources = async () => {
    try {
      const data = await clientSourcesAPI.getAll();
      setSources(data);
    } catch (e) {
      console.error('Failed to load sources:', e);
    }
  };

  const loadClients = async () => {
    try {
      const data = await clientsAPI.getAll();
      setClients(data);
    } catch (e) {
      console.error('Failed to load clients:', e);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      modal.error('שם ליד נדרש');
      return;
    }
    if (isOpportunity && !form.client_id) {
      modal.error('יש לבחור לקוח עבור הזדמנות');
      return;
    }

    setLoading(true);
    try {
      const data = {
        ...form,
        expected_value: form.expected_value ? Number(form.expected_value) : null,
        source_id: form.source_id || null,
        assigned_to: form.assigned_to || null,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : null,
        client_id: isOpportunity ? (form.client_id || null) : null,
        is_opportunity: isOpportunity ? 1 : 0
      };

      if (lead) {
        await leadsAPI.update(lead.id, data);
        modal.success('ליד עודכן בהצלחה');
      } else {
        await leadsAPI.create(data);
        modal.success('ליד חדש נוצר בהצלחה');
      }

      onSaved?.();
      onClose();
    } catch (error) {
      console.error('Save lead error:', error);
      modal.error('שגיאה בשמירת ליד');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content lead-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{lead ? (isOpportunity ? 'עריכת הזדמנות' : 'עריכת ליד') : (isOpportunity ? 'הזדמנות חדשה' : 'ליד חדש')}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* Opportunity Toggle */}
          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isOpportunity}
                onChange={(e) => {
                  setIsOpportunity(e.target.checked);
                  if (!e.target.checked) setForm({ ...form, client_id: '' });
                }}
              />
              <Building2 size={16} />
              הזדמנות מלקוח קיים
            </label>
          </div>

          {isOpportunity && (
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label className="form-label">לקוח מקושר *</label>
              <select
                className="form-input"
                value={form.client_id}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}
              >
                <option value="">בחר לקוח...</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">שם *</label>
              <input
                type="text"
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={isOpportunity ? 'שם ההזדמנות' : 'שם הליד'}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">חברה</label>
              <input
                type="text"
                className="form-input"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="שם חברה"
              />
            </div>

            <div className="form-group">
              <label className="form-label">אימייל</label>
              <input
                type="email"
                className="form-input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="email@example.com"
              />
            </div>

            <div className="form-group">
              <label className="form-label">טלפון</label>
              <input
                type="tel"
                className="form-input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="050-0000000"
              />
            </div>

            <div className="form-group">
              <label className="form-label">סטטוס</label>
              <select
                className="form-input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {LEAD_STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">עדיפות</label>
              <select
                className="form-input"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {LEAD_PRIORITIES.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">סוג מקור</label>
              <select
                className="form-input"
                value={form.source_type}
                onChange={(e) => setForm({ ...form, source_type: e.target.value })}
              >
                {LEAD_SOURCE_TYPES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">מקור (קטגוריה)</label>
              <select
                className="form-input"
                value={form.source_id}
                onChange={(e) => setForm({ ...form, source_id: e.target.value })}
              >
                <option value="">ללא</option>
                {sources.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">פרטי מקור</label>
              <input
                type="text"
                className="form-input"
                value={form.source_detail}
                onChange={(e) => setForm({ ...form, source_detail: e.target.value })}
                placeholder="שם קמפיין, מי הפנה, URL..."
              />
            </div>

            <div className="form-group">
              <label className="form-label">ערך צפוי (₪)</label>
              <input
                type="number"
                className="form-input"
                value={form.expected_value}
                onChange={(e) => setForm({ ...form, expected_value: e.target.value })}
                placeholder="0"
              />
            </div>

            <div className="form-group">
              <label className="form-label">תאריך סגירה צפוי</label>
              <input
                type="date"
                className="form-input"
                value={form.expected_close_date}
                onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">אחראי</label>
              <select
                className="form-input"
                value={form.assigned_to}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
              >
                <option value="">לא מוקצה</option>
                {workspaceMembers.map(m => (
                  <option key={m.id || m.user_id} value={m.id || m.user_id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '0.75rem' }}>
            <label className="form-label">תגיות (מופרדות בפסיק)</label>
            <input
              type="text"
              className="form-input"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="VIP, דחוף, פרויקט גדול..."
            />
          </div>

          <div className="form-group" style={{ marginTop: '0.75rem' }}>
            <label className="form-label">הערות</label>
            <textarea
              className="form-input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="הערות נוספות..."
              rows={3}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'שומר...' : (lead ? 'עדכן' : (isOpportunity ? 'צור הזדמנות' : 'צור ליד'))}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LeadModal;
