import { Outlet } from 'react-router-dom';
import './AuthLayout.css';

function AuthLayout() {
  return (
    <div className="auth-layout">
      <div className="auth-background">
        <div className="auth-shape auth-shape-1"></div>
        <div className="auth-shape auth-shape-2"></div>
        <div className="auth-shape auth-shape-3"></div>
      </div>
      
      <div className="auth-container">
        <div className="auth-logo">
          <svg viewBox="0 0 100 100" className="auth-logo-icon">
            <circle cx="50" cy="50" r="45" fill="currentColor" opacity="0.15"/>
            <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
            <line x1="50" y1="50" x2="50" y2="22" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
            <line x1="50" y1="50" x2="70" y2="50" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.7"/>
            <circle cx="50" cy="50" r="4" fill="currentColor"/>
          </svg>
          <h1 className="auth-logo-text">Clockwize</h1>
          <p className="auth-tagline">ניהול זמן חכם לפרילנסרים</p>
        </div>
        
        <div className="auth-card">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;

