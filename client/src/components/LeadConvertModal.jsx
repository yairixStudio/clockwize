import { useState } from 'react';
import { X, ArrowLeft, CheckCircle, Folder, Clock, ListTodo, Bell, Building2 } from 'lucide-react';
import { leadsAPI } from '../services/api';
import { useModal } from './Modal';
import { useNavigate } from 'react-router-dom';
import { formatDurationHuman } from '../utils/format';

function LeadConvertModal({ isOpen, onClose, lead, onConverted }) {
  const modal = useModal();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    override_name: '',
    override_email: '',
    override_phone: '',
    override_company: ''
  });
  const [createAcquisitionProject, setCreateAcquisitionProject] = useState(true);
  const [acquisitionProjectName, setAcquisitionProjectName] = useState('');
  const [transferHistory, setTransferHistory] = useState(true);

  const isOpportunity = !!(lead?.is_opportunity || lead?.client_id);
  const taskCount = lead?.tasks?.length || 0;
  const timeEntryCount = lead?.timeEntries?.length || 0;
  const totalTime = lead?.totalTimeInvested || 0;
  const reminderCount = lead?.reminders?.length || 0;
  const hasHistory = taskCount > 0 || timeEntryCount > 0;

  // Default project name depends on flow
  const defaultProjectName = isOpportunity ? (lead?.name || 'פרויקט חדש') : 'רכישת לקוח';

  const handleConvert = async () => {
    setLoading(true);
    try {
      const overrides = {};
      if (!isOpportunity) {
        if (form.override_name) overrides.override_name = form.override_name;
        if (form.override_email) overrides.override_email = form.override_email;
        if (form.override_phone) overrides.override_phone = form.override_phone;
        if (form.override_company) overrides.override_company = form.override_company;
      }

      overrides.create_acquisition_project = createAcquisitionProject;
      overrides.acquisition_project_name = acquisitionProjectName || defaultProjectName;
      overrides.transfer_history = transferHistory;

      const data = await leadsAPI.convert(lead.id, overrides);
      setResult(data);
      onConverted?.(data);
      modal.success(isOpportunity ? 'ההזדמנות הומרה לפרויקט בהצלחה!' : 'הליד הומר ללקוח בהצלחה!');
    } catch (error) {
      console.error('Convert error:', error);
      modal.error(error.message || 'שגיאה בהמרה');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !lead) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isOpportunity ? 'המרה לפרויקט' : 'המרת ליד ללקוח'}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {result ? (
            /* ===== Success State ===== */
            <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
              <CheckCircle size={48} style={{ color: 'var(--success)', marginBottom: '1rem' }} />
              <h3 style={{ marginBottom: '0.5rem' }}>
                {isOpportunity ? 'ההזדמנות הומרה לפרויקט!' : 'הליד הומר בהצלחה!'}
              </h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                {isOpportunity
                  ? `פרויקט "${acquisitionProjectName || defaultProjectName}" נוצר תחת הלקוח`
                  : `לקוח חדש "${result.client?.name}" נוצר במערכת`
                }
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                {result.acquisition_project_id && (
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      onClose();
                      navigate(`/projects/${result.acquisition_project_id}`);
                    }}
                  >
                    <Folder size={16} />
                    עבור לפרויקט
                  </button>
                )}
                <button
                  className={`btn ${result.acquisition_project_id ? 'btn-secondary' : 'btn-primary'}`}
                  onClick={() => {
                    onClose();
                    navigate(`/clients/${result.client?.id || lead.client_id}`);
                  }}
                >
                  <ArrowLeft size={16} />
                  עבור ללקוח
                </button>
                <button className="btn btn-ghost" onClick={onClose}>סגור</button>
              </div>
            </div>
          ) : (
            /* ===== Form State ===== */
            <>
              {/* Lead summary */}
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                marginBottom: '1rem'
              }}>
                <h4 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.9rem' }}>פרטי הליד</h4>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  <div><strong>שם:</strong> {lead.name}</div>
                  {lead.company && <div><strong>חברה:</strong> {lead.company}</div>}
                  {lead.email && <div><strong>אימייל:</strong> {lead.email}</div>}
                  {lead.phone && <div><strong>טלפון:</strong> {lead.phone}</div>}
                </div>

                {/* History counts */}
                {(hasHistory || reminderCount > 0) && (
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: '0.75rem',
                    marginTop: '0.75rem', paddingTop: '0.75rem',
                    borderTop: '1px solid var(--border-color)'
                  }}>
                    {taskCount > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <ListTodo size={14} /> {taskCount} משימות
                      </span>
                    )}
                    {timeEntryCount > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <Clock size={14} /> {timeEntryCount} רשומות זמן ({formatDurationHuman(totalTime)})
                      </span>
                    )}
                    {reminderCount > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <Bell size={14} /> {reminderCount} תזכורות
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* ===== OPPORTUNITY FLOW ===== */}
              {isOpportunity && (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.6rem 1rem',
                    background: 'rgba(139, 92, 246, 0.08)',
                    border: '1px solid rgba(139, 92, 246, 0.2)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '1rem',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)'
                  }}>
                    <Building2 size={16} style={{ color: '#8b5cf6' }} />
                    <span>
                      ייווצר פרויקט חדש תחת הלקוח הקיים.
                      {' '}נתוני הליד והיסטוריית הפעילות יקופלו למשימה "רכישת פרויקט" בעלות אפס.
                    </span>
                  </div>

                  {/* Project name */}
                  <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                    <label className="form-label">שם הפרויקט</label>
                    <input
                      type="text"
                      className="form-input"
                      value={acquisitionProjectName}
                      onChange={(e) => setAcquisitionProjectName(e.target.value)}
                      placeholder={defaultProjectName}
                    />
                  </div>

                  {hasHistory && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={transferHistory}
                        onChange={(e) => setTransferHistory(e.target.checked)}
                      />
                      העבר משימות ורשומות זמן קיימות לפרויקט החדש
                    </label>
                  )}
                </>
              )}

              {/* ===== NEW LEAD FLOW ===== */}
              {!isOpportunity && (
                <>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                    ניתן לשנות פרטים לפני ההמרה (השאר ריק לשימוש בנתוני הליד):
                  </p>

                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">שם הלקוח</label>
                      <input
                        type="text"
                        className="form-input"
                        value={form.override_name}
                        onChange={(e) => setForm({ ...form, override_name: e.target.value })}
                        placeholder={lead.name}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">אימייל</label>
                      <input
                        type="email"
                        className="form-input"
                        value={form.override_email}
                        onChange={(e) => setForm({ ...form, override_email: e.target.value })}
                        placeholder={lead.email || 'ללא'}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">טלפון</label>
                      <input
                        type="tel"
                        className="form-input"
                        value={form.override_phone}
                        onChange={(e) => setForm({ ...form, override_phone: e.target.value })}
                        placeholder={lead.phone || 'ללא'}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">כתובת (מחברה)</label>
                      <input
                        type="text"
                        className="form-input"
                        value={form.override_company}
                        onChange={(e) => setForm({ ...form, override_company: e.target.value })}
                        placeholder={lead.company || 'ללא'}
                      />
                    </div>
                  </div>

                  {/* Acquisition project options for new leads */}
                  <div style={{
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1rem',
                    marginTop: '1rem'
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500 }}>
                      <input
                        type="checkbox"
                        checked={createAcquisitionProject}
                        onChange={(e) => setCreateAcquisitionProject(e.target.checked)}
                      />
                      <Folder size={16} />
                      צור פרויקט רכישת לקוח
                    </label>

                    {createAcquisitionProject && (
                      <div style={{ marginTop: '0.75rem', paddingRight: '1.75rem' }}>
                        <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                          <label className="form-label" style={{ fontSize: '0.8rem' }}>שם הפרויקט</label>
                          <input
                            type="text"
                            className="form-input"
                            value={acquisitionProjectName}
                            onChange={(e) => setAcquisitionProjectName(e.target.value)}
                            placeholder={defaultProjectName}
                          />
                        </div>

                        {hasHistory && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            <input
                              type="checkbox"
                              checked={transferHistory}
                              onChange={(e) => setTransferHistory(e.target.checked)}
                            />
                            העבר היסטוריה (משימות ורשומות זמן) לפרויקט
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
                <button
                  className="btn btn-primary"
                  onClick={handleConvert}
                  disabled={loading}
                >
                  {loading ? 'ממיר...' : (isOpportunity ? 'המר לפרויקט' : 'המר ללקוח')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default LeadConvertModal;
