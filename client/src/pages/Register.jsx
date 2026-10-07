import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import useStore from '../store/useStore';
import { passkeysAPI } from '../services/api';

function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const { register, completeAuth } = useStore();
  const navigate = useNavigate();

  const navigateAfterAuth = () => {
    const pendingInviteCode = localStorage.getItem('pendingInviteCode');
    if (pendingInviteCode) {
      localStorage.removeItem('pendingInviteCode');
      navigate(`/join/${pendingInviteCode}`);
    } else {
      navigate('/');
    }
  };

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
      navigateAfterAuth();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeySignup = async () => {
    setError('');

    if (!name.trim() || !email.trim()) {
      setError('להרשמה עם Passkey יש למלא שם ואימייל');
      return;
    }

    setPasskeyLoading(true);

    try {
      const { flowId, options } = await passkeysAPI.signupOptions({ name: name.trim(), email: email.trim() });
      const regResponse = await startRegistration({ optionsJSON: options });
      const response = await passkeysAPI.signupVerify({ flowId, response: regResponse });
      await completeAuth(response);
      navigateAfterAuth();
    } catch (err) {
      // NotAllowedError = the user closed the passkey dialog - not an error worth showing
      if (err?.name !== 'NotAllowedError') {
        setError(err.message || 'ההרשמה עם Passkey נכשלה');
      }
    } finally {
      setPasskeyLoading(false);
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

      {browserSupportsWebAuthn() && (
        <>
          <div className="auth-divider"><span>או</span></div>
          <button
            type="button"
            className="btn btn-secondary btn-lg auth-passkey-btn"
            onClick={handlePasskeySignup}
            disabled={passkeyLoading}
          >
            <KeyRound size={18} />
            <span>{passkeyLoading ? 'ממתין לאימות...' : 'הירשם עם Passkey (ללא סיסמה)'}</span>
          </button>
          <p className="auth-passkey-hint">מלא שם ואימייל למעלה — סיסמה לא נדרשת</p>
        </>
      )}

      <div className="auth-footer">
        כבר יש לך חשבון? <Link to="/login">התחבר</Link>
      </div>
    </div>
  );
}

export default Register;

