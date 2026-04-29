import { useState, useEffect } from 'react';
import { Key, FileText, StickyNote, Puzzle, Check, X, Info, Target, Bell, Calendar } from 'lucide-react';
import { addonsAPI } from '../services/api';
import useStore from '../store/useStore';
import { useModal } from '../components/Modal';
import './Addons.css';

// מיפוי אייקונים לפי שם התוסף
const ADDON_ICONS = {
  credentials: Key,
  files: FileText,
  notes: StickyNote,
  leads_management: Target,
  reminders: Bell,
  schedule: Calendar
};

function Addons() {
  const modal = useModal();
  const { loadEnabledAddons } = useStore();
  const [addons, setAddons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);

  useEffect(() => {
    loadAddons();
  }, []);

  const loadAddons = async () => {
    try {
      const data = await addonsAPI.getAll();
      setAddons(data);
    } catch (error) {
      console.error('Failed to load addons:', error);
      modal.error('שגיאה בטעינת התוספים');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (addonId, currentState) => {
    setUpdating(addonId);
    try {
      await addonsAPI.update(addonId, !currentState);
      
      // עדכון local state
      setAddons(prev => prev.map(addon => 
        addon.id === addonId 
          ? { ...addon, isEnabled: !currentState }
          : addon
      ));
      
      // עדכון global state
      await loadEnabledAddons();
      
      modal.success(
        !currentState 
          ? `התוסף "${addons.find(a => a.id === addonId)?.name}" הופעל בהצלחה` 
          : `התוסף "${addons.find(a => a.id === addonId)?.name}" הושבת`
      );
    } catch (error) {
      console.error('Failed to toggle addon:', error);
      modal.error('שגיאה בעדכון התוסף');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="page fade-in addons-page">
      <div className="page-header">
        <div className="page-title-section">
          <Puzzle className="page-icon" size={28} />
          <div>
            <h1 className="page-title">תוספים</h1>
            <p className="page-subtitle">
              הפעל או כבה יכולות נוספות באפליקציה. כל תוסף מוסיף טאב חדש בעמודי לקוחות ופרויקטים.
            </p>
          </div>
        </div>
      </div>

      <div className="addons-info-banner">
        <Info size={20} />
        <span>
          הערה: כיבוי תוסף לא מוחק את הנתונים שכבר שמרת. אם תפעיל את התוסף מחדש, הנתונים יהיו שם.
        </span>
      </div>

      <div className="addons-grid">
        {addons.map(addon => {
          const Icon = ADDON_ICONS[addon.id] || Puzzle;
          const isUpdating = updating === addon.id;
          
          return (
            <div 
              key={addon.id} 
              className={`addon-card card ${addon.isEnabled ? 'enabled' : 'disabled'} ${isUpdating ? 'updating' : ''}`}
            >
              <div className="addon-header">
                <div className={`addon-icon-wrapper ${addon.isEnabled ? 'active' : ''}`}>
                  <Icon size={24} />
                </div>
                <div className="addon-title-section">
                  <h3 className="addon-name">{addon.name}</h3>
                  <span className={`addon-status ${addon.isEnabled ? 'enabled' : 'disabled'}`}>
                    {addon.isEnabled ? 'מופעל' : 'מושבת'}
                  </span>
                </div>
              </div>
              
              <p className="addon-description">{addon.description}</p>
              
              <div className="addon-footer">
                <button
                  className={`addon-toggle ${addon.isEnabled ? 'toggle-on' : 'toggle-off'}`}
                  onClick={() => handleToggle(addon.id, addon.isEnabled)}
                  disabled={isUpdating}
                >
                  <span className="toggle-track">
                    <span className="toggle-thumb">
                      {isUpdating ? (
                        <span className="toggle-spinner"></span>
                      ) : addon.isEnabled ? (
                        <Check size={12} />
                      ) : (
                        <X size={12} />
                      )}
                    </span>
                  </span>
                  <span className="toggle-label">
                    {addon.isEnabled ? 'פעיל' : 'כבוי'}
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {addons.length === 0 && (
        <div className="empty-state card">
          <div className="empty-state-icon">
            <Puzzle size={48} strokeWidth={1.5} />
          </div>
          <h3 className="empty-state-title">אין תוספים זמינים</h3>
          <p>תוספים חדשים יופיעו כאן בעתיד</p>
        </div>
      )}
    </div>
  );
}

export default Addons;

