import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { shareAPI } from '../services/api';
import { useModal } from './Modal';
import './ShareModal.css';

function ShareModal({ 
  resourceType, // 'client' or 'project'
  resourceId,
  resourceName,
  existingLinks = [],
  onClose,
  onSuccess
}) {
  const modal = useModal();
  const [shareType, setShareType] = useState('public');
  const [password, setPassword] = useState('');
  const [allowedEmail, setAllowedEmail] = useState('');
  const [linkName, setLinkName] = useState('');
  const [loading, setLoading] = useState(false);
  const [links, setLinks] = useState(existingLinks);
  const [editingLink, setEditingLink] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(existingLinks.length === 0);

  useEffect(() => {
    loadLinks();
  }, []);

  const loadLinks = async () => {
    try {
      const allLinks = await shareAPI.getMyLinks();
      const filtered = allLinks.filter(
        link => link.resource_type === resourceType && link.resource_id === resourceId
      );
      setLinks(filtered);
      setShowCreateForm(filtered.length === 0);
    } catch (error) {
      console.error('Failed to load links:', error);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await shareAPI.create({
        resource_type: resourceType,
        resource_id: resourceId,
        share_type: shareType,
        password: shareType === 'password' ? password : undefined,
        allowed_email: shareType === 'email' ? allowedEmail : undefined,
        name: linkName || undefined
      });

      modal.success('לינק השיתוף נוצר בהצלחה');
      await loadLinks();
      setShowCreateForm(false);
      resetForm();
      onSuccess?.();
    } catch (error) {
      modal.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (link) => {
    setLoading(true);

    try {
      await shareAPI.update(link.id, {
        share_type: link.share_type,
        password: link.share_type === 'password' && link.newPassword ? link.newPassword : undefined,
        allowed_email: link.share_type === 'email' ? link.allowed_email : undefined,
        name: link.name,
        is_active: link.is_active
      });

      modal.success('הלינק עודכן בהצלחה');
      await loadLinks();
      setEditingLink(null);
      onSuccess?.();
    } catch (error) {
      modal.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (linkId) => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך למחוק את הלינק?',
      { title: 'מחיקת לינק', confirmText: 'מחק', type: 'error' }
    );

    if (confirmed) {
      try {
        await shareAPI.delete(linkId);
        modal.success('הלינק נמחק בהצלחה');
        await loadLinks();
        onSuccess?.();
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  const handleToggleActive = async (link) => {
    try {
      await shareAPI.update(link.id, { is_active: !link.is_active });
      modal.success(link.is_active ? 'הלינק הושבת' : 'הלינק הופעל');
      await loadLinks();
      onSuccess?.();
    } catch (error) {
      modal.error(error.message);
    }
  };

  const resetForm = () => {
    setShareType('public');
    setPassword('');
    setAllowedEmail('');
    setLinkName('');
  };

  const copyLink = (token) => {
    const url = `${window.location.origin}/s/${token}`;
    navigator.clipboard.writeText(url);
    modal.success('הלינק הועתק!');
  };

  const getShareTypeLabel = (type) => {
    switch (type) {
      case 'public': return 'ציבורי';
      case 'password': return 'מוגן סיסמא';
      case 'email': return 'מוגבל למייל';
      default: return type;
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal share-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">שיתוף {resourceType === 'client' ? 'לקוח' : 'פרויקט'}</h3>
          <button onClick={onClose} className="btn btn-ghost btn-icon">✕</button>
        </div>

        <div className="modal-body">
          <p className="share-resource-name">
            <strong>{resourceName}</strong>
          </p>

          {/* Existing Links */}
          {links.length > 0 && (
            <div className="existing-links">
              <h3>לינקים קיימים</h3>
              
              {links.map(link => (
                <div key={link.id} className={`link-item ${!link.is_active ? 'inactive' : ''}`}>
                  {editingLink?.id === link.id ? (
                    // Edit mode
                    <div className="link-edit-form">
                      <div className="form-group">
                        <label>שם הלינק</label>
                        <input
                          type="text"
                          className="form-input"
                          value={editingLink.name || ''}
                          onChange={e => setEditingLink({ ...editingLink, name: e.target.value })}
                          placeholder="שם לזיהוי הלינק"
                        />
                      </div>

                      <div className="form-group">
                        <label>סוג הגנה</label>
                        <select
                          className="form-input"
                          value={editingLink.share_type}
                          onChange={e => setEditingLink({ ...editingLink, share_type: e.target.value })}
                        >
                          <option value="public">ציבורי - כל מי שיש לו את הלינק</option>
                          <option value="password">מוגן סיסמא</option>
                          <option value="email">מוגבל לכתובת מייל</option>
                        </select>
                      </div>

                      {editingLink.share_type === 'password' && (
                        <div className="form-group">
                          <label>סיסמא חדשה (השאר ריק לשמירת הקיימת)</label>
                          <input
                            type="password"
                            className="form-input"
                            value={editingLink.newPassword || ''}
                            onChange={e => setEditingLink({ ...editingLink, newPassword: e.target.value })}
                            placeholder="סיסמא חדשה"
                          />
                        </div>
                      )}

                      {editingLink.share_type === 'email' && (
                        <div className="form-group">
                          <label>כתובת מייל מורשית</label>
                          <input
                            type="email"
                            className="form-input ltr"
                            value={editingLink.allowed_email || ''}
                            onChange={e => setEditingLink({ ...editingLink, allowed_email: e.target.value })}
                            placeholder="email@example.com"
                          />
                        </div>
                      )}

                      <div className="link-edit-actions">
                        <button 
                          className="btn btn-primary btn-sm"
                          onClick={() => handleUpdate(editingLink)}
                          disabled={loading}
                        >
                          שמור
                        </button>
                        <button 
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditingLink(null)}
                        >
                          ביטול
                        </button>
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <>
                      <div className="link-info">
                        <div className="link-header">
                          <span className="link-name">{link.name || 'לינק ללא שם'}</span>
                          <span className={`link-badge ${link.share_type}`}>
                            {getShareTypeLabel(link.share_type)}
                          </span>
                          {!link.is_active && (
                            <span className="link-badge inactive">מושבת</span>
                          )}
                        </div>
                        
                        {link.allowed_email && (
                          <div className="link-email ltr">{link.allowed_email}</div>
                        )}
                        
                        <div className="link-url ltr" onClick={() => copyLink(link.share_token)}>
                          {`${window.location.origin}/s/${link.share_token}`}
                        </div>
                      </div>

                      <div className="link-actions">
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => copyLink(link.share_token)}
                          title="העתק לינק"
                        >
                          📋
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => setEditingLink({ ...link })}
                          title="ערוך"
                        >
                          ✏️
                        </button>
                        <button
                          className={`btn btn-ghost btn-icon btn-sm ${link.is_active ? '' : 'text-success'}`}
                          onClick={() => handleToggleActive(link)}
                          title={link.is_active ? 'השבת' : 'הפעל'}
                        >
                          {link.is_active ? '⏸️' : '▶️'}
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm text-danger"
                          onClick={() => handleDelete(link.id)}
                          title="מחק"
                        >
                          🗑️
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Create New Link Form */}
          {showCreateForm ? (
            <form onSubmit={handleCreate} className="create-link-form">
              <h3>{links.length > 0 ? 'צור לינק נוסף' : 'צור לינק שיתוף'}</h3>

              <div className="form-group">
                <label>שם הלינק (אופציונלי)</label>
                <input
                  type="text"
                  className="form-input"
                  value={linkName}
                  onChange={e => setLinkName(e.target.value)}
                  placeholder="שם לזיהוי הלינק"
                />
              </div>

              <div className="form-group">
                <label>סוג הגנה</label>
                <div className="share-type-options">
                  <label className={`share-type-option ${shareType === 'public' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="shareType"
                      value="public"
                      checked={shareType === 'public'}
                      onChange={e => setShareType(e.target.value)}
                    />
                    <span className="option-icon">🌐</span>
                    <span className="option-label">ציבורי</span>
                    <span className="option-desc">כל מי שיש לו את הלינק</span>
                  </label>

                  <label className={`share-type-option ${shareType === 'password' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="shareType"
                      value="password"
                      checked={shareType === 'password'}
                      onChange={e => setShareType(e.target.value)}
                    />
                    <span className="option-icon">🔒</span>
                    <span className="option-label">מוגן סיסמא</span>
                    <span className="option-desc">נדרשת סיסמא לצפייה</span>
                  </label>

                  <label className={`share-type-option ${shareType === 'email' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="shareType"
                      value="email"
                      checked={shareType === 'email'}
                      onChange={e => setShareType(e.target.value)}
                    />
                    <span className="option-icon">📧</span>
                    <span className="option-label">פרטי למייל</span>
                    <span className="option-desc">רק משתמש עם המייל יכול לצפות</span>
                  </label>
                </div>
              </div>

              {shareType === 'password' && (
                <div className="form-group">
                  <label>סיסמא לצפייה</label>
                  <input
                    type="password"
                    className="form-input"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="הזן סיסמא"
                    required
                  />
                </div>
              )}

              {shareType === 'email' && (
                <div className="form-group">
                  <label>כתובת מייל מורשית</label>
                  <input
                    type="email"
                    className="form-input ltr"
                    value={allowedEmail}
                    onChange={e => setAllowedEmail(e.target.value)}
                    placeholder="email@example.com"
                    required
                  />
                  <small className="form-hint">
                    רק משתמש שנכנס עם כתובת מייל זו יוכל לצפות בלינק
                  </small>
                </div>
              )}

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'יוצר...' : 'צור לינק'}
                </button>
                {links.length > 0 && (
                  <button 
                    type="button" 
                    className="btn btn-ghost"
                    onClick={() => { setShowCreateForm(false); resetForm(); }}
                  >
                    ביטול
                  </button>
                )}
              </div>
            </form>
          ) : (
            <button 
              className="btn btn-secondary add-link-btn"
              onClick={() => setShowCreateForm(true)}
            >
              + הוסף לינק שיתוף נוסף
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ShareModal;

