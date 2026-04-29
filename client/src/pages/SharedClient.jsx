import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { clientsAPI } from '../services/api';
import { formatDurationHuman } from '../utils/format';
import './SharedClient.css';

function SharedClient() {
  const { token } = useParams();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  useEffect(() => {
    const loadClient = async () => {
      try {
        const data = await clientsAPI.getShared(token);
        setClient(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    loadClient();
  }, [token]);
  
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
          <h1>לינק לא תקין</h1>
          <p>הלינק שהזנת אינו תקין או שפג תוקפו</p>
        </div>
      </div>
    );
  }
  
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
              {client.name.charAt(0).toUpperCase()}
            </div>
            <h1 className="client-name-shared">{client.name}</h1>
            <p className="shared-subtitle">סקירת פרויקטים ומשימות</p>
          </div>
          
          {client.projects && client.projects.length > 0 ? (
            <div className="shared-projects">
              <h2 className="shared-section-title">פרויקטים</h2>
              
              <div className="shared-projects-grid">
                {client.projects.map(project => (
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

export default SharedClient;

