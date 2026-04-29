import { useState, useRef, useEffect, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronDown, Plus, Settings, LogOut, Check, Users } from 'lucide-react';
import useStore from '../store/useStore';
import './WorkspaceSwitcher.css';

// Separate DropdownContent component for consistency
const DropdownContent = forwardRef(({
  workspaces,
  currentWorkspace,
  handleWorkspaceChange,
  setShowCreateModal,
  goToSettings,
  goToProfile,
  handleLogout,
  getRoleLabel,
  getRoleColor,
  isCollapsed
}, ref) => {
  return (
    <div 
      className={`ws-dropdown ${isCollapsed ? 'ws-dropdown-collapsed' : ''}`} 
      ref={ref}
      onClick={e => e.stopPropagation()}
    >
      <div className="ws-dropdown-section-title">Workspaces</div>
      
      <div className="ws-list">
        {workspaces.map(ws => (
          <button 
            key={ws.id}
            className={`ws-item ${ws.id === currentWorkspace?.id ? 'active' : ''}`}
            onClick={() => handleWorkspaceChange(ws)}
          >
            <Building2 size={16} />
            <span className="ws-item-name">{ws.name}</span>
            <span className={`ws-role ${getRoleColor(ws.role)}`}>
              {getRoleLabel(ws.role)}
            </span>
            {ws.id === currentWorkspace?.id && <Check size={14} className="ws-check" />}
          </button>
        ))}
      </div>

      <button className="ws-action create" onClick={() => setShowCreateModal(true)}>
        <Plus size={16} />
        <span>צור Workspace חדש</span>
      </button>

      <div className="ws-dropdown-divider" />

      <button className="ws-action" onClick={goToSettings}>
        <Settings size={16} />
        <span>הגדרות Workspace</span>
      </button>

      <button className="ws-action" onClick={goToProfile}>
        <Users size={16} />
        <span>פרופיל אישי</span>
      </button>

      <div className="ws-dropdown-divider" />

      <button className="ws-action logout" onClick={handleLogout}>
        <LogOut size={16} />
        <span>התנתק</span>
      </button>
    </div>
  );
});

DropdownContent.displayName = 'DropdownContent';

function WorkspaceSwitcher({ collapsed = false, isMobile = false, onClose }) {
  const { 
    user, 
    workspaces, 
    currentWorkspace, 
    setCurrentWorkspace, 
    logout,
    createWorkspace 
  } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const dropdownRef = useRef(null);
  const menuRef = useRef(null); // Ref for the dropdown menu
  const navigate = useNavigate();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Check if click is outside BOTH the trigger (dropdownRef) AND the menu (menuRef)
      const isOutsideTrigger = dropdownRef.current && !dropdownRef.current.contains(event.target);
      const isOutsideMenu = !menuRef.current || !menuRef.current.contains(event.target);
      
      if (isOutsideTrigger && isOutsideMenu) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleWorkspaceChange = (workspace) => {
    if (workspace.id !== currentWorkspace?.id) {
      setCurrentWorkspace(workspace);
      // Force page reload to refresh all data
      window.location.reload();
    }
    setIsOpen(false);
    onClose?.();
  };

  const handleCreateWorkspace = async (e) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    setIsCreating(true);
    try {
      const workspace = await createWorkspace(newWorkspaceName.trim());
      setNewWorkspaceName('');
      setShowCreateModal(false);
      handleWorkspaceChange(workspace);
    } catch (error) {
      console.error('Failed to create workspace:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const goToSettings = () => {
    navigate('/settings/workspace');
    setIsOpen(false);
    onClose?.();
  };

  const goToProfile = () => {
    navigate('/profile');
    setIsOpen(false);
    onClose?.();
  };

  const getRoleLabel = (role) => {
    switch (role) {
      case 'owner': return 'בעלים';
      case 'admin': return 'מנהל';
      case 'member': return 'חבר';
      default: return role;
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'owner': return 'role-owner';
      case 'admin': return 'role-admin';
      case 'member': return 'role-member';
      default: return '';
    }
  };

  const createWorkspaceModal = showCreateModal && createPortal(
    <div className="ws-modal-overlay" onClick={() => setShowCreateModal(false)}>
      <div className="ws-modal" onClick={e => e.stopPropagation()}>
        <h3>צור Workspace חדש</h3>
        <form onSubmit={handleCreateWorkspace}>
          <input
            type="text"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            placeholder="שם ה-Workspace"
            autoFocus
          />
          <div className="ws-modal-actions">
            <button type="button" onClick={() => setShowCreateModal(false)}>ביטול</button>
            <button type="submit" className="primary" disabled={isCreating}>
              {isCreating ? 'יוצר...' : 'צור'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );

  const dropdownProps = {
    workspaces,
    currentWorkspace,
    handleWorkspaceChange,
    setShowCreateModal,
    goToSettings,
    goToProfile,
    handleLogout,
    getRoleLabel,
    getRoleColor,
    ref: menuRef
  };

  if (collapsed && !isMobile) {
    // Collapsed mode - avatar button with dropdown rendered via portal
    return (
      <>
        <div className="workspace-switcher collapsed" ref={dropdownRef}>
          <button 
            className="ws-avatar-btn"
            onClick={() => setIsOpen(!isOpen)}
            title={`${currentWorkspace?.name} (${getRoleLabel(currentWorkspace?.role)})`}
          >
            <div className="user-avatar">
              {currentWorkspace?.name?.charAt(0).toUpperCase() || user?.name?.charAt(0).toUpperCase()}
            </div>
          </button>
        </div>

        {/* Dropdown rendered via portal to escape sidebar stacking context */}
        {isOpen && createPortal(
          <div className="ws-collapsed-overlay" onClick={() => setIsOpen(false)}>
            <DropdownContent 
              {...dropdownProps}
              isCollapsed={true}
            />
          </div>,
          document.body
        )}

        {createWorkspaceModal}
      </>
    );
  }

  // Expanded mode
  return (
    <div className="workspace-switcher expanded" ref={dropdownRef}>
      <button 
        className="ws-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="user-avatar">
          {user?.name?.charAt(0).toUpperCase()}
        </div>
        <div className="ws-trigger-info">
          <span className="ws-trigger-name">{user?.name}</span>
          <span className="ws-trigger-workspace">
            {currentWorkspace?.name}
            {currentWorkspace?.role && (
              <span className={`ws-role-inline ${getRoleColor(currentWorkspace?.role)}`}>
                ({getRoleLabel(currentWorkspace?.role)})
              </span>
            )}
          </span>
        </div>
        <ChevronDown size={16} className={`ws-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <DropdownContent 
          {...dropdownProps}
          isCollapsed={false}
        />
      )}

      {createWorkspaceModal}
    </div>
  );
}

export default WorkspaceSwitcher;
