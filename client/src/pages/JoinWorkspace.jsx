import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Building2, Users, Check, AlertCircle, LogIn } from 'lucide-react';
import useStore from '../store/useStore';
import { workspacesAPI } from '../services/api';
import './JoinWorkspace.css';

function JoinWorkspace() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, loadWorkspaces, setCurrentWorkspace } = useStore();
  
  const [inviteInfo, setInviteInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadInviteInfo();
  }, [code]);

  const loadInviteInfo = async () => {
    try {
      const info = await workspacesAPI.getInviteInfo(code);
      setInviteInfo(info);
    } catch (err) {
      setError(err.message || 'הזמנה לא תקינה או שפג תוקפה');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!isAuthenticated) {
      // Save invite code and redirect to login
      localStorage.setItem('pendingInviteCode', code);
      navigate('/login');
      return;
    }

    setJoining(true);
    try {
      const result = await workspacesAPI.joinByCode(code);
      setSuccess(true);
      
      // Reload workspaces and switch to new one
      await loadWorkspaces();
      
      // Wait a moment then redirect
      setTimeout(() => {
        if (result.workspace) {
          setCurrentWorkspace(result.workspace);
        }
        navigate('/');
      }, 1500);
    } catch (err) {
      setError(err.message || 'שגיאה בהצטרפות');
      setJoining(false);
    }
  };

  const getRoleLabel = (role) => {
    switch (role) {
      case 'owner': return 'בעלים';
      case 'admin': return 'מנהל';
      case 'member': return 'חבר';
      default: return role;
    }
  };

  if (loading) {
    return (
      <div className="join-page">
        <div className="join-card">
          <div className="join-loading">
            <div className="spinner"></div>
            <p>טוען הזמנה...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !inviteInfo) {
    return (
      <div className="join-page">
        <div className="join-card error">
          <div className="join-icon error">
            <AlertCircle size={32} />
          </div>
          <h1>הזמנה לא תקינה</h1>
          <p>{error}</p>
          <Link to="/" className="join-link">
            חזור לדף הבית
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="join-page">
        <div className="join-card success">
          <div className="join-icon success">
            <Check size={32} />
          </div>
          <h1>הצטרפת בהצלחה!</h1>
          <p>ברוכים הבאים ל-{inviteInfo?.workspace_name}</p>
          <p className="join-redirect">מעביר אותך...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="join-page">
      <div className="join-card">
        <div className="join-icon">
          <Building2 size={32} />
        </div>
        
        <h1>הזמנה להצטרף</h1>
        
        <div className="workspace-preview">
          <div className="workspace-avatar">
            {inviteInfo?.workspace_name?.charAt(0).toUpperCase()}
          </div>
          <div className="workspace-info">
            <span className="workspace-name">{inviteInfo?.workspace_name}</span>
            <span className="workspace-meta">
              <Users size={14} />
              {inviteInfo?.member_count} חברים
            </span>
          </div>
        </div>

        <p className="join-description">
          הוזמנת להצטרף כ-<strong>{getRoleLabel(inviteInfo?.role)}</strong> ב-Workspace זה.
        </p>

        {error && (
          <div className="join-error">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {isAuthenticated ? (
          <button 
            className="join-btn primary"
            onClick={handleJoin}
            disabled={joining}
          >
            {joining ? (
              <>
                <span className="spinner small"></span>
                מצטרף...
              </>
            ) : (
              <>
                <Check size={18} />
                הצטרף ל-Workspace
              </>
            )}
          </button>
        ) : (
          <div className="join-auth-options">
            <p className="auth-prompt">יש להתחבר כדי להצטרף:</p>
            <Link to="/login" className="join-btn primary" state={{ returnTo: `/join/${code}` }}>
              <LogIn size={18} />
              התחבר
            </Link>
            <Link to="/register" className="join-btn secondary" state={{ returnTo: `/join/${code}` }}>
              צור חשבון חדש
            </Link>
          </div>
        )}

        <p className="join-footer">
          <Link to="/">חזור לדף הבית</Link>
        </p>
      </div>
    </div>
  );
}

export default JoinWorkspace;

