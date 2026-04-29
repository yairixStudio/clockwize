import { useState, useEffect } from 'react';
import { Check, Key, Plug, Puzzle, Settings, Save, FileText, StickyNote, Info, X, Filter, Target, Bell, Package, Sparkles, Eye, EyeOff } from 'lucide-react';
import api, { addonsAPI, authAPI } from '../services/api';
import { apps } from '../apps';
import { useModal } from '../components/Modal';
import useStore from '../store/useStore';
import './SettingsPage.css';

// מיפוי אייקונים לפי שם התוסף
const ADDON_ICONS = {
  credentials: Key,
  files: FileText,
  notes: StickyNote,
  leads_management: Target,
  reminders: Bell,
  catalog: Package,
  ai_assistant: Sparkles
};

function SettingsPage() {
  const [activeTab, setActiveTab] = useState('integrations');
  const modal = useModal();
  const { user, updateUser, loadEnabledAddons } = useStore();

  // Integrations state
  const [integrations, setIntegrations] = useState([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);

  // Addons state
  const [addons, setAddons] = useState([]);
  const [loadingAddons, setLoadingAddons] = useState(true);
  const [updatingAddon, setUpdatingAddon] = useState(null);

  // Addon settings modal state
  const [settingsModalAddon, setSettingsModalAddon] = useState(null);
  const [addonSettings, setAddonSettings] = useState({});
  const [loadingAddonSettings, setLoadingAddonSettings] = useState(false);
  const [savingAddonSettings, setSavingAddonSettings] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // General settings state
  const [formData, setFormData] = useState({
    default_hourly_rate: user?.default_hourly_rate || 250,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    fetchIntegrations();
    loadAddons();
  }, []);

  // ===== INTEGRATIONS FUNCTIONS =====
  const fetchIntegrations = async () => {
    try {
      const data = await api.get('/integrations');
      setIntegrations(data);
    } catch (error) {
      console.error('Error fetching integrations:', error);
    } finally {
      setLoadingIntegrations(false);
    }
  };

  // ===== ADDONS FUNCTIONS =====
  const loadAddons = async () => {
    try {
      const data = await addonsAPI.getAll();
      setAddons(data);
    } catch (error) {
      console.error('Failed to load addons:', error);
    } finally {
      setLoadingAddons(false);
    }
  };

  const handleToggleAddon = async (addonId, currentState) => {
    setUpdatingAddon(addonId);
    try {
      await addonsAPI.update(addonId, !currentState);
      
      setAddons(prev => prev.map(addon => 
        addon.id === addonId 
          ? { ...addon, isEnabled: !currentState }
          : addon
      ));
      
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
      setUpdatingAddon(null);
    }
  };

  const openAddonSettings = async (addon) => {
    setSettingsModalAddon(addon);
    setLoadingAddonSettings(true);
    setShowApiKey(false);
    
    try {
      const settings = await addonsAPI.getSettings(addon.id);
      setAddonSettings(settings || {});
    } catch (error) {
      console.error('Failed to load addon settings:', error);
      setAddonSettings({});
    } finally {
      setLoadingAddonSettings(false);
    }
  };

  const closeAddonSettings = () => {
    setSettingsModalAddon(null);
    setAddonSettings({});
    setShowApiKey(false);
  };

  const handleAddonSettingChange = (key, value) => {
    setAddonSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveAddonSettings = async () => {
    if (!settingsModalAddon) return;
    
    setSavingAddonSettings(true);
    try {
      await addonsAPI.updateSettings(settingsModalAddon.id, addonSettings);
      modal.success('ההגדרות נשמרו בהצלחה');
      closeAddonSettings();
    } catch (error) {
      console.error('Failed to save addon settings:', error);
      modal.error('שגיאה בשמירת ההגדרות');
    } finally {
      setSavingAddonSettings(false);
    }
  };

  // ===== GENERAL SETTINGS FUNCTIONS =====
  const handleSettingsChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    
    try {
      const updateData = {
        name: user.name,
        email: user.email,
        default_hourly_rate: parseFloat(formData.default_hourly_rate)
      };
      
      const updatedUser = await authAPI.updateProfile(updateData);
      updateUser(updatedUser);
      
      modal.success('ההגדרות נשמרו בהצלחה');
    } catch (error) {
      modal.error(error.message);
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="page fade-in settings-page">
      <div className="page-header">
        <div className="page-title-section">
          <Settings className="page-icon" size={28} />
          <div>
            <h1 className="page-title">הגדרות</h1>
            <p className="page-subtitle">ניהול הגדרות המערכת, אינטגרציות ותוספים</p>
          </div>
        </div>
      </div>

      <div className="settings-page-container">
        <nav className="settings-nav">
          <button
            className={`settings-nav-btn ${activeTab === 'integrations' ? 'active' : ''}`}
            onClick={() => setActiveTab('integrations')}
          >
            <Plug size={18} />
            <span>אינטגרציות</span>
          </button>
          <button
            className={`settings-nav-btn ${activeTab === 'addons' ? 'active' : ''}`}
            onClick={() => setActiveTab('addons')}
          >
            <Puzzle size={18} />
            <span>תוספים</span>
          </button>
          <button
            className={`settings-nav-btn ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            <Settings size={18} />
            <span>הגדרות כלליות</span>
          </button>
        </nav>

        <div className="settings-page-content">
          {/* ===== INTEGRATIONS TAB ===== */}
          {activeTab === 'integrations' && (
            <div className="integrations-settings">
              {loadingIntegrations ? (
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                  <div className="spinner"></div>
                  <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>טוען...</p>
                </div>
              ) : (
                <div className="integrations-content">
                  <div className="integrations-list">
                    {apps.map(app => {
                      const activeIntegration = integrations.find(i => i.provider === app.id && i.is_active);
                      const SettingsComponent = app.settingsComponent;

                      return (
                        <div className="integration-card" key={app.id}>
                          <div className="integration-header">
                            <div className="integration-header-main">
                              <div className="integration-icon" style={{ backgroundColor: activeIntegration ? app.iconColor : undefined }}>
                                {app.icon}
                              </div>
                              <div className="integration-info">
                                <div className="integration-title-row">
                                  <h3>{app.name}</h3>
                                  {activeIntegration && (
                                    <div className="integration-status connected">
                                      <Check size={14} />
                                      <span>מחובר</span>
                                    </div>
                                  )}
                                </div>
                                <p>{app.description}</p>
                              </div>
                            </div>
                          </div>

                          {SettingsComponent && (
                            <SettingsComponent
                              integration={activeIntegration}
                              onUpdate={fetchIntegrations}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== ADDONS TAB ===== */}
          {activeTab === 'addons' && (
            <div className="addons-settings">
              <div className="addons-info-banner">
                <Info size={20} />
                <span>
                  הערה: כיבוי תוסף לא מוחק את הנתונים שכבר שמרת. אם תפעיל את התוסף מחדש, הנתונים יהיו שם.
                </span>
              </div>

              {loadingAddons ? (
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                  <div className="spinner"></div>
                  <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>טוען...</p>
                </div>
              ) : (
                <div className="addons-grid">
                  {addons.map(addon => {
                    const Icon = ADDON_ICONS[addon.id] || Puzzle;
                    const isUpdating = updatingAddon === addon.id;
                    
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
                          {addon.hasSettings && (
                            <button
                              className="addon-settings-btn"
                              onClick={() => openAddonSettings(addon)}
                              title="הגדרות תוסף"
                            >
                              <Settings size={16} />
                            </button>
                          )}
                          <button
                            className={`addon-toggle ${addon.isEnabled ? 'toggle-on' : 'toggle-off'}`}
                            onClick={() => handleToggleAddon(addon.id, addon.isEnabled)}
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
              )}

              {!loadingAddons && addons.length === 0 && (
                <div className="empty-state card">
                  <div className="empty-state-icon">
                    <Puzzle size={48} strokeWidth={1.5} />
                  </div>
                  <h3 className="empty-state-title">אין תוספים זמינים</h3>
                  <p>תוספים חדשים יופיעו כאן בעתיד</p>
                </div>
              )}
            </div>
          )}

          {/* ===== GENERAL SETTINGS TAB ===== */}
          {activeTab === 'general' && (
            <div className="general-settings">
              <form onSubmit={handleSaveSettings} className="general-settings-form">
                <div className="settings-section">
                  <h3 className="settings-section-title">הגדרות תמחור</h3>
                  
                  <div className="form-group">
                    <label className="form-label">מחיר ברירת מחדל לשעה (₪)</label>
                    <input
                      type="number"
                      name="default_hourly_rate"
                      className="form-input"
                      value={formData.default_hourly_rate}
                      onChange={handleSettingsChange}
                      min="0"
                      step="0.01"
                      dir="ltr"
                    />
                    <p className="form-help">
                      מחיר זה ישמש כברירת מחדל ללקוחות, פרויקטים ומשימות חדשים
                    </p>
                  </div>
                </div>
                
                <div className="settings-actions">
                  <button type="submit" className="btn btn-primary" disabled={savingSettings}>
                    <Save size={18} />
                    <span>{savingSettings ? 'שומר...' : 'שמור שינויים'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Addon Settings Modal */}
      {settingsModalAddon && (
        <div className="modal-overlay" onClick={closeAddonSettings}>
          <div className="modal addon-settings-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <Settings size={20} />
                הגדרות {settingsModalAddon.name}
              </h3>
              <button className="btn btn-ghost btn-icon" onClick={closeAddonSettings}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              {loadingAddonSettings ? (
                <div className="flex justify-center p-4">
                  <div className="spinner"></div>
                </div>
              ) : (
                <div className="addon-settings-form">
                  {settingsModalAddon.id === 'ai_assistant' && (
                    <>
                      <div className="form-group">
                        <label className="form-label">OpenAI API Key</label>
                        <div className="api-key-input-wrapper">
                          <input
                            type={showApiKey ? 'text' : 'password'}
                            className="form-input"
                            value={addonSettings.openai_api_key || ''}
                            onChange={(e) => handleAddonSettingChange('openai_api_key', e.target.value)}
                            placeholder="sk-..."
                            dir="ltr"
                          />
                          <button
                            type="button"
                            className="api-key-toggle"
                            onClick={() => setShowApiKey(!showApiKey)}
                          >
                            {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                        <p className="form-help">
                          ניתן להשיג API key מ-
                          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                            OpenAI Platform
                          </a>
                        </p>
                        {addonSettings.openai_api_key_configured && !addonSettings.openai_api_key?.startsWith('sk-') && (
                          <p className="form-help success">✓ מפתח API מוגדר</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeAddonSettings}>
                ביטול
              </button>
              <button 
                className="btn btn-primary" 
                onClick={saveAddonSettings}
                disabled={savingAddonSettings}
              >
                <Save size={16} />
                {savingAddonSettings ? 'שומר...' : 'שמור'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsPage;
