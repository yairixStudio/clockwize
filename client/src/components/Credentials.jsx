import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Key, Eye, EyeOff, Copy, ExternalLink, Plus, Edit2, Trash2 } from 'lucide-react';

function CredentialModal({ isOpen, onClose, onSave, credential, clientId, projectId }) {
    const [formData, setFormData] = useState({
        service_name: '',
        username: '',
        password: '',
        url: '',
        notes: ''
    });
    const [showPassword, setShowPassword] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (credential) {
            setFormData({
                service_name: credential.service_name || '',
                username: credential.username || '',
                password: credential.password || '',
                url: credential.url || '',
                notes: credential.notes || ''
            });
        } else {
            setFormData({
                service_name: '',
                username: '',
                password: '',
                url: '',
                notes: ''
            });
        }
        setShowPassword(false);
    }, [credential, isOpen]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await onSave({
                ...formData,
                client_id: clientId,
                project_id: projectId
            });
            onClose();
        } catch (error) {
            console.error('Error saving credential:', error);
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal credential-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">{credential ? 'ערוך סיסמה' : 'הוסף סיסמה חדשה'}</h3>
                    <button onClick={onClose} className="btn btn-ghost btn-icon">✕</button>
                </div>

                <form onSubmit={handleSubmit} className="modal-content">
                    <div className="form-group">
                        <label>שם השירות *</label>
                        <input
                            type="text"
                            value={formData.service_name}
                            onChange={e => setFormData({ ...formData, service_name: e.target.value })}
                            placeholder="למשל: Hosting, GitHub, Domain..."
                            required
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label>שם משתמש / אימייל</label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={e => setFormData({ ...formData, username: e.target.value })}
                            placeholder="שם משתמש או כתובת אימייל"
                        />
                    </div>

                    <div className="form-group">
                        <label>סיסמה</label>
                        <div className="password-input-wrapper">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password}
                                onChange={e => setFormData({ ...formData, password: e.target.value })}
                                placeholder="הכנס סיסמה"
                            />
                            <button
                                type="button"
                                className="password-toggle"
                                onClick={() => setShowPassword(!showPassword)}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    <div className="form-group">
                        <label>כתובת URL</label>
                        <input
                            type="url"
                            value={formData.url}
                            onChange={e => setFormData({ ...formData, url: e.target.value })}
                            placeholder="https://..."
                            dir="ltr"
                        />
                    </div>

                    <div className="form-group">
                        <label>הערות</label>
                        <textarea
                            value={formData.notes}
                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                            placeholder="הערות נוספות..."
                            rows={3}
                        />
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>
                            ביטול
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'שומר...' : (credential ? 'עדכן' : 'הוסף')}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}

function CredentialsSection({ credentials, onAdd, onEdit, onDelete, loading }) {
    const [visiblePasswords, setVisiblePasswords] = useState({});
    const [copiedField, setCopiedField] = useState(null);

    const togglePasswordVisibility = (id) => {
        setVisiblePasswords(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const copyToClipboard = async (text, fieldId) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(fieldId);
            setTimeout(() => setCopiedField(null), 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
        }
    };

    if (loading) {
        return (
            <div className="credentials-loading">
                <div className="spinner"></div>
                <span>טוען סיסמאות...</span>
            </div>
        );
    }

    return (
        <div className="credentials-section">
            <div className="credentials-list">
                {/* New Credential Button - List Style */}
                <button
                    onClick={onAdd}
                    className="list-item new-credential-list-item"
                >
                    <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
                    <span style={{ fontWeight: 500 }}>צור סיסמה חדשה</span>
                </button>

            {credentials.length === 0 ? (
                <div className="empty-state card">
                    <div className="empty-state-icon">
                        <Key size={48} strokeWidth={1.5} />
                    </div>
                    <h3 className="empty-state-title">עדיין אין סיסמאות שמורות</h3>
                    <p>הוסף פרטי גישה לשירותים שונים כאן</p>
                </div>
            ) : (
                    credentials.map(cred => (
                        <div key={cred.id} className="credential-card card">
                            <div className="credential-header">
                                <div className="credential-service">
                                    <Key size={18} className="credential-icon" />
                                    <span className="credential-name">{cred.service_name}</span>
                                </div>
                                <div className="credential-actions">
                                    <button
                                        onClick={() => onEdit(cred)}
                                        className="btn btn-ghost btn-icon btn-sm"
                                        title="ערוך"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                    <button
                                        onClick={() => onDelete(cred.id)}
                                        className="btn btn-ghost btn-icon btn-sm"
                                        title="מחק"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="credential-details">
                                {cred.username && (
                                    <div className="credential-field">
                                        <span className="field-label">שם משתמש:</span>
                                        <div className="field-value-wrapper">
                                            <span className="field-value">{cred.username}</span>
                                            <button
                                                onClick={() => copyToClipboard(cred.username, `username-${cred.id}`)}
                                                className={`copy-btn ${copiedField === `username-${cred.id}` ? 'copied' : ''}`}
                                                title="העתק"
                                            >
                                                <Copy size={14} />
                                                {copiedField === `username-${cred.id}` && <span className="copied-text">הועתק!</span>}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {cred.password && (
                                    <div className="credential-field">
                                        <span className="field-label">סיסמה:</span>
                                        <div className="field-value-wrapper">
                                            <span className="field-value password-value">
                                                {visiblePasswords[cred.id] ? cred.password : '••••••••'}
                                            </span>
                                            <button
                                                onClick={() => togglePasswordVisibility(cred.id)}
                                                className="toggle-btn"
                                                title={visiblePasswords[cred.id] ? 'הסתר' : 'הצג'}
                                            >
                                                {visiblePasswords[cred.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                            <button
                                                onClick={() => copyToClipboard(cred.password, `password-${cred.id}`)}
                                                className={`copy-btn ${copiedField === `password-${cred.id}` ? 'copied' : ''}`}
                                                title="העתק"
                                            >
                                                <Copy size={14} />
                                                {copiedField === `password-${cred.id}` && <span className="copied-text">הועתק!</span>}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {cred.url && (
                                    <div className="credential-field">
                                        <span className="field-label">כתובת:</span>
                                        <div className="field-value-wrapper">
                                            <a href={cred.url} target="_blank" rel="noopener noreferrer" className="field-value url-value">
                                                {cred.url}
                                                <ExternalLink size={12} />
                                            </a>
                                        </div>
                                    </div>
                                )}

                                {cred.notes && (
                                    <div className="credential-field notes-field">
                                        <span className="field-label">הערות:</span>
                                        <span className="field-value notes-value">{cred.notes}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
            )}
            </div>
        </div>
    );
}

export { CredentialModal, CredentialsSection };
