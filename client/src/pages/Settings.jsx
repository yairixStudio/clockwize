import { useState, useEffect } from 'react';
import { Check, Key } from 'lucide-react';
import api, { credentialsAPI } from '../services/api';
import { CredentialModal, CredentialsSection } from '../components/Credentials';
import '../components/Credentials.css';
import './Settings.css';
import { apps } from '../apps';
import { useModal } from '../components/Modal';

function Settings() {
    const [activeTab, setActiveTab] = useState('integrations');
    const [integrations, setIntegrations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [credentials, setCredentials] = useState([]);
    const [loadingCredentials, setLoadingCredentials] = useState(false);
    const [showCredentialModal, setShowCredentialModal] = useState(false);
    const [editingCredential, setEditingCredential] = useState(null);
    const modal = useModal();

    useEffect(() => {
        fetchIntegrations();
        fetchCredentials();
    }, []);

    const fetchIntegrations = async () => {
        try {
            const data = await api.get('/integrations');
            setIntegrations(data);
        } catch (error) {
            console.error('Error fetching integrations:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchCredentials = async () => {
        setLoadingCredentials(true);
        try {
            const data = await credentialsAPI.getAccount();
            setCredentials(data);
        } catch (error) {
            console.error('Error fetching credentials:', error);
        } finally {
            setLoadingCredentials(false);
        }
    };

    const handleSaveCredential = async (credentialData) => {
        try {
            if (editingCredential) {
                await credentialsAPI.update(editingCredential.id, credentialData);
            } else {
                await credentialsAPI.create(credentialData);
            }
            await fetchCredentials();
            setShowCredentialModal(false);
            setEditingCredential(null);
            modal.success(editingCredential ? 'הסיסמה עודכנה בהצלחה' : 'הסיסמה נוספה בהצלחה');
        } catch (error) {
            modal.error(error.message);
        }
    };

    const handleDeleteCredential = async (credentialId) => {
        const confirmed = await modal.confirm(
            'האם אתה בטוח שברצונך למחוק את הסיסמה?',
            { title: 'מחיקת סיסמה', confirmText: 'מחק', type: 'error' }
        );

        if (confirmed) {
            try {
                await credentialsAPI.delete(credentialId);
                await fetchCredentials();
                modal.success('הסיסמה נמחקה בהצלחה');
            } catch (error) {
                modal.error(error.message);
            }
        }
    };

    if (loading) {
        return (
            <div className="page fade-in">
                <div className="page-header">
                    <div>
                        <h1 className="page-title">הגדרות</h1>
                        <p className="page-subtitle">ניהול האינטגרציות והסיסמאות של המערכת</p>
                    </div>
                </div>
                <div className="settings-container">
                    <div className="settings-content" style={{ padding: '2rem', textAlign: 'center' }}>
                        טוען...
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">הגדרות</h1>
                    <p className="page-subtitle">ניהול האינטגרציות והסיסמאות של המערכת</p>
                </div>
            </div>

            <div className="settings-container">
                <div className="settings-tabs">
                    <button
                        className={`tab-btn ${activeTab === 'integrations' ? 'active' : ''}`}
                        onClick={() => setActiveTab('integrations')}
                    >
                        אינטגרציות
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'credentials' ? 'active' : ''}`}
                        onClick={() => setActiveTab('credentials')}
                    >
                        <Key size={16} />
                        סיסמאות כלליות
                    </button>
                </div>

                <div className="settings-content">
                    {activeTab === 'integrations' && (
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
                    )}

                    {activeTab === 'credentials' && (
                        <div className="credentials-tab-content">
                            <CredentialsSection
                                credentials={credentials}
                                loading={loadingCredentials}
                                onAdd={() => { setEditingCredential(null); setShowCredentialModal(true); }}
                                onEdit={(cred) => { setEditingCredential(cred); setShowCredentialModal(true); }}
                                onDelete={handleDeleteCredential}
                            />
                        </div>
                    )}
                </div>
            </div>

            {showCredentialModal && (
                <CredentialModal
                    isOpen={showCredentialModal}
                    onClose={() => { setShowCredentialModal(false); setEditingCredential(null); }}
                    onSave={handleSaveCredential}
                    credential={editingCredential}
                    clientId={null}
                    projectId={null}
                />
            )}
        </div>
    );
}

export default Settings;

