import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Save, Trash2, AlertTriangle } from 'lucide-react';
import useStore from '../store/useStore';
import { authAPI } from '../services/api';
import { useModal } from '../components/Modal';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import './Profile.css';

function Profile() {
  const { user, updateUser, logout } = useStore();
  const navigate = useNavigate();
  const modal = useModal();
  
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    currentPassword: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  
  // Lock body scroll when delete modal is open
  useBodyScrollLock(showDeleteModal);
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });
    
    if (formData.password && formData.password !== formData.confirmPassword) {
      setMessage({ type: 'error', text: 'הסיסמאות לא תואמות' });
      return;
    }
    
    if (formData.password && formData.password.length < 6) {
      setMessage({ type: 'error', text: 'הסיסמה חייבת להכיל לפחות 6 תווים' });
      return;
    }
    
    setLoading(true);
    
    try {
      const updateData = {
        name: formData.name,
        email: formData.email
      };
      
      if (formData.password) {
        updateData.currentPassword = formData.currentPassword;
        updateData.password = formData.password;
      }
      
      const updatedUser = await authAPI.updateProfile(updateData);
      updateUser(updatedUser);
      
      modal.success('הפרופיל עודכן בהצלחה');
      setFormData(prev => ({
        ...prev,
        currentPassword: '',
        password: '',
        confirmPassword: ''
      }));
    } catch (error) {
      modal.error(error.message);
    } finally {
      setLoading(false);
    }
  };
  
  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      modal.warning('נא להזין סיסמה');
      return;
    }
    
    try {
      await authAPI.deleteAccount(deletePassword);
      logout();
      navigate('/login');
    } catch (error) {
      modal.error(error.message);
    }
  };
  
  return (
    <div className="page fade-in">
      <div className="page-header">
        <h1 className="page-title">הגדרות פרופיל</h1>
        <p className="page-subtitle">עדכון פרטים אישיים והגדרות חשבון</p>
      </div>
      
      <div className="profile-content">
        <form onSubmit={handleSubmit} className="profile-form card">
          {message.text && (
            <div className={`message ${message.type}`}>
              {message.text}
            </div>
          )}
          
          <div className="form-section">
            <h3 className="form-section-title">פרטים אישיים</h3>
            
            <div className="form-group">
              <label className="form-label">שם מלא</label>
              <input
                type="text"
                name="name"
                className="form-input"
                value={formData.name}
                onChange={handleChange}
                required
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">אימייל</label>
              <input
                type="email"
                name="email"
                className="form-input"
                value={formData.email}
                onChange={handleChange}
                required
                dir="ltr"
              />
            </div>
          </div>
          
          <div className="form-section">
            <h3 className="form-section-title">שינוי סיסמה</h3>
            
            <div className="form-group">
              <label className="form-label">סיסמה נוכחית</label>
              <input
                type="password"
                name="currentPassword"
                className="form-input"
                value={formData.currentPassword}
                onChange={handleChange}
                dir="ltr"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">סיסמה חדשה</label>
              <input
                type="password"
                name="password"
                className="form-input"
                value={formData.password}
                onChange={handleChange}
                placeholder="השאר ריק אם אינך רוצה לשנות"
                dir="ltr"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">אימות סיסמה חדשה</label>
              <input
                type="password"
                name="confirmPassword"
                className="form-input"
                value={formData.confirmPassword}
                onChange={handleChange}
                dir="ltr"
              />
            </div>
          </div>
          
          <button type="submit" className="btn btn-primary" disabled={loading}>
            <Save size={18} />
            <span>{loading ? 'שומר...' : 'שמור שינויים'}</span>
          </button>
        </form>
        
        <div className="danger-zone card">
          <h3 className="danger-title">אזור סכנה</h3>
          <p className="danger-description">
            מחיקת החשבון היא בלתי הפיכה. כל הנתונים שלך יימחקו לצמיתות.
          </p>
          <button onClick={() => setShowDeleteModal(true)} className="btn btn-danger">
            <Trash2 size={22} />
            <span>מחק את החשבון</span>
          </button>
        </div>
      </div>
      
      {showDeleteModal && createPortal(
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">מחיקת חשבון</h3>
              <button onClick={() => setShowDeleteModal(false)} className="btn btn-ghost btn-icon">✕</button>
            </div>
            <div className="modal-body">
              <div className="delete-warning">
                <AlertTriangle size={24} className="warning-icon" />
                <p>פעולה זו היא בלתי הפיכה. כל הלקוחות, הפרויקטים, המשימות ורשומות הזמן שלך יימחקו לצמיתות.</p>
              </div>
              
              <div className="form-group">
                <label className="form-label">הזן את הסיסמה שלך לאישור</label>
                <input
                  type="password"
                  className="form-input"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  dir="ltr"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={handleDeleteAccount} className="btn btn-danger">
                <Trash2 size={22} />
                <span>מחק את החשבון לצמיתות</span>
              </button>
              <button onClick={() => setShowDeleteModal(false)} className="btn btn-secondary">
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

export default Profile;
