import React, { useState, useEffect } from 'react';
import { Shield, Key, Users as UsersIcon, Lock, Trash2, Ban, CheckCircle, KeyRound } from 'lucide-react';
import { adminAPI } from '../services/api';
import { formatDateTime } from '../utils/format';
import useStore from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { useModal } from '../components/Modal';
import './AdminPanel.css';

const AdminPanel = () => {
  const navigate = useNavigate();
  const modal = useModal();
  const { user, login } = useStore();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.is_admin) {
      navigate('/');
      return;
    }
    loadUsers();
  }, [user, navigate]);

  const loadUsers = async () => {
    try {
      const data = await adminAPI.getUsers();
      setUsers(data);
    } catch (error) {
      console.error('Error loading users:', error);
      alert('שגיאה בטעינת משתמשים');
    } finally {
      setLoading(false);
    }
  };

  const handleImpersonate = async (userId) => {
    try {
      const { user: impersonatedUser, token } = await adminAPI.impersonate(userId);
      localStorage.setItem('token', token);
      
      // Update store with impersonated user
      useStore.setState({ 
        user: impersonatedUser, 
        isAuthenticated: true 
      });
      
      // Navigate to dashboard
      navigate('/');
      window.location.reload(); // Force refresh to load user data
    } catch (error) {
      console.error('Error impersonating user:', error);
      alert('שגיאה בהתחברות למשתמש');
    }
  };

  const handleForcePasswordReset = async (userId, userName) => {
    const confirmed = await modal.confirm(
      `בהתחברות הבאה של ${userName}, המערכת תדרוש ממנו להגדיר סיסמה חדשה.`,
      { 
        title: `דרוש סיסמה חדשה בהתחברות הבאה`, 
        confirmText: 'אישור',
        type: 'warning'
      }
    );

    if (!confirmed) {
      console.log('User cancelled force password reset');
      return;
    }

    console.log(`Forcing password reset for user: ${userId} (${userName})`);
    try {
      await adminAPI.forcePasswordReset(userId);
      await loadUsers(); // Refresh immediately
      modal.success(`בהתחברות הבאה, ${userName} יידרש להגדיר סיסמה חדשה`);
    } catch (error) {
      console.error('Error forcing password reset:', error);
      modal.error(error.message || 'שגיאה בדרישת שינוי סיסמה');
    }
  };

  const handleSetPassword = async (userId, userName) => {
    const password = await modal.prompt(
      'הזן סיסמה חדשה (לפחות 4 תווים):',
      { 
        title: `הגדרת סיסמה ל-${userName}`,
        placeholder: 'סיסמה חדשה',
        type: 'password'
      }
    );
    
    // If user cancelled
    if (password === null || password === undefined) {
      console.log('User cancelled password change');
      return;
    }
    
    // If password is empty
    if (!password || password.trim() === '') {
      modal.error('חייב להזין סיסמה');
      return;
    }

    if (password.length < 4) {
      modal.error('סיסמה חייבת להכיל לפחות 4 תווים');
      return;
    }

    console.log(`Setting password for user: ${userId} (${userName})`);
    try {
      await adminAPI.setPassword(userId, password);
      await loadUsers(); // Refresh immediately
      modal.success('סיסמה שונתה בהצלחה');
    } catch (error) {
      console.error('Error setting password:', error);
      modal.error(error.message || 'שגיאה בשינוי סיסמה');
    }
  };

  const handleToggleActive = async (userId, userName, isActive) => {
    const action = isActive ? 'להשהות' : 'להפעיל';
    const status = isActive ? 'לא יוכל להתחבר למערכת' : 'יוכל להתחבר למערכת';
    
    const confirmed = await modal.confirm(
      status,
      { 
        title: `${action} את חשבון ${userName}?`, 
        confirmText: action,
        type: isActive ? 'warning' : 'info'
      }
    );

    if (!confirmed) {
      console.log('User cancelled toggle active');
      return;
    }

    console.log(`Toggling active status for user: ${userId} (${userName}) - current: ${isActive}`);
    try {
      await adminAPI.toggleActive(userId);
      await loadUsers(); // Refresh immediately
      modal.success(isActive ? 'חשבון הושהה בהצלחה' : 'חשבון הופעל בהצלחה');
    } catch (error) {
      console.error('Error toggling active status:', error);
      modal.error(error.message || 'שגיאה בשינוי סטטוס חשבון');
    }
  };

  const handleDeleteUser = async (userId, userName) => {
    const confirmed = await modal.confirm(
      `אזהרה: פעולה זו תמחק את כל הנתונים של המשתמש:\n- לקוחות\n- פרויקטים\n- משימות\n- רשומות זמן\n\nפעולה זו אינה ניתנת לביטול!`,
      { 
        title: `מחיקת חשבון ${userName}`, 
        confirmText: 'מחק לצמיתות',
        type: 'error'
      }
    );

    if (!confirmed) {
      return;
    }

    const confirmation = await modal.prompt(
      `כדי לאשר מחיקה, הקלד את שם המשתמש:`,
      { 
        title: `אישור מחיקת ${userName}`,
        placeholder: userName
      }
    );
    
    // If user cancelled the prompt
    if (confirmation === null || confirmation === undefined) {
      console.log('User cancelled deletion');
      return;
    }
    
    // Trim and compare
    const cleanConfirmation = confirmation.trim();
    const cleanUserName = userName.trim();
    
    if (cleanConfirmation !== cleanUserName) {
      console.log(`Mismatch: "${cleanConfirmation}" !== "${cleanUserName}"`);
      modal.error(`שם המשתמש אינו תואם.\nהוקלד: "${cleanConfirmation}"\nנדרש: "${cleanUserName}"`);
      return;
    }

    console.log(`Deleting user: ${userId} (${userName})`);
    try {
      await adminAPI.deleteUser(userId);
      await loadUsers(); // Refresh immediately
      modal.success('חשבון נמחק בהצלחה');
    } catch (error) {
      console.error('Error deleting user:', error);
      modal.error(error.message || 'שגיאה במחיקת חשבון');
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="admin-panel page fade-in">
      <div className="admin-header">
        <div className="admin-title-wrapper">
          <Shield size={32} className="admin-icon" />
          <div>
            <h1>פאנל ניהול</h1>
            <p>רשימת כל המשתמשים במערכת</p>
          </div>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="users-table-container card">
        <table className="users-table">
          <thead>
            <tr>
              <th>שם</th>
              <th>אימייל</th>
              <th>תאריך הצטרפות</th>
              <th>סטטוס</th>
              <th>לקוחות</th>
              <th>פרויקטים</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className={u.is_active === 0 ? 'inactive-user' : ''}>
                <td data-label="שם">
                  <div className="user-name-cell">
                    <div className="user-avatar-placeholder">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="user-name-text">{u.name}</div>
                      {u.force_password_reset === 1 && (
                        <span className="status-badge warning-badge" title="בהתחברות הבאה יידרש להחליף סיסמה">
                          <Lock size={10} />
                          <span>איפוס סיסמה</span>
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td data-label="אימייל" className="ltr email-cell">{u.email}</td>
                <td data-label="הצטרף בתאריך">{formatDateTime(u.created_at)}</td>
                <td data-label="סטטוס">
                  <span className={`status-badge ${u.is_active ? 'badge-success' : 'badge-error'}`}>
                    {u.is_active ? 'פעיל' : 'מושהה'}
                  </span>
                </td>
                <td data-label="לקוחות">{u.client_count || 0}</td>
                <td data-label="פרויקטים">{u.project_count || 0}</td>
                <td data-label="פעולות">
                  <div className="admin-actions">
                    <button
                      onClick={() => handleImpersonate(u.id)}
                      className="btn btn-primary btn-sm"
                      title="התחבר כמשתמש זה"
                    >
                      <Key size={16} />
                    </button>
                    <button
                      onClick={() => handleForcePasswordReset(u.id, u.name)}
                      className="btn btn-secondary btn-sm"
                      title="בהתחברות הבאה דרוש סיסמה חדשה"
                      disabled={u.force_password_reset === 1}
                    >
                      <Lock size={16} />
                    </button>
                    <button
                      onClick={() => handleSetPassword(u.id, u.name)}
                      className="btn btn-secondary btn-sm"
                      title="הגדר סיסמה חדשה"
                    >
                      <KeyRound size={16} />
                    </button>
                    <button
                      onClick={() => handleToggleActive(u.id, u.name, u.is_active)}
                      className={`btn ${u.is_active ? 'btn-warning' : 'btn-success'} btn-sm`}
                      title={u.is_active ? 'השהה חשבון' : 'הפעל חשבון'}
                    >
                      {u.is_active ? <Ban size={16} /> : <CheckCircle size={16} />}
                    </button>
                    <button
                      onClick={() => handleDeleteUser(u.id, u.name)}
                      className="btn btn-danger btn-sm"
                      title="מחק חשבון"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="users-cards">
        {users.map(u => (
          <div key={u.id} className={`user-card${u.is_active === 0 ? ' inactive' : ''}`}>
            <div className="user-card-header">
              <div className="user-card-avatar">
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="user-card-identity">
                <div className="user-card-name">{u.name}</div>
                <div className="user-card-email">{u.email}</div>
              </div>
              <div className="user-card-status">
                <span className={`status-badge ${u.is_active ? 'badge-success' : 'badge-error'}`}>
                  {u.is_active ? 'פעיל' : 'מושהה'}
                </span>
              </div>
            </div>

            {u.force_password_reset === 1 && (
              <div className="user-card-badges">
                <span className="status-badge warning-badge">
                  <Lock size={10} />
                  <span>איפוס סיסמה בהתחברות הבאה</span>
                </span>
              </div>
            )}

            <div className="user-card-details">
              <div className="user-card-stat">
                <div className="user-card-stat-value">{formatDateTime(u.created_at).split(' ')[0]}</div>
                <div className="user-card-stat-label">הצטרפות</div>
              </div>
              <div className="user-card-stat">
                <div className="user-card-stat-value">{u.client_count || 0}</div>
                <div className="user-card-stat-label">לקוחות</div>
              </div>
              <div className="user-card-stat">
                <div className="user-card-stat-value">{u.project_count || 0}</div>
                <div className="user-card-stat-label">פרויקטים</div>
              </div>
            </div>

            <div className="user-card-actions">
              <button
                className="user-card-action user-card-action--primary"
                onClick={() => handleImpersonate(u.id)}
              >
                <span className="user-card-action-icon"><Key size={16} /></span>
                <span className="user-card-action-label">התחבר</span>
              </button>
              <button
                className="user-card-action user-card-action--lock"
                onClick={() => handleForcePasswordReset(u.id, u.name)}
                disabled={u.force_password_reset === 1}
              >
                <span className="user-card-action-icon"><Lock size={16} /></span>
                <span className="user-card-action-label">דרוש איפוס</span>
              </button>
              <button
                className="user-card-action user-card-action--key"
                onClick={() => handleSetPassword(u.id, u.name)}
              >
                <span className="user-card-action-icon"><KeyRound size={16} /></span>
                <span className="user-card-action-label">סיסמה</span>
              </button>
              <button
                className={`user-card-action user-card-action--toggle${u.is_active ? ' suspend' : ''}`}
                onClick={() => handleToggleActive(u.id, u.name, u.is_active)}
              >
                <span className="user-card-action-icon">
                  {u.is_active ? <Ban size={16} /> : <CheckCircle size={16} />}
                </span>
                <span className="user-card-action-label">{u.is_active ? 'השהה' : 'הפעל'}</span>
              </button>
              <button
                className="user-card-action user-card-action--delete"
                onClick={() => handleDeleteUser(u.id, u.name)}
              >
                <span className="user-card-action-icon"><Trash2 size={16} /></span>
                <span className="user-card-action-label">מחק</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminPanel;

