import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import { useModal } from '../components/Modal';
import { authAPI } from '../services/api';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPasswordResetModal, setShowPasswordResetModal] = useState(false);
  const [userId, setUserId] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const { login } = useStore();
  const navigate = useNavigate();
  const modal = useModal();
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const response = await login(email, password);
      console.log('Login response:', response);
      
      // Check if password reset is required
      if (response && response.requiresPasswordReset) {
        console.log('Password reset required! Opening modal...');
        setUserId(response.user.id);
        setCurrentPassword(password);
        setShowPasswordResetModal(true);
        setLoading(false);
        return;
      }
      
      console.log('Login successful, navigating to dashboard');
      
      // Check for pending invite code
      const pendingInviteCode = localStorage.getItem('pendingInviteCode');
      if (pendingInviteCode) {
        localStorage.removeItem('pendingInviteCode');
        navigate(`/join/${pendingInviteCode}`);
      } else {
        navigate('/');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  // Show password reset modal when needed
  useEffect(() => {
    if (!showPasswordResetModal) return;
    
    console.log('useEffect triggered - showing password reset modal');
    
    const doPasswordReset = async () => {
      console.log('handlePasswordReset called');
      const newPassword = await modal.prompt(
        'הזן סיסמה חדשה (לפחות 4 תווים):',
        { 
          title: 'נדרש איפוס סיסמה',
          placeholder: 'סיסמה חדשה',
          type: 'password'
        }
      );
      
      console.log('User entered password:', newPassword ? '[HIDDEN]' : 'null/cancelled');
      
      if (!newPassword) {
        // User cancelled - log them out
        console.log('User cancelled password reset');
        setShowPasswordResetModal(false);
        setError('חובה לשנות סיסמה כדי להמשיך');
        return;
      }
      
      if (newPassword.length < 4) {
        console.log('Password too short, asking again');
        await modal.error('סיסמה חייבת להכיל לפחות 4 תווים');
        // Try again
        setTimeout(() => doPasswordReset(), 100);
        return;
      }
      
      try {
        console.log('Calling resetPassword API...');
        await authAPI.resetPassword({
          userId,
          oldPassword: currentPassword,
          newPassword
        });
        
        console.log('Password reset successful');
        setShowPasswordResetModal(false);
        await modal.success('סיסמה שונתה בהצלחה!');
        navigate('/');
      } catch (err) {
        console.error('Password reset error:', err);
        await modal.error(err.message || 'שגיאה בשינוי סיסמה');
        // Try again
        setTimeout(() => doPasswordReset(), 100);
      }
    };
    
    doPasswordReset();
  }, [showPasswordResetModal, userId, currentPassword, modal, navigate]);
  
  return (
    <div>
      <h2 className="auth-title">התחברות</h2>
      
      {error && <div className="auth-error">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">שם משתמש / אימייל</label>
          <input
            type="text"
            className="form-input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={(e) => {
              // Allow Command+A / Ctrl+A to select all text
              if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
                e.preventDefault();
                e.target.select();
              }
            }}
            placeholder="admin או your@email.com"
            required
            dir="ltr"
          />
        </div>
        
        <div className="form-group">
          <label className="form-label">סיסמה</label>
          <input
            type="password"
            className="form-input"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={(e) => {
              // Allow Command+A / Ctrl+A to select all text
              if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
                e.preventDefault();
                e.target.select();
              }
            }}
            placeholder="••••••••"
            required
            dir="ltr"
          />
        </div>
        
        <button 
          type="submit" 
          className="btn btn-primary btn-lg" 
          style={{ width: '100%' }}
          disabled={loading}
        >
          {loading ? 'מתחבר...' : 'התחבר'}
        </button>
      </form>
      
      <div className="auth-footer">
        אין לך חשבון? <Link to="/register">הירשם עכשיו</Link>
      </div>
    </div>
  );
}

export default Login;

