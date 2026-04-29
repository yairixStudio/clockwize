import { create } from 'zustand';
import { authAPI, timerAPI, statsAPI, remindersAPI, addonsAPI, workspacesAPI } from '../services/api';

const useStore = create((set, get) => ({
  // Auth state
  user: null,
  isAuthenticated: false,
  isLoading: true,
  
  // Workspace state
  workspaces: [],
  currentWorkspace: null,
  workspaceRole: null, // 'owner', 'admin', 'member'
  
  // Timer state - now supports multiple timers
  activeTimers: [],
  timerOperationInProgress: false, // Lock to prevent sync during operations
  
  // Stats state
  dashboardStats: null,
  
  // Integrations state
  integrations: [],

  // Reminders state
  reminders: [],
  unreadRemindersCount: 0,

  // Addons state (user extensions)
  enabledAddons: ['credentials', 'files', 'notes'], // default enabled
  
  // Initialize auth from token
  initAuth: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ isLoading: false });
      return;
    }
    
    try {
      const data = await authAPI.getMe();
      const { workspaces, currentWorkspace, ...user } = data;
      
      // Restore workspace from localStorage or use first one
      const savedWorkspaceId = localStorage.getItem('currentWorkspaceId');
      let activeWorkspace = currentWorkspace;
      
      if (savedWorkspaceId && workspaces) {
        const found = workspaces.find(w => w.id === savedWorkspaceId);
        if (found) activeWorkspace = found;
      }
      
      if (activeWorkspace) {
        localStorage.setItem('currentWorkspaceId', activeWorkspace.id);
      }
      
      // Load addons before marking as loaded (needed for addon-protected routes)
      let loadedAddons = get().enabledAddons;
      try {
        loadedAddons = await addonsAPI.getEnabled();
      } catch (e) {
        // Keep defaults on error
      }

      set({
        user,
        workspaces: workspaces || [],
        currentWorkspace: activeWorkspace,
        workspaceRole: activeWorkspace?.role || null,
        isAuthenticated: true,
        isLoading: false,
        enabledAddons: loadedAddons
      });

      // Load active timers
      get().loadActiveTimers();
      get().loadIntegrations();
    } catch (error) {
      localStorage.removeItem('token');
      localStorage.removeItem('currentWorkspaceId');
      set({ isLoading: false });
    }
  },
  
  // Login
  login: async (email, password) => {
    const response = await authAPI.login({ email, password });
    console.log('Store login - response:', response);
    const { user, token, workspaces, currentWorkspace } = response;
    localStorage.setItem('token', token);
    
    // Set current workspace
    if (currentWorkspace) {
      localStorage.setItem('currentWorkspaceId', currentWorkspace.id);
    }
    
    set({ 
      user, 
      workspaces: workspaces || [],
      currentWorkspace,
      workspaceRole: currentWorkspace?.role || null,
      isAuthenticated: true 
    });
    get().loadActiveTimers();
    console.log('Store login - returning response with requiresPasswordReset:', response.requiresPasswordReset);
    return response; // Return full response including requiresPasswordReset if present
  },
  
  // Register
  register: async (name, email, password) => {
    const response = await authAPI.register({ name, email, password });
    const { user, token, workspaces, currentWorkspace } = response;
    localStorage.setItem('token', token);
    
    if (currentWorkspace) {
      localStorage.setItem('currentWorkspaceId', currentWorkspace.id);
    }
    
    set({ 
      user, 
      workspaces: workspaces || [],
      currentWorkspace,
      workspaceRole: currentWorkspace?.role || null,
      isAuthenticated: true 
    });
  },
  
  // Logout
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('currentWorkspaceId');
    set({ 
      user: null, 
      isAuthenticated: false, 
      activeTimers: [], 
      dashboardStats: null,
      workspaces: [],
      currentWorkspace: null,
      workspaceRole: null
    });
  },
  
  // Update user
  updateUser: (userData) => {
    set({ user: { ...get().user, ...userData } });
  },

  // Workspace functions
  setCurrentWorkspace: (workspace) => {
    localStorage.setItem('currentWorkspaceId', workspace.id);
    set({ 
      currentWorkspace: workspace,
      workspaceRole: workspace.role,
      // Clear cached data that's workspace-specific
      dashboardStats: null,
      activeTimers: [],
      reminders: []
    });
    // Reload workspace-specific data
    get().loadActiveTimers();
    get().loadDashboardStats();
    get().loadIntegrations();
  },

  loadWorkspaces: async () => {
    try {
      const workspaces = await workspacesAPI.getAll();
      set({ workspaces });
      return workspaces;
    } catch (error) {
      console.error('Failed to load workspaces:', error);
      return [];
    }
  },

  createWorkspace: async (name) => {
    try {
      const workspace = await workspacesAPI.create({ name });
      set(state => ({
        workspaces: [...state.workspaces, workspace]
      }));
      return workspace;
    } catch (error) {
      console.error('Failed to create workspace:', error);
      throw error;
    }
  },

  updateWorkspace: async (id, data) => {
    try {
      const updated = await workspacesAPI.update(id, data);
      set(state => ({
        workspaces: state.workspaces.map(w => w.id === id ? { ...w, ...updated } : w),
        currentWorkspace: state.currentWorkspace?.id === id 
          ? { ...state.currentWorkspace, ...updated } 
          : state.currentWorkspace
      }));
      return updated;
    } catch (error) {
      console.error('Failed to update workspace:', error);
      throw error;
    }
  },

  deleteWorkspace: async (id) => {
    try {
      await workspacesAPI.delete(id);
      const remaining = get().workspaces.filter(w => w.id !== id);
      set({ workspaces: remaining });
      
      // If deleted current workspace, switch to first available
      if (get().currentWorkspace?.id === id && remaining.length > 0) {
        get().setCurrentWorkspace(remaining[0]);
      }
    } catch (error) {
      console.error('Failed to delete workspace:', error);
      throw error;
    }
  },

  leaveWorkspace: async (id) => {
    try {
      await workspacesAPI.leave(id);
      const remaining = get().workspaces.filter(w => w.id !== id);
      set({ workspaces: remaining });
      
      // If left current workspace, switch to first available
      if (get().currentWorkspace?.id === id && remaining.length > 0) {
        get().setCurrentWorkspace(remaining[0]);
      }
    } catch (error) {
      console.error('Failed to leave workspace:', error);
      throw error;
    }
  },

  // Permission helpers
  canManageWorkspace: () => {
    const role = get().workspaceRole;
    return role === 'owner';
  },

  canInviteMembers: () => {
    const role = get().workspaceRole;
    return role === 'owner' || role === 'admin';
  },

  canRemoveMember: (memberRole) => {
    const role = get().workspaceRole;
    if (role === 'owner') return true;
    if (role === 'admin' && memberRole === 'member') return true;
    return false;
  },

  canViewAllTimeEntries: () => {
    const role = get().workspaceRole;
    return role === 'owner' || role === 'admin';
  },
  
  // Timer functions - updated for multiple timers
  loadActiveTimers: async () => {
    // Skip sync if an operation is in progress
    if (get().timerOperationInProgress) {
      console.log('[TimerSync] Skipping sync - operation in progress');
      return;
    }
    
    try {
      const timers = await timerAPI.getActive();
      console.log('[TimerSync] Loaded timers from server:', timers?.length || 0);
      set({ activeTimers: Array.isArray(timers) ? timers : [] });
    } catch (error) {
      console.error('Failed to load active timers:', error);
      // Don't clear timers on error - keep existing state
    }
  },

  // Integrations
  loadIntegrations: async () => {
    try {
      const token = localStorage.getItem('token');
      const workspaceId = localStorage.getItem('currentWorkspaceId');
      const headers = {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(workspaceId && { 'X-Workspace-Id': workspaceId })
      };
      
      const res = await fetch('/api/integrations', { headers });
      if (res.ok) {
        const data = await res.json();
        set({ integrations: data });
      }
    } catch (error) {
      console.error('Failed to load integrations:', error);
    }
  },
  
  // Get timer for specific project/task
  getTimerForProject: (projectId, taskId = null) => {
    const { activeTimers } = get();
    return activeTimers.find(t => 
      t.project_id === projectId && 
      (taskId ? t.task_id === taskId : !t.task_id)
    );
  },
  
  // Check if there's any active timer for a project (including tasks)
  hasTimerForProject: (projectId) => {
    const { activeTimers } = get();
    return activeTimers.some(t => t.project_id === projectId);
  },
  
  startTimer: async (projectId, taskId) => {
    set({ timerOperationInProgress: true });
    try {
      const timer = await timerAPI.start(projectId, taskId);
      set({ activeTimers: [...get().activeTimers, timer] });
      return timer;
    } finally {
      set({ timerOperationInProgress: false });
    }
  },
  
  pauseTimer: async (timerId) => {
    set({ timerOperationInProgress: true });
    try {
      const timer = await timerAPI.pause(timerId);
      set({
        activeTimers: get().activeTimers.map(t => 
          t.id === timerId ? timer : t
        )
      });
      return timer;
    } finally {
      set({ timerOperationInProgress: false });
    }
  },
  
  resumeTimer: async (timerId) => {
    set({ timerOperationInProgress: true });
    try {
      const timer = await timerAPI.resume(timerId);
      set({
        activeTimers: get().activeTimers.map(t => 
          t.id === timerId ? timer : t
        )
      });
      return timer;
    } finally {
      set({ timerOperationInProgress: false });
    }
  },
  
  stopTimer: async (timerId, notes, intervals, options = {}) => {
    set({ timerOperationInProgress: true });
    try {
      const entry = await timerAPI.stop(timerId, notes, intervals, options);
      set({
        activeTimers: get().activeTimers.filter(t => t.id !== timerId)
      });
      return entry;
    } finally {
      set({ timerOperationInProgress: false });
    }
  },
  
  discardTimer: async (timerId) => {
    set({ timerOperationInProgress: true });
    try {
      await timerAPI.discard(timerId);
      set({
        activeTimers: get().activeTimers.filter(t => t.id !== timerId)
      });
    } finally {
      set({ timerOperationInProgress: false });
    }
  },

  updateTimerStartTime: async (timerId, startTime) => {
    set({ timerOperationInProgress: true });
    try {
      const timer = await timerAPI.updateStartTime(timerId, startTime);
      set({
        activeTimers: get().activeTimers.map(t => 
          t.id === timerId ? timer : t
        )
      });
      return timer;
    } finally {
      set({ timerOperationInProgress: false });
    }
  },
  
  // Stats
  loadDashboardStats: async (params = {}) => {
    try {
      const stats = await statsAPI.getDashboard(params);
      set({ dashboardStats: stats });
    } catch (error) {
      console.error('Failed to load dashboard stats:', error);
    }
  },

  // Reminders
  loadReminders: async (params) => {
    try {
      const reminders = await remindersAPI.getAll(params);
      set({ reminders });
      
      // Update unread count based on current time
      const now = new Date();
      const unreadCount = reminders.filter(r => 
        !r.is_read && r.due_date && new Date(r.due_date) <= now
      ).length;
      set({ unreadRemindersCount: unreadCount });
      
      return reminders;
    } catch (error) {
      console.error('Failed to load reminders:', error);
      return [];
    }
  },

  addReminder: async (data) => {
    try {
      const reminder = await remindersAPI.create(data);
      set(state => ({ 
        reminders: [...state.reminders, reminder] 
      }));
      get().loadReminders(); // Reload to refresh sort/unread count
      return reminder;
    } catch (error) {
      console.error('Failed to add reminder:', error);
      throw error;
    }
  },

  updateReminder: async (id, data) => {
    try {
      const updated = await remindersAPI.update(id, data);
      set(state => ({
        reminders: state.reminders.map(r => r.id === id ? updated : r)
      }));
      get().loadReminders(); // Reload for recurring logic or re-sort
      return updated;
    } catch (error) {
      console.error('Failed to update reminder:', error);
      throw error;
    }
  },

  deleteReminder: async (id) => {
    try {
      await remindersAPI.delete(id);
      set(state => ({
        reminders: state.reminders.filter(r => r.id !== id)
      }));
      get().loadReminders(); // Refresh count
    } catch (error) {
      console.error('Failed to delete reminder:', error);
      throw error;
    }
  },

  // Addons (User Extensions)
  loadEnabledAddons: async () => {
    try {
      const enabledAddons = await addonsAPI.getEnabled();
      set({ enabledAddons });
      return enabledAddons;
    } catch (error) {
      console.error('Failed to load enabled addons:', error);
      // Keep defaults on error
      return get().enabledAddons;
    }
  },

  isAddonEnabled: (addonId) => {
    return get().enabledAddons.includes(addonId);
  },

  updateAddon: async (addonId, isEnabled) => {
    try {
      await addonsAPI.update(addonId, isEnabled);
      if (isEnabled) {
        set(state => ({
          enabledAddons: [...state.enabledAddons, addonId]
        }));
      } else {
        set(state => ({
          enabledAddons: state.enabledAddons.filter(id => id !== addonId)
        }));
      }
    } catch (error) {
      console.error('Failed to update addon:', error);
      throw error;
    }
  }
}));

export default useStore;
