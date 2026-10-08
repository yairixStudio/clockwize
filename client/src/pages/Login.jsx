import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import useStore from '../store/useStore';
import { useModal } from '../components/Modal';
import { authAPI, passkeysAPI } from '../services/api';

const RESET_REQUIRED_ERROR = 'חובה לשנות סיסמה כדי להמשיך';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const { login, completeAuth } = useStore();
  const navigate = useNavigate();
  const modal = useModal();
  const [searchParams] = useSearchParams();
  // The desktop app can't show the macOS passkey sheet, so it hands passkey sign-in to the
  // default browser (?passkey=desktop) and picks the session up from the server afterwards
  const desktop = window.clockwizeDesktop;
  const forDesktopApp = searchParams.get('passkey') === 'desktop';
  const [browserLoginPending, setBrowserLoginPending] = useState(false);

  const navigateAfterAuth = () => {
    const pendingInviteCode = localStorage.getItem('pendingInviteCode');
    if (pendingInviteCode) {
      localStorage.removeItem('pendingInviteCode');
      navigate(`/join/${pendingInviteCode}`);
    } else {
      navigate('/');
    }
  };

  const handlePasskeyLogin = async () => {
    setError('');
    setPasskeyLoading(true);

    try {
      const { flowId, options } = await passkeysAPI.loginOptions();
      const authResponse = await startAuthentication({ optionsJSON: options });
      const response = await passkeysAPI.loginVerify({ flowId, response: authResponse });
      if (response?.requiresPasswordReset) {
        setPasskeyLoading(false);
        await runForcedPasswordReset(response);
        return;
      }
      await completeAuth(response);
      navigateAfterAuth();
    } catch (err) {
      // NotAllowedError = the user closed the passkey dialog - not an error worth showing
      if (err?.name !== 'NotAllowedError') {
        setError(err.message || 'ההתחברות עם Passkey נכשלה');
      }
    } finally {
      setPasskeyLoading(false);
    }
  };
  
  const handlePasskeyClick = () => {
    if (desktop?.openBrowserLogin) {
      setError('');
      setBrowserLoginPending(true);
      desktop.openBrowserLogin();
      return;
    }
    handlePasskeyLogin();
  };

  // The admin flagged this account for a forced password reset. Instead of a session the server
  // sent a short-lived resetToken (useStore.completeAuth leaves the user logged out), so the user
  // only gets in after setting a new password here - the reset response is the session.
  const runForcedPasswordReset = async ({ resetToken }) => {
    for (;;) {
      const newPassword = await modal.prompt(
        'הזן סיסמה חדשה (לפחות 4 תווים):',
        {
          title: 'נדרש איפוס סיסמה',
          placeholder: 'סיסמה חדשה',
          inputType: 'password',
          autoComplete: 'new-password'
        }
      );

      if (!newPassword) {
        // Cancelled: stay logged out on the login page
        setError(RESET_REQUIRED_ERROR);
        return;
      }

      if (newPassword.length < 4) {
        await modal.error('סיסמה חייבת להכיל לפחות 4 תווים');
        continue;
      }

      let session;
      try {
        session = await authAPI.resetPassword({ resetToken, newPassword });
      } catch (err) {
        // Expired reset token (401) or too many attempts (429): asking again won't help - sign in again
        if (err.status === 401 || err.status === 429) {
          setError(err.message);
          return;
        }
        await modal.error(err.message || 'שגיאה בשינוי סיסמה');
        continue;
      }

      await modal.success('סיסמה שונתה בהצלחה!');
      await completeAuth(session);
      navigateAfterAuth();
      return;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    let response;
    try {
      response = await login(email, password);
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setLoading(false);

    if (response?.requiresPasswordReset) {
      await runForcedPasswordReset(response);
      return;
    }

    navigateAfterAuth();
  };
  
  return (
    <div>
      <h2 className="auth-title">התחברות</h2>
      
      {error && <div className="auth-error">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="login-email">שם משתמש / אימייל</label>
          <input
            id="login-email"
            autoComplete="username"
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
          <label className="form-label" htmlFor="login-password">סיסמה</label>
          <input
            id="login-password"
            autoComplete="current-password"
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

      {(browserSupportsWebAuthn() || desktop?.openBrowserLogin) && (
        <>
          <div className="auth-divider"><span>או</span></div>
          {forDesktopApp && (
            <p className="auth-hint" role="status">
              התחברות עבור אפליקציית Clockwize: לחצו על הכפתור ואשרו עם Touch ID. האפליקציה תתחבר לבד.
            </p>
          )}
          <button
            type="button"
            className={`btn btn-lg auth-passkey-btn ${forDesktopApp ? 'btn-primary' : 'btn-secondary'}`}
            onClick={handlePasskeyClick}
            disabled={passkeyLoading}
            autoFocus={forDesktopApp}
          >
            <KeyRound size={18} />
            <span>
              {passkeyLoading
                ? 'ממתין לאימות...'
                : browserLoginPending ? 'ממשיכים בדפדפן…' : 'התחבר עם Passkey'}
            </span>
          </button>
          {browserLoginPending && (
            <p className="auth-hint" role="status">
              נפתח דפדפן להתחברות עם Passkey. אחרי האישור שם, Clockwize יתחבר כאן אוטומטית.
            </p>
          )}
        </>
      )}

      <div className="auth-footer">
        אין לך חשבון? <Link to="/register">הירשם עכשיו</Link>
      </div>
    </div>
  );
}

export default Login;

