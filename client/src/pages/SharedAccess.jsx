import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { shareAPI } from '../services/api';
import useStore from '../store/useStore';
import { formatDurationHuman } from '../utils/format';
import './SharedClient.css';

function SharedAccess() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useStore();
  
  const [linkInfo, setLinkInfo] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  
  useEffect(() => {
    loadLinkInfo();
  }, [token]);
  
  const loadLinkInfo = async () => {
    try {
      const info = await shareAPI.getInfo(token);
      setLinkInfo(info);
      
      // If public, load data directly
      if (info.share_type === 'public') {
        await loadData();
      }
    } catch (err) {
      if (err.message.includes('לא פעיל')) {
        setError('לינק זה הושבת על ידי הבעלים');
      } else if (err.message.includes('פג תוקף')) {
        setError('לינק זה פג תוקף');
      } else {
        setError('לינק לא תקין');
      }
    } finally {
      setLoading(false);
    }
  };
  
  const loadData = async (params = {}) => {
    try {
      const result = await shareAPI.access(token, params);
      setData(result);
      setAccessGranted(true);
    } catch (err) {
      if (err.message.includes('נדרש אימות סיסמא')) {
        // Will show password form
      } else if (err.message.includes('נדרשת התחברות')) {
        // Will show login prompt
      } else {
        setError(err.message);
      }
    }
  };
  
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setVerifying(true);
    setPasswordError('');
    
    try {
      await shareAPI.verifyPassword(token, password);
      await loadData({ password_verified: 'true' });
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setVerifying(false);
    }
  };
  
  const handleEmailVerify = async () => {
    setVerifying(true);
    
    try {
      await shareAPI.verifyEmail(token);
      await loadData({ user_email: user?.email });
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  };
  
  if (loading) {
    return (
      <div className="shared-page">
        <div className="loading"><div className="spinner"></div></div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="shared-page">
        <div className="shared-error">
          <div className="error-icon">🔗</div>
          <h1>לינק לא זמין</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  
  // Password protection screen
  if (linkInfo?.share_type === 'password' && !accessGranted) {
    return (
      <div className="shared-page">
        <div className="shared-container">
          <header className="shared-header">
            <div className="shared-logo">
              <svg viewBox="0 0 100 100" className="shared-logo-icon">
                <circle cx="50" cy="50" r="45" fill="currentColor" opacity="0.15"/>
                <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
                <line x1="50" y1="50" x2="50" y2="22" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
                <line x1="50" y1="50" x2="70" y2="50" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.7"/>
                <circle cx="50" cy="50" r="4" fill="currentColor"/>
              </svg>
              <span>Clockwize</span>
            </div>
          </header>
          
          <main className="shared-content">
            <div className="access-form-container">
              <div className="access-icon">🔒</div>
              <h1>תוכן מוגן</h1>
              <p className="access-subtitle">
                {linkInfo.resource_name && <span>{linkInfo.resource_name}</span>}
              </p>
              <p className="access-description">
                תוכן זה מוגן בסיסמא. הזן את הסיסמא לצפייה.
              </p>
              
              <form onSubmit={handlePasswordSubmit} className="access-form">
                <div className="form-group">
                  <input
                    type="password"
                    className="form-input"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="הזן סיסמא"
                    required
                    autoFocus
                  />
                </div>
                
                {passwordError && (
                  <div className="form-error">{passwordError}</div>
                )}
                
                <button 
                  type="submit" 
                  className="btn btn-primary btn-block"
                  disabled={verifying}
                >
                  {verifying ? 'בודק...' : 'כניסה'}
                </button>
              </form>
            </div>
          </main>
          
          <footer className="shared-footer">
            <p>
              נוצר באמצעות <a href="/" target="_blank" rel="noopener noreferrer">Clockwize</a>
            </p>
          </footer>
        </div>
      </div>
    );
  }
  
  // Email protection screen
  if (linkInfo?.share_type === 'email' && !accessGranted) {
    return (
      <div className="shared-page">
        <div className="shared-container">
          <header className="shared-header">
            <div className="shared-logo">
              <svg viewBox="0 0 100 100" className="shared-logo-icon">
                <circle cx="50" cy="50" r="45" fill="currentColor" opacity="0.15"/>
                <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
                <line x1="50" y1="50" x2="50" y2="22" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
                <line x1="50" y1="50" x2="70" y2="50" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.7"/>
                <circle cx="50" cy="50" r="4" fill="currentColor"/>
              </svg>
              <span>Clockwize</span>
            </div>
          </header>
          
          <main className="shared-content">
            <div className="access-form-container">
              <div className="access-icon">📧</div>
              <h1>תוכן פרטי</h1>
              <p className="access-subtitle">
                {linkInfo.resource_name && <span>{linkInfo.resource_name}</span>}
              </p>
              <p className="access-description">
                תוכן זה שותף באופן פרטי. רק משתמשים מורשים יכולים לצפות בו.
              </p>
              
              {isAuthenticated ? (
                <div className="access-actions">
                  <p className="access-user-info">
                    מחובר כ: <strong>{user?.email}</strong>
                  </p>
                  <button 
                    className="btn btn-primary btn-block"
                    onClick={handleEmailVerify}
                    disabled={verifying}
                  >
                    {verifying ? 'מאמת...' : 'בדוק גישה'}
                  </button>
                </div>
              ) : (
                <div className="access-actions">
                  <p className="access-login-prompt">
                    יש להתחבר למערכת כדי לצפות בתוכן זה
                  </p>
                  <Link to={`/login?redirect=/s/${token}`} className="btn btn-primary btn-block">
                    התחברות
                  </Link>
                  <p className="access-register-link">
                    אין לך חשבון? <Link to={`/register?redirect=/s/${token}`}>הרשמה</Link>
                  </p>
                </div>
              )}
            </div>
          </main>
          
          <footer className="shared-footer">
            <p>
              נוצר באמצעות <a href="/" target="_blank" rel="noopener noreferrer">Clockwize</a>
            </p>
          </footer>
        </div>
      </div>
    );
  }
  
  // Show data
  if (!data) {
    return (
      <div className="shared-page">
        <div className="loading"><div className="spinner"></div></div>
      </div>
    );
  }
  
  // Render client data
  if (data.type === 'client') {
    return (
      <div className="shared-page">
        <div className="shared-container">
          <header className="shared-header">
            <div className="shared-logo">
              <svg viewBox="0 0 100 100" className="shared-logo-icon">
                <circle cx="50" cy="50" r="45" fill="currentColor" opacity="0.15"/>
                <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
                <line x1="50" y1="50" x2="50" y2="22" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
                <line x1="50" y1="50" x2="70" y2="50" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.7"/>
                <circle cx="50" cy="50" r="4" fill="currentColor"/>
              </svg>
              <span>Clockwize</span>
            </div>
          </header>
          
          <main className="shared-content">
            <div className="client-header-shared">
              <div className="client-avatar-shared">
                {data.data.name.charAt(0).toUpperCase()}
              </div>
              <h1 className="client-name-shared">{data.data.name}</h1>
              <p className="shared-subtitle">סקירת פרויקטים ומשימות</p>
            </div>
            
            {data.data.projects && data.data.projects.length > 0 ? (
              <div className="shared-projects">
                <h2 className="shared-section-title">פרויקטים</h2>
                
                <div className="shared-projects-grid">
                  {data.data.projects.map(project => (
                    <div key={project.id} className="shared-project-card">
                      <div className="shared-project-header">
                        <h3 className="shared-project-name">{project.name}</h3>
                        <span className={`badge ${project.status === 'completed' ? 'badge-success' : 'badge-primary'}`}>
                          {project.status === 'completed' ? 'הושלם' : 'פעיל'}
                        </span>
                      </div>
                      
                      {project.description && (
                        <p className="shared-project-description">{project.description}</p>
                      )}
                      
                      <div className="shared-project-stats">
                        <div className="shared-stat">
                          <span className="shared-stat-icon">⏱️</span>
                          <span className="shared-stat-value">{formatDurationHuman(project.total_time || 0)}</span>
                          <span className="shared-stat-label">זמן עבודה</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="shared-empty">
                <div className="empty-icon">📁</div>
                <p>עדיין אין פרויקטים</p>
              </div>
            )}
          </main>
          
          <footer className="shared-footer">
            <p>
              נוצר באמצעות <a href="/" target="_blank" rel="noopener noreferrer">Clockwize</a>
            </p>
          </footer>
        </div>
      </div>
    );
  }
  
  // Render project data
  if (data.type === 'project') {
    return (
      <div className="shared-page">
        <div className="shared-container">
          <header className="shared-header">
            <div className="shared-logo">
              <svg viewBox="0 0 100 100" className="shared-logo-icon">
                <circle cx="50" cy="50" r="45" fill="currentColor" opacity="0.15"/>
                <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
                <line x1="50" y1="50" x2="50" y2="22" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
                <line x1="50" y1="50" x2="70" y2="50" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.7"/>
                <circle cx="50" cy="50" r="4" fill="currentColor"/>
              </svg>
              <span>Clockwize</span>
            </div>
          </header>
          
          <main className="shared-content">
            <div className="client-header-shared">
              <div className="client-avatar-shared">
                {data.data.name.charAt(0).toUpperCase()}
              </div>
              <h1 className="client-name-shared">{data.data.name}</h1>
              <p className="shared-subtitle">
                {data.data.client_name && <span>לקוח: {data.data.client_name}</span>}
              </p>
            </div>
            
            {/* Project Stats */}
            <div className="shared-project-card" style={{ marginBottom: '2rem' }}>
              <div className="shared-project-header">
                <h3 className="shared-project-name">פרטי פרויקט</h3>
                <span className={`badge ${data.data.status === 'completed' ? 'badge-success' : 'badge-primary'}`}>
                  {data.data.status === 'completed' ? 'הושלם' : 'פעיל'}
                </span>
              </div>
              
              {data.data.description && (
                <p className="shared-project-description">{data.data.description}</p>
              )}
              
              <div className="shared-project-stats">
                <div className="shared-stat">
                  <span className="shared-stat-icon">⏱️</span>
                  <span className="shared-stat-value">{formatDurationHuman(data.data.total_time || 0)}</span>
                  <span className="shared-stat-label">זמן עבודה כולל</span>
                </div>
                <div className="shared-stat">
                  <span className="shared-stat-icon">📋</span>
                  <span className="shared-stat-value">{data.data.tasks?.length || 0}</span>
                  <span className="shared-stat-label">משימות</span>
                </div>
              </div>
            </div>
            
            {/* Tasks Section */}
            {data.data.tasks && data.data.tasks.length > 0 ? (
              <div className="shared-projects">
                <h2 className="shared-section-title">משימות</h2>
                
                <div className="shared-projects-grid">
                  {data.data.tasks.map(task => (
                    <div key={task.id} className="shared-project-card">
                      <div className="shared-project-header">
                        <h3 className="shared-project-name">{task.name}</h3>
                        <span className={`badge ${
                          task.status === 'completed' ? 'badge-success' : 
                          task.status === 'in_progress' ? 'badge-warning' : 
                          'badge-secondary'
                        }`}>
                          {task.status === 'completed' ? 'הושלם' : 
                           task.status === 'in_progress' ? 'בביצוע' : 
                           'ממתין'}
                        </span>
                      </div>
                      
                      {task.description && (
                        <p className="shared-project-description">{task.description}</p>
                      )}
                      
                      <div className="shared-project-stats">
                        <div className="shared-stat">
                          <span className="shared-stat-icon">⏱️</span>
                          <span className="shared-stat-value">{formatDurationHuman(task.total_time || 0)}</span>
                          <span className="shared-stat-label">זמן עבודה</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="shared-empty">
                <div className="empty-icon">📋</div>
                <p>עדיין אין משימות בפרויקט</p>
              </div>
            )}
          </main>
          
          <footer className="shared-footer">
            <p>
              נוצר באמצעות <a href="/" target="_blank" rel="noopener noreferrer">Clockwize</a>
            </p>
          </footer>
        </div>
      </div>
    );
  }
  
  return null;
}

export default SharedAccess;

