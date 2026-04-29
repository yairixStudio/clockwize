import { useState, useEffect, useRef } from 'react';
import { Check, AlertCircle, Loader, Search, Settings, LogOut } from 'lucide-react';
import api from '../../services/api';
import '../../pages/Settings.css';

// Searchable Select Component (Reused here to be self-contained or import from common)
// Ideally move to components/SearchableSelect.jsx but keeping here for now to match logic transfer
function SearchableSelect({ options, value, onChange, placeholder }) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredOptions = options.filter(opt => 
        opt.label.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleSelect = (val) => {
        onChange(val);
        setIsOpen(false);
        setSearchTerm('');
    };

    return (
        <div className="searchable-select-container" ref={containerRef} style={{position: 'relative', width: '180px'}}>
            <div 
                className="form-select btn-sm" 
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    cursor: 'pointer', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    color: value ? 'var(--text-primary)' : 'var(--text-muted)'
                }}
            >
                <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    {value ? options.find(o => o.value === value)?.label : placeholder}
                </span>
                <span style={{fontSize: '0.8em', opacity: 0.5, marginRight: '4px'}}>▼</span>
            </div>
            
            {isOpen && (
                <div className="searchable-select-dropdown" style={{
                    position: 'absolute', top: '100%', right: 0, left: 0, 
                    zIndex: 100, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)', maxHeight: '200px', overflowY: 'auto',
                    boxShadow: 'var(--shadow-lg)', padding: '0.5rem'
                }}>
                    <div className="search-box-small" style={{marginBottom: '0.5rem', position: 'sticky', top: 0}}>
                        <input 
                            type="text" 
                            className="form-input" 
                            style={{padding: '0.25rem 0.5rem', fontSize: '0.85rem', width: '100%'}}
                            placeholder="חפש..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                        />
                    </div>
                    <div className="options-list">
                        {filteredOptions.length > 0 ? filteredOptions.map(opt => (
                            <div 
                                key={opt.value} 
                                className="select-option" 
                                onClick={() => handleSelect(opt.value)}
                                style={{
                                    padding: '0.35rem 0.5rem', 
                                    cursor: 'pointer', 
                                    borderRadius: 'var(--radius-sm)', 
                                    fontSize: '0.9rem',
                                    color: 'var(--text-primary)'
                                }}
                                onMouseEnter={(e) => e.target.style.background = 'var(--bg-tertiary)'}
                                onMouseLeave={(e) => e.target.style.background = 'transparent'}
                            >
                                {opt.label}
                            </div>
                        )) : <div style={{padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)'}}>לא נמצאו תוצאות</div>}
                    </div>
                </div>
            )}
        </div>
    );
}

const MorningSettings = ({ integration, onUpdate }) => {
    const [connecting, setConnecting] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [apiSecret, setApiSecret] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [syncLoading, setSyncLoading] = useState(false);
    const [syncMessage, setSyncMessage] = useState('');
    const [showSyncManager, setShowSyncManager] = useState(false);
    const [morningClients, setMorningClients] = useState([]);
    const [localClients, setLocalClients] = useState([]);
    const [morningSearch, setMorningSearch] = useState('');
    const [selectedClients, setSelectedClients] = useState([]);

    useEffect(() => {
        if (showSyncManager) {
            fetchLocalClients();
            if (morningClients.length === 0) {
                handleSyncClients();
            }
        }
    }, [showSyncManager]);

    const fetchLocalClients = async () => {
        try {
            const data = await api.get('/clients');
            setLocalClients(data);
        } catch (error) {
            console.error('Error fetching local clients:', error);
        }
    };

    const handleConnect = async (e) => {
        e.preventDefault();
        setConnecting(true);
        setError('');
        setSuccess('');

        try {
            await api.post('/integrations/morning/connect', { apiKey, apiSecret });
            setSuccess('חובר בהצלחה למורנינג');
            setApiKey('');
            setApiSecret('');
            onUpdate();
        } catch (error) {
            setError(error.response?.data?.error || 'שגיאה בחיבור למורנינג');
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        if (!confirm('האם אתה בטוח שברצונך להתנתק ממורנינג?')) return;

        try {
            await api.post('/integrations/morning/disconnect');
            onUpdate();
        } catch (error) {
            console.error('Error disconnecting:', error);
        }
    };

    const handleSyncClients = async () => {
        setSyncLoading(true);
        setSyncMessage('');
        try {
            const allClients = [];
            let page = 1;
            const pageSize = 100;
            while (true) {
                try {
                    const resp = await api.get(`/integrations/morning/clients?page=${page}&pageSize=${pageSize}`);
                    const { data, meta } = resp;
                    if (!Array.isArray(data) || data.length === 0) break;
                    allClients.push(...data);
                    if (page >= (meta?.totalPages || 1)) break;
                    page += 1;
                } catch (err) {
                    if (err.message && err.message.includes('401')) {
                        throw new Error('חיבור מורנינג פג תוקף. יש להתנתק ולהתחבר מחדש.');
                    }
                    throw err;
                }
            }

            if (allClients.length === 0) {
                setSyncMessage('לא נמצאו לקוחות במורנינג');
                setMorningClients([]);
                return;
            }

            setMorningClients(allClients);
            fetchLocalClients();
            setSyncMessage('הלקוחות נטענו – ניתן לקשר אותם ללקוחות קיימים או ליצור חדשים');
        } catch (error) {
            console.error('Error syncing clients:', error);
            const details = error.details ? (typeof error.details === 'object' ? JSON.stringify(error.details) : error.details) : error.message;
            setSyncMessage(`שגיאה במהלך סנכרון: ${details}`);
        } finally {
            setSyncLoading(false);
        }
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            // Select all unlinked clients that match search
            const filtered = morningClients.filter(c => {
                // Filter by search
                const matchesSearch = c.name.toLowerCase().includes(morningSearch.toLowerCase()) || 
                                      (c.email && c.email.toLowerCase().includes(morningSearch.toLowerCase())) ||
                                      (c.tax_id && c.tax_id.includes(morningSearch));
                // Filter unlinked
                const isLinked = localClients.some(lc => lc.morning_id === c.id);
                return matchesSearch && !isLinked;
            });
            setSelectedClients(filtered.map(c => c.id));
        } else {
            setSelectedClients([]);
        }
    };

    const handleSelectClient = (id) => {
        setSelectedClients(prev => {
            if (prev.includes(id)) return prev.filter(cid => cid !== id);
            return [...prev, id];
        });
    };

    const handleBulkCreate = async () => {
        if (selectedClients.length === 0) return;
        if (!confirm(`האם ליצור ${selectedClients.length} לקוחות חדשים?`)) return;

        setSyncLoading(true);
        setSyncMessage(`יוצר ${selectedClients.length} לקוחות...`);
        
        let createdCount = 0;
        let errorCount = 0;

        for (const clientId of selectedClients) {
            const client = morningClients.find(c => c.id === clientId);
            if (!client) continue;

            const payload = {
                name: client.name || 'Unnamed',
                email: client.email || '',
                phone: client.phone || '',
                address: client.address || '',
                tax_id: client.tax_id || '',
                morning_id: client.id
            };

            try {
                await api.post('/clients', payload);
                createdCount++;
            } catch (e) {
                console.error(`Failed to create client ${client.name}`, e);
                errorCount++;
            }
        }

        setSyncLoading(false);
        setSyncMessage(`הסתיים: ${createdCount} נוצרו בהצלחה, ${errorCount} נכשלו.`);
        setSelectedClients([]);
        fetchLocalClients();
    };

    const createLocalClient = async (morningClient) => {
        const payload = {
            name: morningClient.name || 'Unnamed',
            email: morningClient.email || '',
            phone: morningClient.phone || '',
            address: morningClient.address || '',
            tax_id: morningClient.tax_id || '',
            morning_id: morningClient.id
        };
        try {
            await api.post('/clients', payload);
            alert('לקוח נוצר וקושר למורנינג');
            fetchLocalClients();
        } catch (e) {
            console.error('Error creating local client', e);
            alert('שגיאה ביצירת לקוח');
        }
    };

    const linkToExistingClient = async (morningClient, localClientId) => {
        try {
            const localClient = localClients.find(c => c.id === localClientId);
            if (!localClient) throw new Error('Local client not found');
            
            await api.put(`/clients/${localClientId}`, { 
                morning_id: morningClient.id,
                name: localClient.name 
            });
            alert('הלקוח קושר בהצלחה');
            fetchLocalClients();
        } catch (e) {
            console.error('Error linking client', e);
            alert('שגיאה בקישור הלקוח');
        }
    };

    const unlinkClient = async (localClientId) => {
        if (!confirm('האם אתה בטוח שברצונך לבטל את הקישור?')) return;
        try {
            const localClient = localClients.find(c => c.id === localClientId);
            if (!localClient) throw new Error('Local client not found');

            await api.put(`/clients/${localClientId}`, { 
                morning_id: null,
                name: localClient.name
            });
            alert('הקישור הוסר');
            fetchLocalClients();
        } catch (e) {
            console.error('Error unlinking client', e);
            alert('שגיאה בהסרת הקישור');
        }
    };

    const SyncManagerModal = () => (
        <div className="sync-manager-overlay">
            <div className="sync-manager-content">
                <div className="sync-manager-header">
                    <h2>ניהול סנכרון מול מורנינג</h2>
                    <button 
                        className="btn btn-icon"
                        onClick={() => setShowSyncManager(false)}
                    >
                        ✕
                    </button>
                </div>
                
                <div className="sync-manager-actions">
                    <button
                        className="btn btn-primary"
                        onClick={handleSyncClients}
                        disabled={syncLoading}
                    >
                        {syncLoading ? (
                            <>
                                <Loader className="spin" size={16} />
                                טוען נתונים ממורנינג...
                            </>
                        ) : (
                            'רענן רשימה'
                        )}
                    </button>
                    
                    {syncMessage && (
                        <div className={`sync-status ${syncMessage.includes('שגיאה') ? 'error' : 'success'}`}>
                            {syncMessage}
                        </div>
                    )}
                </div>

                {morningClients.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', marginBottom: '1rem' }}>
                        <div className="search-box" style={{ maxWidth: '300px', flex: 1 }}>
                            <Search size={16} className="search-icon" style={{ right: '0.75rem' }} />
                            <input
                                type="text"
                                className="form-input search-input"
                                placeholder="חיפוש בלקוחות מורנינג..."
                                value={morningSearch}
                                onChange={(e) => setMorningSearch(e.target.value)}
                                style={{ paddingRight: '2.5rem' }}
                                autoFocus
                            />
                        </div>
                        {selectedClients.length > 0 && (
                            <button 
                                className="btn btn-primary"
                                onClick={handleBulkCreate}
                                disabled={syncLoading}
                            >
                                צור {selectedClients.length} לקוחות נבחרים
                            </button>
                        )}
                    </div>
                )}

                {morningClients.length > 0 ? (
                    <div className="morning-clients-table">
                        <h3>רשימת לקוחות וסטטוס סנכרון</h3>
                        <div className="table-responsive">
                            <table className="client-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '40px' }}>
                                            <input 
                                                type="checkbox" 
                                                onChange={handleSelectAll}
                                                checked={selectedClients.length > 0 && selectedClients.length === morningClients.filter(c => {
                                                    const matchesSearch = c.name.toLowerCase().includes(morningSearch.toLowerCase()) || 
                                                                          (c.email && c.email.toLowerCase().includes(morningSearch.toLowerCase())) ||
                                                                          (c.tax_id && c.tax_id.includes(morningSearch));
                                                    const isLinked = localClients.some(lc => lc.morning_id === c.id);
                                                    return matchesSearch && !isLinked;
                                                }).length}
                                            />
                                        </th>
                                        <th>שם במורנינג</th>
                                        <th>אימייל</th>
                                        <th>מספר עוסק</th>
                                        <th>סטטוס קישור</th>
                                        <th>פעולה</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {morningClients
                                        .filter(c => 
                                            c.name.toLowerCase().includes(morningSearch.toLowerCase()) || 
                                            (c.email && c.email.toLowerCase().includes(morningSearch.toLowerCase())) ||
                                            (c.tax_id && c.tax_id.includes(morningSearch))
                                        )
                                        .map((c) => {
                                        const linkedLocalClient = localClients.find(lc => lc.morning_id === c.id);
                                        const suggestedMatch = !linkedLocalClient && localClients.find(lc => 
                                            (lc.email && lc.email === c.email) || 
                                            (lc.name && lc.name.toLowerCase() === c.name.toLowerCase())
                                        );

                                        return (
                                            <tr key={c.id}>
                                                <td>
                                                    {!linkedLocalClient && (
                                                        <input 
                                                            type="checkbox" 
                                                            checked={selectedClients.includes(c.id)}
                                                            onChange={() => handleSelectClient(c.id)}
                                                        />
                                                    )}
                                                </td>
                                                <td>{c.name}</td>
                                                <td>{c.email}</td>
                                                <td>{c.tax_id}</td>
                                                <td>
                                                    {linkedLocalClient ? (
                                                        <span className="status-linked">
                                                            <Check size={14} />
                                                            מקושר ל: {linkedLocalClient.name}
                                                        </span>
                                                    ) : suggestedMatch ? (
                                                        <span className="status-match">
                                                            נמצאה התאמה: {suggestedMatch.name}
                                                        </span>
                                                    ) : (
                                                        <span className="status-unlinked">לא מקושר</span>
                                                    )}
                                                </td>
                                                <td>
                                                    {linkedLocalClient ? (
                                                        <button
                                                            className="btn btn-outline btn-danger btn-sm"
                                                            onClick={() => unlinkClient(linkedLocalClient.id)}
                                                        >
                                                            בטל קישור
                                                        </button>
                                                    ) : suggestedMatch ? (
                                                        <div className="action-group">
                                                            <button
                                                                className="btn btn-outline btn-primary btn-sm"
                                                                onClick={() => linkToExistingClient(c, suggestedMatch.id)}
                                                            >
                                                                קשר ל-{suggestedMatch.name}
                                                            </button>
                                                            <button
                                                                className="btn btn-outline btn-secondary btn-sm"
                                                                onClick={() => createLocalClient(c)}
                                                            >
                                                                צור חדש
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="action-group" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                            <button
                                                                className="btn btn-outline btn-primary btn-sm"
                                                                onClick={() => createLocalClient(c)}
                                                            >
                                                                צור במערכת
                                                            </button>
                                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>או</span>
                                                            <SearchableSelect
                                                                placeholder="קשר לקיים..."
                                                                options={localClients
                                                                    .filter(lc => !lc.morning_id)
                                                                    .map(lc => ({ value: lc.id, label: lc.name }))
                                                                }
                                                                onChange={(val) => {
                                                                    if (val) {
                                                                        linkToExistingClient(c, val);
                                                                    }
                                                                }}
                                                            />
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    !syncLoading && <div className="empty-state">לחץ על "טען רשימה" כדי להתחיל בסנכרון</div>
                )}
            </div>
        </div>
    );

    if (integration) {
        return (
            <div className="integration-body">
                {showSyncManager && <SyncManagerModal />}
                <div className="connected-actions">
                    <div className="action-buttons">
                        <button
                            className="integration-action-btn"
                            onClick={() => setShowSyncManager(true)}
                            title="ניהול וסנכרון לקוחות"
                        >
                            <Settings size={16} />
                            <span>ניהול וסנכרון לקוחות</span>
                        </button>
                        <button
                            className="integration-action-btn integration-action-btn-danger"
                            onClick={handleDisconnect}
                            title="התנתק"
                        >
                            <LogOut size={16} />
                            <span>התנתק</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="integration-body">
            <form onSubmit={handleConnect} className="connect-form">
                <div className="form-group">
                    <label className="form-label">API Key (ID)</label>
                    <input
                        type="text"
                        className="form-input"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="הכנס API Key"
                        required
                    />
                </div>
                <div className="form-group">
                    <label className="form-label">API Secret</label>
                    <input
                        type="password"
                        className="form-input"
                        value={apiSecret}
                        onChange={(e) => setApiSecret(e.target.value)}
                        placeholder="הכנס API Secret"
                        required
                    />
                </div>

                {error && (
                    <div className="error-message">
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}

                {success && (
                    <div className="success-message">
                        <Check size={16} />
                        {success}
                    </div>
                )}

                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={connecting}
                >
                    {connecting ? (
                        <>
                            <Loader className="spin" size={16} />
                            מתחבר...
                        </>
                    ) : (
                        'חבר חשבון'
                    )}
                </button>
            </form>
        </div>
    );
};

export default MorningSettings;

