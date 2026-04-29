import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2 } from 'lucide-react';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import { CLIENT_STATUSES } from '../utils/status';
import { clientSourcesAPI, clientsAPI } from '../services/api';
import { useModal } from './Modal/ModalContext';

function ClientModal({ client, onSave, onClose, onDelete }) {
  useBodyScrollLock(true);
  const modal = useModal();
  const formRef = useRef(null);
  const [formData, setFormData] = useState({
    name: '',
    status: 'active',
    email: '',
    phone: '',
    address: '',
    bank_name: '',
    bank_account: '',
    bank_branch: '',
    tax_id: '',
    hourly_rate: '',
    notes: '',
    source_id: '',
    sub_source: ''
  });
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sources, setSources] = useState([]);
  const [showNewSourceInput, setShowNewSourceInput] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [aliases, setAliases] = useState([]);
  const [newAlias, setNewAlias] = useState('');
  const [domains, setDomains] = useState([]);
  const [newDomain, setNewDomain] = useState('');

  useEffect(() => {
    if (client) {
      setFormData({
        name: client.name || '',
        status: client.status || 'active',
        email: client.email || '',
        phone: client.phone || '',
        address: client.address || '',
        bank_name: client.bank_name || '',
        bank_account: client.bank_account || '',
        bank_branch: client.bank_branch || '',
        tax_id: client.tax_id || '',
        hourly_rate: client.hourly_rate || '',
        notes: client.notes || '',
        source_id: client.source_id || '',
        sub_source: client.sub_source || ''
      });
      // Load aliases and domains
      setAliases(client.aliases || []);
      setDomains(client.domains || []);
    }
    loadSources();
  }, [client]);

  const loadSources = async () => {
    try {
      const data = await clientSourcesAPI.getAll();
      setSources(data);
    } catch (error) {
      console.error('Failed to load sources:', error);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCreateSource = async () => {
    if (!newSourceName.trim()) return;
    try {
      const newSource = await clientSourcesAPI.create({ name: newSourceName });
      setSources([...sources, newSource]);
      setFormData(prev => ({ ...prev, source_id: newSource.id }));
      setNewSourceName('');
      setShowNewSourceInput(false);
    } catch (error) {
      console.error('Failed to create source:', error);
      alert('שגיאה ביצירת מקור לקוח');
    }
  };

  const handleAddAlias = () => {
    const trimmed = newAlias.trim();
    if (trimmed && !aliases.includes(trimmed)) {
      setAliases([...aliases, trimmed]);
      setNewAlias('');
    }
  };

  const handleRemoveAlias = (aliasToRemove) => {
    setAliases(aliases.filter(a => a !== aliasToRemove));
  };

  const handleAliasKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddAlias();
    }
  };

  const handleAddDomain = () => {
    let trimmed = newDomain.trim().toLowerCase();
    if (!trimmed) return;
    // Strip protocol, path, port if user pastes a full URL
    try {
      if (trimmed.includes('://')) {
        trimmed = new URL(trimmed).hostname;
      } else if (trimmed.includes('/')) {
        trimmed = trimmed.split('/')[0];
      }
      if (trimmed.includes(':')) {
        trimmed = trimmed.split(':')[0];
      }
    } catch (e) { /* keep as-is */ }
    if (trimmed && !domains.includes(trimmed)) {
      setDomains([...domains, trimmed]);
      setNewDomain('');
    }
  };

  const handleRemoveDomain = (domainToRemove) => {
    setDomains(domains.filter(d => d !== domainToRemove));
  };

  const handleDomainKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddDomain();
    }
  };

  // Check if current source is "הפניות" (referrals) - show sub_source field
  const selectedSource = sources.find(s => s.id === formData.source_id);
  const isReferralSource = selectedSource?.name === 'הפניות';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    // Read directly from form to support programmatic input
    const form = formRef.current;
    const data = {
      name: form.name.value,
      status: form.status.value,
      email: form.email.value || null,
      phone: form.phone.value || null,
      address: form.address.value || null,
      bank_name: form.bank_name.value || null,
      bank_account: form.bank_account.value || null,
      bank_branch: form.bank_branch.value || null,
      tax_id: form.tax_id.value || null,
      hourly_rate: form.hourly_rate.value ? parseFloat(form.hourly_rate.value) : null,
      notes: form.notes.value || null,
      source_id: formData.source_id || null,
      sub_source: formData.sub_source || null,
      aliases: aliases,
      domains: domains
    };

    try {
      await onSave(data);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!client || !client.id) return;

    const confirmed = await modal.confirm(
      `האם אתה בטוח שברצונך למחוק את הלקוח "${client.name}"?\n\nפעולה זו תמחק את כל הנתונים הקשורים ללקוח:\n- פרויקטים\n- משימות\n- רשומות זמן\n\nפעולה זו אינה ניתנת לביטול!`,
      { 
        title: 'מחיקת לקוח', 
        confirmText: 'מחק לצמיתות',
        cancelText: 'ביטול',
        type: 'error'
      }
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      await clientsAPI.delete(client.id);
      modal.success('הלקוח נמחק בהצלחה');
      if (onDelete) {
        onDelete();
      }
      onClose();
    } catch (error) {
      console.error('Error deleting client:', error);
      modal.error(error.message || 'שגיאה במחיקת הלקוח');
    } finally {
      setDeleting(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <div className="modal-header">
          <h3 className="modal-title">{client ? 'עריכת לקוח' : 'לקוח חדש'}</h3>
          <button onClick={onClose} className="btn btn-ghost btn-icon">
            <X size={20} />
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">שם לקוח *</label>
                <input
                  type="text"
                  name="name"
                  className="form-input"
                  defaultValue={formData.name}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">סטטוס</label>
                <select
                  name="status"
                  className="form-input"
                  defaultValue={formData.status}
                  onChange={handleChange}
                >
                  {CLIENT_STATUSES.map(status => (
                    <option key={status.value} value={status.value}>
                      {status.icon} {status.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">כינויים לחיפוש</label>
              <div className="aliases-container">
                {aliases.length > 0 && (
                  <div className="aliases-tags">
                    {aliases.map((alias, index) => (
                      <span key={index} className="alias-tag">
                        {alias}
                        <button
                          type="button"
                          className="alias-remove"
                          onClick={() => handleRemoveAlias(alias)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="alias-input-row">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="הוסף כינוי..."
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                    onKeyDown={handleAliasKeyDown}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-icon"
                    onClick={handleAddAlias}
                    disabled={!newAlias.trim()}
                    title="הוסף כינוי"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              </div>
              <small className="form-hint">כינויים מאפשרים לחפש את הלקוח בשמות נוספים</small>
            </div>

            <div className="form-group">
              <label className="form-label">דומיינים (לזיהוי אוטומטי)</label>
              <div className="aliases-container">
                {domains.length > 0 && (
                  <div className="aliases-tags">
                    {domains.map((domain, index) => (
                      <span key={index} className="alias-tag" dir="ltr">
                        {domain}
                        <button
                          type="button"
                          className="alias-remove"
                          onClick={() => handleRemoveDomain(domain)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="alias-input-row">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="zrp.co.il"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    onKeyDown={handleDomainKeyDown}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-icon"
                    onClick={handleAddDomain}
                    disabled={!newDomain.trim()}
                    title="הוסף דומיין"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              </div>
              <small className="form-hint">הוסף דומיינים לזיהוי אוטומטי של הלקוח בתוסף כרום</small>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">מקור הגעה</label>
                {!showNewSourceInput ? (
                  <div className="source-select-wrapper" style={{ display: 'flex', gap: '8px' }}>
                    <select
                      name="source_id"
                      className="form-input"
                      value={formData.source_id}
                      onChange={handleChange}
                      style={{ flex: 1 }}
                    >
                      <option value="">בחר מקור...</option>
                      {sources.map(source => (
                        <option key={source.id} value={source.id}>
                          {source.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary btn-icon"
                      onClick={() => setShowNewSourceInput(true)}
                      title="הוסף מקור חדש"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                ) : (
                  <div className="new-source-input" style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="שם המקור החדש..."
                      value={newSourceName}
                      onChange={(e) => setNewSourceName(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleCreateSource}
                    >
                      הוסף
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowNewSourceInput(false)}
                    >
                      ביטול
                    </button>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">אימייל</label>
                <input
                  type="email"
                  name="email"
                  className="form-input"
                  defaultValue={formData.email}
                  onChange={handleChange}
                  dir="ltr"
                />
              </div>
            </div>

            {isReferralSource && (
              <div className="form-group">
                <label className="form-label">תת מקור (מי הפנה?)</label>
                <input
                  type="text"
                  name="sub_source"
                  className="form-input"
                  value={formData.sub_source}
                  onChange={handleChange}
                  placeholder="שם הגורם המפנה..."
                />
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">טלפון</label>
                <input
                  type="tel"
                  name="phone"
                  className="form-input"
                  defaultValue={formData.phone}
                  onChange={handleChange}
                  dir="ltr"
                />
              </div>

              <div className="form-group">
                <label className="form-label">ח.פ / מספר עוסק</label>
                <input
                  type="text"
                  name="tax_id"
                  className="form-input"
                  defaultValue={formData.tax_id}
                  onChange={handleChange}
                  dir="ltr"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">כתובת</label>
              <input
                type="text"
                name="address"
                className="form-input"
                defaultValue={formData.address}
                onChange={handleChange}
              />
            </div>

            <div className="form-section-title">פרטי חשבון בנק</div>

            <div className="form-row form-row-3">
              <div className="form-group">
                <label className="form-label">שם הבנק</label>
                <input
                  type="text"
                  name="bank_name"
                  className="form-input"
                  defaultValue={formData.bank_name}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label className="form-label">סניף</label>
                <input
                  type="text"
                  name="bank_branch"
                  className="form-input"
                  defaultValue={formData.bank_branch}
                  onChange={handleChange}
                  dir="ltr"
                />
              </div>

              <div className="form-group">
                <label className="form-label">מספר חשבון</label>
                <input
                  type="text"
                  name="bank_account"
                  className="form-input"
                  defaultValue={formData.bank_account}
                  onChange={handleChange}
                  dir="ltr"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">מחיר לשעה (₪)</label>
              <input
                type="number"
                name="hourly_rate"
                className="form-input"
                defaultValue={formData.hourly_rate}
                onChange={handleChange}
                placeholder="השאר ריק לשימוש בברירת המחדל"
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
                placeholder="רשום כאן מידע על הלקוח, העדפות, היסטוריה..."
              />
              <small className="form-hint">הפתק הזה לא יופיע בדף השיתוף ללקוח</small>
            </div>
          </div>

          <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
            {client && client.id ? (
              <button 
                type="button" 
                onClick={handleDelete} 
                className="btn btn-danger" 
                disabled={deleting || loading}
              >
                <Trash2 size={16} style={{ marginLeft: '0.25rem' }} />
                {deleting ? 'מוחק...' : 'מחק לקוח'}
              </button>
            ) : (
              <div></div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={loading || deleting}>
                {loading ? 'שומר...' : 'שמור'}
              </button>
              <button type="button" onClick={onClose} className="btn btn-secondary" disabled={deleting}>
                ביטול
              </button>
            </div>
          </div>
        </form>
      </div>

      <style>{`
        .form-row {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1rem;
        }
        .form-row-3 {
          grid-template-columns: repeat(3, 1fr);
        }
        .form-section-title {
          font-weight: 600;
          color: var(--text-secondary);
          margin: 1rem 0 0.75rem;
          font-size: 0.9rem;
        }
        .aliases-container {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .aliases-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .alias-tag {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          background: var(--primary-alpha);
          color: var(--primary);
          padding: 0.25rem 0.5rem;
          border-radius: 1rem;
          font-size: 0.85rem;
        }
        .alias-remove {
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          color: var(--primary);
          opacity: 0.7;
          transition: opacity 0.15s;
        }
        .alias-remove:hover {
          opacity: 1;
        }
        .alias-input-row {
          display: flex;
          gap: 0.5rem;
        }
        .alias-input-row .form-input {
          flex: 1;
        }
        @media (max-width: 600px) {
          .form-row, .form-row-3 {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}

export default ClientModal;
