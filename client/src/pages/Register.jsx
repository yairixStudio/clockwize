import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';

function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useStore();
  const navigate = useNavigate();
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (password !== confirmPassword) {
      setError('הסיסמאות לא תואמות');
      return;
    }
    
    if (password.length < 6) {
      setError('הסיסמה חייבת להכיל לפחות 6 תווים');
      return;
    }
    
    setLoading(true);
    
    try {
      await register(name, email, password);
      
      // Check for pending invite code
      const pendingInviteCode = localStorage.getItem('pendingInviteCode');
      if (pendingInviteCode) {
        localStorage.removeItem('pendingInviteCode');
        navigate(`/join/${pendingInviteCode}`);
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div>
      <h2 className="auth-title">הרשמה</h2>
      
      {error && <div className="auth-error">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">שם מלא</label>
          <input
            type="text"
            className="form-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="השם שלך"
            required
          />
        </div>
        
        <div className="form-group">
          <label className="form-label">אימייל</label>
          <input
            type="email"
            className="form-input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
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
            placeholder="לפחות 6 תווים"
            required
            dir="ltr"
          />
        </div>
        
        <div className="form-group">
          <label className="form-label">אימות סיסמה</label>
          <input
            type="password"
            className="form-input"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="הקלד שוב את הסיסמה"
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
          {loading ? 'נרשם...' : 'הירשם'}
        </button>
      </form>
      
      <div className="auth-footer">
        כבר יש לך חשבון? <Link to="/login">התחבר</Link>
      </div>
    </div>
  );
}

export default Register;

