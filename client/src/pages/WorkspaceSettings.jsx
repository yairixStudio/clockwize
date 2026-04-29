import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, Users, Link2, Copy, Check, Trash2, 
  UserPlus, Crown, Shield, User, RefreshCw, 
  AlertTriangle, Settings, ChevronLeft
} from 'lucide-react';
import useStore from '../store/useStore';
import { workspacesAPI } from '../services/api';
import { useModal } from '../components/Modal';
import './WorkspaceSettings.css';

function WorkspaceSettings() {
  const { 
    currentWorkspace, 
    workspaceRole, 
    updateWorkspace,
    deleteWorkspace,
    leaveWorkspace,
    loadWorkspaces,
    canManageWorkspace,
    canInviteMembers,
    canRemoveMember
  } = useStore();
  
  const navigate = useNavigate();
  const modal = useModal();
  
  const [activeTab, setActiveTab] = useState('members');
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workspaceName, setWorkspaceName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(null);

  useEffect(() => {
    if (currentWorkspace) {
      setWorkspaceName(currentWorkspace.name);
      loadData();
    }
  }, [currentWorkspace?.id]);

  const loadData = async () => {
    if (!currentWorkspace) return;
    setLoading(true);
    try {
      const [membersData, invitesData] = await Promise.all([
        workspacesAPI.getMembers(currentWorkspace.id),
        canInviteMembers() ? workspacesAPI.getInvites(currentWorkspace.id) : Promise.resolve([])
      ]);
      setMembers(membersData);
      setInvites(invitesData);
    } catch (error) {
      console.error('Failed to load workspace data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveName = async () => {
    if (!workspaceName.trim() || workspaceName === currentWorkspace.name) return;
    
    setIsSaving(true);
    try {
      await updateWorkspace(currentWorkspace.id, { name: workspaceName.trim() });
      modal.success('שם ה-Workspace עודכן');
    } catch (error) {
      modal.error(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateInvite = async () => {
    try {
      const invite = await workspacesAPI.createInvite(currentWorkspace.id, { role: 'member' });
      setInvites([...invites, invite]);
      modal.success('קישור הזמנה נוצר');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleCopyInvite = async (invite) => {
    const url = `${window.location.origin}/join/${invite.code}`;
    await navigator.clipboard.writeText(url);
    setCopiedInvite(invite.id);
    setTimeout(() => setCopiedInvite(null), 2000);
  };

  const handleDeleteInvite = async (inviteId) => {
    try {
      await workspacesAPI.deleteInvite(currentWorkspace.id, inviteId);
      setInvites(invites.filter(i => i.id !== inviteId));
      modal.success('ההזמנה בוטלה');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleUpdateMemberRole = async (userId, newRole) => {
    try {
      await workspacesAPI.updateMemberRole(currentWorkspace.id, userId, newRole);
      setMembers(members.map(m => m.user_id === userId ? { ...m, role: newRole } : m));
      modal.success('תפקיד עודכן');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleRemoveMember = async (member) => {
    const confirmed = await modal.confirm(
      `האם להסיר את ${member.user_name} מה-Workspace?`,
      { title: 'הסרת חבר', confirmText: 'הסר', type: 'error' }
    );
    
    if (confirmed) {
      try {
        await workspacesAPI.removeMember(currentWorkspace.id, member.user_id);
        setMembers(members.filter(m => m.user_id !== member.user_id));
        modal.success('החבר הוסר');
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  const handleLeaveWorkspace = async () => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך לעזוב את ה-Workspace?',
      { title: 'עזיבת Workspace', confirmText: 'עזוב', type: 'error' }
    );
    
    if (confirmed) {
      try {
        await leaveWorkspace(currentWorkspace.id);
        navigate('/');
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  const handleDeleteWorkspace = async () => {
    const confirmed = await modal.confirm(
      'פעולה זו תמחק את כל הנתונים של ה-Workspace כולל לקוחות, פרויקטים ורשומות זמן. האם להמשיך?',
      { title: 'מחיקת Workspace', confirmText: 'מחק', type: 'error' }
    );
    
    if (confirmed) {
      try {
        await deleteWorkspace(currentWorkspace.id);
        navigate('/');
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'owner': return <Crown size={14} />;
      case 'admin': return <Shield size={14} />;
      default: return <User size={14} />;
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

  if (!currentWorkspace) {
    return (
      <div className="page">
        <div className="empty-state">
          <p>לא נבחר Workspace</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page fade-in">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/settings')}>
          <ChevronLeft size={20} />
          חזרה להגדרות
        </button>
        <div>
          <h1 className="page-title">
            <Building2 size={24} />
            הגדרות Workspace
          </h1>
          <p className="page-subtitle">ניהול {currentWorkspace.name}</p>
        </div>
      </div>

      <div className="workspace-settings-container">
        <div className="ws-settings-tabs">
          <button
            className={`tab-btn ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            <Users size={16} />
            חברים ({members.length})
          </button>
          {canInviteMembers() && (
            <button
              className={`tab-btn ${activeTab === 'invites' ? 'active' : ''}`}
              onClick={() => setActiveTab('invites')}
            >
              <Link2 size={16} />
              הזמנות ({invites.length})
            </button>
          )}
          {canManageWorkspace() && (
            <button
              className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              <Settings size={16} />
              כללי
            </button>
          )}
        </div>

        <div className="ws-settings-content">
          {loading ? (
            <div className="loading-state">טוען...</div>
          ) : (
            <>
              {activeTab === 'members' && (
                <div className="members-section">
                  <div className="section-header">
                    <h3>חברי הצוות</h3>
                    <button className="btn-icon" onClick={loadData} title="רענן">
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  
                  <div className="members-list">
                    {members.map(member => (
                      <div key={member.user_id} className="member-row">
                        <div className="member-avatar">
                          {member.user_name?.charAt(0).toUpperCase()}
                        </div>
                        <div className="member-info">
                          <span className="member-name">{member.user_name}</span>
                          <span className="member-email">{member.user_email}</span>
                        </div>
                        <div className={`member-role role-${member.role}`}>
                          {getRoleIcon(member.role)}
                          <span>{getRoleLabel(member.role)}</span>
                        </div>
                        <div className="member-actions">
                          {canManageWorkspace() && member.role !== 'owner' && (
                            <select
                              value={member.role}
                              onChange={(e) => handleUpdateMemberRole(member.user_id, e.target.value)}
                              className="role-select"
                            >
                              <option value="admin">מנהל</option>
                              <option value="member">חבר</option>
                            </select>
                          )}
                          {canRemoveMember(member.role) && member.role !== 'owner' && (
                            <button 
                              className="btn-icon danger"
                              onClick={() => handleRemoveMember(member)}
                              title="הסר"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'invites' && canInviteMembers() && (
                <div className="invites-section">
                  <div className="section-header">
                    <h3>קישורי הזמנה</h3>
                    <button className="btn-primary" onClick={handleCreateInvite}>
                      <UserPlus size={16} />
                      צור קישור הזמנה
                    </button>
                  </div>

                  <p className="section-description">
                    שלח קישור הזמנה לאנשים שברצונך להזמין ל-Workspace. הם יוכלו להצטרף גם אם אין להם חשבון.
                  </p>

                  {invites.length === 0 ? (
                    <div className="empty-invites">
                      <Link2 size={32} />
                      <p>אין הזמנות פעילות</p>
                    </div>
                  ) : (
                    <div className="invites-list">
                      {invites.map(invite => (
                        <div key={invite.id} className="invite-row">
                          <div className="invite-info">
                            <code className="invite-code">{invite.code}</code>
                            <span className="invite-meta">
                              תפקיד: {getRoleLabel(invite.role)} 
                              {invite.uses_remaining && ` • ${invite.uses_remaining} שימושים נותרו`}
                              {invite.expires_at && ` • פג תוקף ${new Date(invite.expires_at).toLocaleDateString('he-IL')}`}
                            </span>
                          </div>
                          <div className="invite-actions">
                            <button 
                              className="btn-icon"
                              onClick={() => handleCopyInvite(invite)}
                              title="העתק קישור"
                            >
                              {copiedInvite === invite.id ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                            <button 
                              className="btn-icon danger"
                              onClick={() => handleDeleteInvite(invite.id)}
                              title="מחק"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'general' && canManageWorkspace() && (
                <div className="general-section">
                  <div className="setting-group">
                    <label>שם ה-Workspace</label>
                    <div className="setting-input-row">
                      <input
                        type="text"
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                        placeholder="שם ה-Workspace"
                      />
                      <button 
                        className="btn-primary"
                        onClick={handleSaveName}
                        disabled={isSaving || !workspaceName.trim() || workspaceName === currentWorkspace.name}
                      >
                        {isSaving ? 'שומר...' : 'שמור'}
                      </button>
                    </div>
                  </div>

                  <div className="danger-zone">
                    <h3>
                      <AlertTriangle size={18} />
                      אזור מסוכן
                    </h3>
                    
                    <div className="danger-action">
                      <div>
                        <strong>מחק Workspace</strong>
                        <p>פעולה זו תמחק את כל הנתונים לצמיתות ואינה ניתנת לביטול.</p>
                      </div>
                      <button className="btn-danger" onClick={handleDeleteWorkspace}>
                        מחק Workspace
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {workspaceRole !== 'owner' && (
                <div className="leave-section">
                  <button className="btn-text danger" onClick={handleLeaveWorkspace}>
                    עזוב את ה-Workspace
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkspaceSettings;

