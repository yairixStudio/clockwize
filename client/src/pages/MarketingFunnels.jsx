import { useState, useEffect } from 'react';
import { 
  List, 
  GitMerge, 
  Users,
  Filter,
  ArrowDown,
  Plus,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Check,
  X
} from 'lucide-react';
import { clientSourcesAPI, clientsAPI } from '../services/api';
import { useModal } from '../components/Modal';
import './MarketingFunnels.css';

function MarketingFunnels() {
  const modal = useModal();
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'chart'
  const [stats, setStats] = useState({ sources: [], noSourceCount: 0, clients: [] });
  const [loading, setLoading] = useState(true);
  const [expandedSources, setExpandedSources] = useState({});
  const [showNewSourceInput, setShowNewSourceInput] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceIsGlobal, setNewSourceIsGlobal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [subSourceValue, setSubSourceValue] = useState('');

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await clientSourcesAPI.getStats();
      setStats(data);
    } catch (error) {
      console.error('Failed to load marketing funnel stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSource = async () => {
    if (!newSourceName.trim()) return;
    try {
      await clientSourcesAPI.create({ 
        name: newSourceName,
        is_global: newSourceIsGlobal 
      });
      setNewSourceName('');
      setNewSourceIsGlobal(false);
      setShowNewSourceInput(false);
      loadStats(); // Reload to get updated list
    } catch (error) {
      console.error('Failed to create source:', error);
      alert('שגיאה ביצירת מקור');
    }
  };

  const toggleSourceExpanded = (sourceId) => {
    setExpandedSources(prev => ({
      ...prev,
      [sourceId]: !prev[sourceId]
    }));
  };

  const startEditingSource = (client) => {
    setEditingClient(client.id);
    setSelectedSourceId(client.source_id || '');
    setSubSourceValue(client.sub_source || '');
  };

  const cancelEditingSource = () => {
    setEditingClient(null);
    setSelectedSourceId('');
    setSubSourceValue('');
  };

  const handleSourceChange = (sourceId) => {
    setSelectedSourceId(sourceId);
    // Clear sub_source if not "הפניות"
    const selectedSource = stats.sources?.find(s => s.id === sourceId);
    if (selectedSource?.name !== 'הפניות') {
      setSubSourceValue('');
    }
  };

  const isReferralSource = () => {
    const selectedSource = stats.sources?.find(s => s.id === selectedSourceId);
    return selectedSource?.name === 'הפניות';
  };

  const saveClientSource = async (clientId) => {
    try {
      const updateData = {
        source_id: selectedSourceId || null,
        sub_source: isReferralSource() ? (subSourceValue || null) : null
      };
      await clientsAPI.update(clientId, updateData);
      modal.success('מקור ההגעה עודכן בהצלחה');
      cancelEditingSource();
      loadStats();
    } catch (error) {
      console.error('Failed to update source:', error);
      modal.error('שגיאה בעדכון מקור ההגעה');
    }
  };

  const handleAssignSourceToWorkspace = async (sourceId, sourceName) => {
    if (!confirm(`לשייך את המקור "${sourceName}" ל-workspace שלך?`)) return;
    try {
      await clientSourcesAPI.assignToWorkspace(sourceId);
      modal.success('המקור שויך בהצלחה');
      loadStats();
    } catch (error) {
      console.error('Failed to assign source:', error);
      modal.error('שגיאה בשיוך המקור');
    }
  };

  const getSourceDisplayName = (client) => {
    const source = stats.sources?.find(s => s.id === client.source_id);
    if (!source) return null;
    if (source.name === 'הפניות' && client.sub_source) {
      return `${source.name} (${client.sub_source})`;
    }
    return source.name;
  };

  const totalClients = stats.clients?.length || 0;
  const sourcesWithClients = stats.sources?.filter(s => s.client_count > 0) || [];

  // Get clients for a specific source
  const getClientsForSource = (sourceId) => {
    return stats.clients?.filter(c => c.source_id === sourceId) || [];
  };

  // Get clients without source
  const getClientsWithoutSource = () => {
    return stats.clients?.filter(c => !c.source_id) || [];
  };

  if (loading) {
    return (
      <div className="page fade-in marketing-funnels-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">משפכים שיווקיים</h1>
            <p className="page-subtitle">טוען...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page fade-in marketing-funnels-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">משפכים שיווקיים</h1>
          <p className="page-subtitle">ניהול ומעקב אחר מקורות הגעה של לקוחות</p>
        </div>
        
        <div className="header-actions">
          {!showNewSourceInput ? (
            <button 
              className="btn btn-primary"
              onClick={() => setShowNewSourceInput(true)}
            >
              <Plus size={18} />
              <span>הוסף מקור חדש</span>
            </button>
          ) : (
            <div className="new-source-input" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="שם המקור החדש..."
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateSource()}
                autoFocus
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', fontSize: '0.875rem' }}>
                <input
                  type="checkbox"
                  checked={newSourceIsGlobal}
                  onChange={(e) => setNewSourceIsGlobal(e.target.checked)}
                />
                <span>גלובלי</span>
              </label>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreateSource}
              >
                הוסף
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowNewSourceInput(false);
                  setNewSourceIsGlobal(false);
                }}
              >
                ביטול
              </button>
            </div>
          )}
          
          <div className="view-toggle">
            <button 
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="תצוגת רשימה"
            >
              <List size={18} />
              <span>רשימה</span>
            </button>
            <button 
              className={`view-toggle-btn ${viewMode === 'chart' ? 'active' : ''}`}
              onClick={() => setViewMode('chart')}
              title="תצוגת תרשים"
            >
              <GitMerge size={18} />
              <span>תרשים</span>
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'list' ? (
        <div className="funnels-list">
          {stats.sources?.length === 0 && (
            <div className="empty-state">
              <Users size={48} />
              <h3>אין מקורות הגעה</h3>
              <p>הוסף מקור הגעה חדש כדי לעקוב אחר לקוחות</p>
            </div>
          )}
          
          {stats.sources?.map((source) => {
            const sourceClients = getClientsForSource(source.id);
            const isExpanded = expandedSources[source.id];
            
            return (
              <div key={source.id} className="funnel-item-wrapper">
                <div 
                  className={`funnel-item ${sourceClients.length > 0 ? 'clickable' : ''}`}
                  onClick={() => sourceClients.length > 0 && toggleSourceExpanded(source.id)}
                >
                  <div className="funnel-info">
                    <div className="funnel-icon">
                      <Users size={20} />
                    </div>
                    <div className="funnel-details">
                      <h3>
                        {source.name}
                        {!source.workspace_id && (
                          <>
                            <span 
                              className="global-badge" 
                              title="מקור גלובלי - לא משויך ל-workspace"
                              style={{
                                marginRight: '8px',
                                fontSize: '0.7rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: 'var(--accent-primary)',
                                color: 'white',
                                fontWeight: 'normal'
                              }}
                            >
                              גלובלי
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAssignSourceToWorkspace(source.id, source.name);
                              }}
                              className="btn btn-sm btn-ghost"
                              style={{
                                marginRight: '8px',
                                fontSize: '0.75rem',
                                padding: '2px 8px',
                                height: 'auto'
                              }}
                              title="שייך מקור זה ל-workspace שלי"
                            >
                              שייך אלי
                            </button>
                          </>
                        )}
                      </h3>
                    </div>
                  </div>
                  
                  <div className="funnel-stats">
                    <div className="stat-box">
                      <span className="stat-value">{source.client_count}</span>
                      <span className="stat-label">לקוחות</span>
                    </div>
                    {sourceClients.length > 0 && (
                      <div className="expand-icon">
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </div>
                    )}
                  </div>
                </div>
                
                {isExpanded && sourceClients.length > 0 && (
                  <div className="source-clients-list">
                    {sourceClients.map(client => (
                      <div key={client.id} className="source-client-item">
                        <span className="client-name">{client.name}</span>
                        
                        {editingClient === client.id ? (
                          <div className="source-edit-container">
                            <select
                              className="form-input source-select"
                              value={selectedSourceId}
                              onChange={(e) => handleSourceChange(e.target.value)}
                            >
                              <option value="">ללא מקור</option>
                              {stats.sources?.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                            
                            {isReferralSource() && (
                              <input
                                type="text"
                                className="form-input sub-source-input"
                                placeholder="מי הפנה?"
                                value={subSourceValue}
                                onChange={(e) => setSubSourceValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveClientSource(client.id);
                                  if (e.key === 'Escape') cancelEditingSource();
                                }}
                              />
                            )}
                            
                            <button
                              className="btn btn-icon btn-sm btn-success"
                              onClick={() => saveClientSource(client.id)}
                              title="שמור"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              className="btn btn-icon btn-sm btn-ghost"
                              onClick={cancelEditingSource}
                              title="בטל"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            className="sub-source-btn has-value"
                            onClick={() => startEditingSource(client)}
                            title="שינוי מקור הגעה"
                          >
                            <UserPlus size={14} />
                            <span>{getSourceDisplayName(client) || 'שנה מקור'}</span>
                          </button>
                        )}
                        
                        <span className="client-date">
                          {new Date(client.created_at).toLocaleDateString('he-IL')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          
          {/* Show clients without source */}
          {stats.noSourceCount > 0 && (
            <div className="funnel-item-wrapper">
              <div 
                className="funnel-item clickable no-source"
                onClick={() => toggleSourceExpanded('no-source')}
              >
                <div className="funnel-info">
                  <div className="funnel-icon">
                    <Users size={20} />
                  </div>
                  <div className="funnel-details">
                    <h3>ללא מקור</h3>
                  </div>
                </div>
                
                <div className="funnel-stats">
                  <div className="stat-box">
                    <span className="stat-value">{stats.noSourceCount}</span>
                    <span className="stat-label">לקוחות</span>
                  </div>
                  <div className="expand-icon">
                    {expandedSources['no-source'] ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </div>
                </div>
              </div>
              
              {expandedSources['no-source'] && (
                <div className="source-clients-list">
                  {getClientsWithoutSource().map(client => (
                    <div key={client.id} className="source-client-item">
                      <span className="client-name">{client.name}</span>
                      
                      {editingClient === client.id ? (
                        <div className="source-edit-container">
                          <select
                            className="form-input source-select"
                            value={selectedSourceId}
                            onChange={(e) => handleSourceChange(e.target.value)}
                            autoFocus
                          >
                            <option value="">ללא מקור</option>
                            {stats.sources?.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                          
                          {isReferralSource() && (
                            <input
                              type="text"
                              className="form-input sub-source-input"
                              placeholder="מי הפנה?"
                              value={subSourceValue}
                              onChange={(e) => setSubSourceValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveClientSource(client.id);
                                if (e.key === 'Escape') cancelEditingSource();
                              }}
                            />
                          )}
                          
                          <button
                            className="btn btn-icon btn-sm btn-success"
                            onClick={() => saveClientSource(client.id)}
                            title="שמור"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            className="btn btn-icon btn-sm btn-ghost"
                            onClick={cancelEditingSource}
                            title="בטל"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="sub-source-btn"
                          onClick={() => startEditingSource(client)}
                          title="הוספת מקור הגעה"
                        >
                          <UserPlus size={14} />
                          <span>הוסף מקור</span>
                        </button>
                      )}
                      
                      <span className="client-date">
                        {new Date(client.created_at).toLocaleDateString('he-IL')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="funnel-chart-container">
          <div className="chart-sources">
            {sourcesWithClients.map((source) => (
              <div key={source.id} className="chart-node source-node">
                <div className="chart-node-icon">
                  <Users size={20} />
                </div>
                <div className="chart-node-title">{source.name}</div>
                <div className="chart-node-value">{source.client_count} לקוחות</div>
                <div className="flow-arrow-indicator">
                  <ArrowDown size={16} className="text-gray-300 mt-2" />
                </div>
              </div>
            ))}
            
            {stats.noSourceCount > 0 && (
              <div className="chart-node source-node no-source">
                <div className="chart-node-icon">
                  <Users size={20} />
                </div>
                <div className="chart-node-title">ללא מקור</div>
                <div className="chart-node-value">{stats.noSourceCount} לקוחות</div>
                <div className="flow-arrow-indicator">
                  <ArrowDown size={16} className="text-gray-300 mt-2" />
                </div>
              </div>
            )}
          </div>

          <div className="merge-point"></div>

          <div className="chart-node target-node">
            <div className="chart-node-icon">
              <Filter size={24} />
            </div>
            <div className="chart-node-title">סך הכל לקוחות</div>
            <div className="chart-node-value text-xl">{totalClients}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MarketingFunnels;

