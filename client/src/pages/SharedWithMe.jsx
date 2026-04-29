import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { shareAPI } from '../services/api';
import './SharedWithMe.css';

function SharedWithMe() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    loadLinks();
  }, []);
  
  const loadLinks = async () => {
    try {
      const data = await shareAPI.getSharedWithMe();
      setLinks(data);
    } catch (error) {
      console.error('Failed to load shared links:', error);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }
  
  return (
    <div className="page fade-in">
      <div className="page-header">
        <h1 className="page-title">שותף איתי</h1>
        <p className="page-subtitle">לינקים ששותפו איתך על ידי משתמשים אחרים</p>
      </div>
      
      {links.length === 0 ? (
        <div className="empty-state card">
          <div className="empty-state-icon">📭</div>
          <h3 className="empty-state-title">אין לינקים משותפים</h3>
          <p>כשמישהו ישתף איתך לינק פרטי, הוא יופיע כאן</p>
        </div>
      ) : (
        <div className="shared-links-grid">
          {links.map(link => (
            <Link 
              key={link.id} 
              to={`/s/${link.share_token}`}
              className="shared-link-card card"
            >
              <div className="shared-link-icon">
                {link.resource_type === 'client' ? '👤' : '📁'}
              </div>
              <div className="shared-link-info">
                <h3 className="shared-link-name">{link.resource_name || link.name}</h3>
                <p className="shared-link-type">
                  {link.resource_type === 'client' ? 'לקוח' : 'פרויקט'}
                </p>
                <p className="shared-link-owner">
                  משותף על ידי: {link.owner_name}
                </p>
              </div>
              <span className="shared-link-arrow">←</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default SharedWithMe;

