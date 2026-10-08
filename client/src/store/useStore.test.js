import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  authAPI: { getMe: vi.fn(), login: vi.fn(), register: vi.fn() },
  timerAPI: {
    getActive: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    discard: vi.fn(),
    updateStartTime: vi.fn()
  },
  statsAPI: { getDashboard: vi.fn() },
  remindersAPI: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  addonsAPI: { getEnabled: vi.fn(), update: vi.fn() },
  workspacesAPI: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), leave: vi.fn() }
}));

vi.mock('../services/api', () => apiMocks);

import useStore from './useStore';

const { authAPI, timerAPI, statsAPI, remindersAPI, addonsAPI, workspacesAPI } = apiMocks;
const initialState = useStore.getState();
const state = () => useStore.getState();

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const wsA = { id: 'ws-a', name: 'אישי', role: 'owner' };
const wsB = { id: 'ws-b', name: 'צוות', role: 'member' };
const user = { id: 'u1', name: 'דנה', email: 'dana@example.com' };

let fetchMock;

beforeEach(() => {
  useStore.setState(initialState, true);

  Object.values(apiMocks).forEach(group => Object.values(group).forEach(fn => fn.mockReset()));
  timerAPI.getActive.mockResolvedValue([]);
  statsAPI.getDashboard.mockResolvedValue({ total: 0 });
  remindersAPI.getAll.mockResolvedValue([]);
  addonsAPI.getEnabled.mockResolvedValue(['credentials', 'files', 'notes']);

  // loadIntegrations calls fetch directly instead of going through the api module
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
  vi.stubGlobal('fetch', fetchMock);

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('initial state', () => {
  it('starts logged out and loading, with the default addons', () => {
    expect(state()).toMatchObject({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      workspaces: [],
      currentWorkspace: null,
      activeTimers: [],
      enabledAddons: ['credentials', 'files', 'notes']
    });
  });
});

describe('initAuth', () => {
  it('just stops loading when there is no token', async () => {
    await state().initAuth();

    expect(authAPI.getMe).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ isLoading: false, isAuthenticated: false });
  });

  it('restores the user and the saved workspace', async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('currentWorkspaceId', 'ws-b');
    authAPI.getMe.mockResolvedValue({ ...user, workspaces: [wsA, wsB], currentWorkspace: wsA });
    addonsAPI.getEnabled.mockResolvedValue(['notes']);
    timerAPI.getActive.mockResolvedValue([{ id: 't1', project_id: 'p1' }]);

    await state().initAuth();

    expect(state()).toMatchObject({
      user,
      workspaces: [wsA, wsB],
      currentWorkspace: wsB,
      workspaceRole: 'member',
      isAuthenticated: true,
      isLoading: false,
      enabledAddons: ['notes']
    });
    expect(state().user).not.toHaveProperty('workspaces');
    expect(localStorage.getItem('currentWorkspaceId')).toBe('ws-b');
    await vi.waitFor(() => expect(state().activeTimers).toEqual([{ id: 't1', project_id: 'p1' }]));
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations', expect.anything());
  });

  it('falls back to the server workspace when the saved one no longer exists', async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('currentWorkspaceId', 'deleted-ws');
    authAPI.getMe.mockResolvedValue({ ...user, workspaces: [wsA, wsB], currentWorkspace: wsA });

    await state().initAuth();

    expect(state().currentWorkspace).toEqual(wsA);
    expect(state().workspaceRole).toBe('owner');
    expect(localStorage.getItem('currentWorkspaceId')).toBe('ws-a');
  });

  it('keeps the default addons when loading them fails', async () => {
    localStorage.setItem('token', 'tok');
    authAPI.getMe.mockResolvedValue({ ...user, workspaces: [wsA], currentWorkspace: wsA });
    addonsAPI.getEnabled.mockRejectedValue(new Error('down'));

    await state().initAuth();

    expect(state().isAuthenticated).toBe(true);
    expect(state().enabledAddons).toEqual(['credentials', 'files', 'notes']);
  });

  it('clears an invalid token', async () => {
    localStorage.setItem('token', 'expired');
    localStorage.setItem('currentWorkspaceId', 'ws-a');
    authAPI.getMe.mockRejectedValue(Object.assign(new Error('טוקן לא תקין'), { status: 401 }));

    await state().initAuth();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('currentWorkspaceId')).toBeNull();
    expect(state()).toMatchObject({ isLoading: false, isAuthenticated: false, user: null });
  });
});

describe('login / register / logout', () => {
  it('login stores the token and workspace and returns the full response', async () => {
    const response = { user, token: 'new-token', workspaces: [wsA], currentWorkspace: wsA, requiresPasswordReset: false };
    authAPI.login.mockResolvedValue(response);
    addonsAPI.getEnabled.mockResolvedValue(['files']);

    const result = await state().login('dana@example.com', 'secret');

    expect(authAPI.login).toHaveBeenCalledWith({ email: 'dana@example.com', password: 'secret' });
    expect(result).toBe(response);
    expect(localStorage.getItem('token')).toBe('new-token');
    expect(localStorage.getItem('currentWorkspaceId')).toBe('ws-a');
    expect(state()).toMatchObject({
      user,
      isAuthenticated: true,
      currentWorkspace: wsA,
      workspaceRole: 'owner',
      enabledAddons: ['files']
    });
    expect(timerAPI.getActive).toHaveBeenCalled();
  });

  it('a login that still requires a password reset is not a session: nothing is stored', async () => {
    const response = { requiresPasswordReset: true, resetToken: 'reset-jwt' };
    authAPI.login.mockResolvedValue(response);

    const result = await state().login('dana@example.com', 'secret');

    expect(result).toBe(response);
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('currentWorkspaceId')).toBeNull();
    expect(state()).toMatchObject({ user: null, isAuthenticated: false, currentWorkspace: null, workspaces: [] });
    expect(addonsAPI.getEnabled).not.toHaveBeenCalled();
    expect(timerAPI.getActive).not.toHaveBeenCalled();
  });

  it('login handles a user without workspaces', async () => {
    authAPI.login.mockResolvedValue({ user, token: 't', currentWorkspace: null });

    await state().login('a', 'b');

    expect(state()).toMatchObject({ workspaces: [], currentWorkspace: null, workspaceRole: null, isAuthenticated: true });
    expect(localStorage.getItem('currentWorkspaceId')).toBeNull();
  });

  it('a failed login leaves the store logged out and rethrows', async () => {
    authAPI.login.mockRejectedValue(new Error('אימייל או סיסמה שגויים'));

    await expect(state().login('a', 'b')).rejects.toThrow('אימייל או סיסמה שגויים');

    expect(state().isAuthenticated).toBe(false);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('register sends name, email and password', async () => {
    authAPI.register.mockResolvedValue({ user, token: 't', workspaces: [wsA], currentWorkspace: wsA });

    await state().register('דנה', 'dana@example.com', 'pw');

    expect(authAPI.register).toHaveBeenCalledWith({ name: 'דנה', email: 'dana@example.com', password: 'pw' });
    expect(state().isAuthenticated).toBe(true);
  });

  it('logout clears storage and all per-user state', () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('currentWorkspaceId', 'ws-a');
    useStore.setState({
      user,
      isAuthenticated: true,
      activeTimers: [{ id: 't' }],
      dashboardStats: { a: 1 },
      workspaces: [wsA],
      currentWorkspace: wsA,
      workspaceRole: 'owner',
      enabledAddons: ['credentials'],
      integrations: [{ id: 'i' }],
      reminders: [{ id: 'r' }],
      unreadRemindersCount: 3,
      timerOperationInProgress: true
    });

    state().logout();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('currentWorkspaceId')).toBeNull();
    expect(state()).toMatchObject({
      user: null,
      isAuthenticated: false,
      activeTimers: [],
      dashboardStats: null,
      workspaces: [],
      currentWorkspace: null,
      workspaceRole: null,
      enabledAddons: ['credentials', 'files', 'notes'],
      integrations: [],
      reminders: [],
      unreadRemindersCount: 0,
      timerOperationInProgress: false
    });
  });

  it('updateUser merges fields', () => {
    useStore.setState({ user });
    state().updateUser({ name: 'דנה כהן' });
    expect(state().user).toEqual({ ...user, name: 'דנה כהן' });
  });
});

describe('workspaces', () => {
  it('setCurrentWorkspace switches, clears workspace data and reloads it', async () => {
    useStore.setState({
      currentWorkspace: wsA,
      workspaceRole: 'owner',
      dashboardStats: { old: true },
      activeTimers: [{ id: 'old' }],
      reminders: [{ id: 'r', is_read: false }],
      unreadRemindersCount: 1
    });
    timerAPI.getActive.mockResolvedValue([{ id: 'new-timer' }]);
    statsAPI.getDashboard.mockResolvedValue({ fresh: true });

    state().setCurrentWorkspace(wsB);

    expect(localStorage.getItem('currentWorkspaceId')).toBe('ws-b');
    expect(state()).toMatchObject({
      currentWorkspace: wsB,
      workspaceRole: 'member',
      dashboardStats: null,
      activeTimers: [],
      reminders: [],
      // The badge count is derived from `reminders`, so it must not carry over
      unreadRemindersCount: 0
    });
    await vi.waitFor(() => {
      expect(state().activeTimers).toEqual([{ id: 'new-timer' }]);
      expect(state().dashboardStats).toEqual({ fresh: true });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loadWorkspaces stores the list and returns [] on error', async () => {
    workspacesAPI.getAll.mockResolvedValueOnce([wsA, wsB]);
    await expect(state().loadWorkspaces()).resolves.toEqual([wsA, wsB]);
    expect(state().workspaces).toEqual([wsA, wsB]);

    workspacesAPI.getAll.mockRejectedValueOnce(new Error('x'));
    await expect(state().loadWorkspaces()).resolves.toEqual([]);
    expect(state().workspaces).toEqual([wsA, wsB]);
  });

  it('createWorkspace appends, and rethrows errors', async () => {
    useStore.setState({ workspaces: [wsA] });
    workspacesAPI.create.mockResolvedValueOnce(wsB);

    await state().createWorkspace('צוות');
    expect(workspacesAPI.create).toHaveBeenCalledWith({ name: 'צוות' });
    expect(state().workspaces).toEqual([wsA, wsB]);

    workspacesAPI.create.mockRejectedValueOnce(new Error('dup'));
    await expect(state().createWorkspace('x')).rejects.toThrow('dup');
    expect(state().workspaces).toEqual([wsA, wsB]);
  });

  it('updateWorkspace updates both the list and the current workspace', async () => {
    useStore.setState({ workspaces: [wsA, wsB], currentWorkspace: wsA });
    workspacesAPI.update.mockResolvedValue({ name: 'חדש' });

    await state().updateWorkspace('ws-a', { name: 'חדש' });

    expect(state().workspaces[0]).toEqual({ ...wsA, name: 'חדש' });
    expect(state().workspaces[1]).toBe(wsB);
    expect(state().currentWorkspace).toEqual({ ...wsA, name: 'חדש' });
  });

  it('updateWorkspace leaves the current workspace alone when another one changes', async () => {
    useStore.setState({ workspaces: [wsA, wsB], currentWorkspace: wsA });
    workspacesAPI.update.mockResolvedValue({ name: 'x' });

    await state().updateWorkspace('ws-b', { name: 'x' });

    expect(state().currentWorkspace).toBe(wsA);
  });

  it.each(['deleteWorkspace', 'leaveWorkspace'])('%s of the current workspace switches to the first remaining one', async (action) => {
    useStore.setState({ workspaces: [wsA, wsB], currentWorkspace: wsA, workspaceRole: 'owner' });
    workspacesAPI.delete.mockResolvedValue(null);
    workspacesAPI.leave.mockResolvedValue(null);

    await state()[action]('ws-a');

    expect(state().workspaces).toEqual([wsB]);
    expect(state().currentWorkspace).toEqual(wsB);
    expect(state().workspaceRole).toBe('member');
    expect(localStorage.getItem('currentWorkspaceId')).toBe('ws-b');
  });

  it.each(['deleteWorkspace', 'leaveWorkspace'])('%s of another workspace keeps the current one', async (action) => {
    useStore.setState({ workspaces: [wsA, wsB], currentWorkspace: wsA });
    workspacesAPI.delete.mockResolvedValue(null);
    workspacesAPI.leave.mockResolvedValue(null);

    await state()[action]('ws-b');

    expect(state().workspaces).toEqual([wsA]);
    expect(state().currentWorkspace).toBe(wsA);
  });

  it('deleteWorkspace keeps the list when the server refuses', async () => {
    useStore.setState({ workspaces: [wsA, wsB], currentWorkspace: wsA });
    workspacesAPI.delete.mockRejectedValue(new Error('forbidden'));

    await expect(state().deleteWorkspace('ws-a')).rejects.toThrow('forbidden');
    expect(state().workspaces).toEqual([wsA, wsB]);
  });

  // Removing the only workspace leaves currentWorkspace pointing at a deleted workspace
  it.fails('clears the current workspace when the last workspace is deleted', async () => {
    useStore.setState({ workspaces: [wsA], currentWorkspace: wsA });
    workspacesAPI.delete.mockResolvedValue(null);

    await state().deleteWorkspace('ws-a');

    expect(state().currentWorkspace).toBeNull();
  });
});

describe('permission helpers', () => {
  it.each([
    ['owner', { manage: true, invite: true, viewAll: true }],
    ['admin', { manage: true, invite: true, viewAll: true }],
    ['member', { manage: false, invite: false, viewAll: false }],
    [null, { manage: false, invite: false, viewAll: false }]
  ])('role %s', (role, expected) => {
    useStore.setState({ workspaceRole: role });
    expect(state().canManageWorkspace()).toBe(expected.manage);
    expect(state().canInviteMembers()).toBe(expected.invite);
    expect(state().canViewAllTimeEntries()).toBe(expected.viewAll);
  });

  it('only the owner deletes the workspace and changes roles (never the owner\'s own)', () => {
    useStore.setState({ workspaceRole: 'owner' });
    expect(state().canDeleteWorkspace()).toBe(true);
    expect(state().canChangeMemberRole('admin')).toBe(true);
    expect(state().canChangeMemberRole('member')).toBe(true);
    expect(state().canChangeMemberRole('owner')).toBe(false);

    for (const role of ['admin', 'member', null]) {
      useStore.setState({ workspaceRole: role });
      expect(state().canDeleteWorkspace()).toBe(false);
      expect(state().canChangeMemberRole('member')).toBe(false);
      expect(state().canChangeMemberRole('admin')).toBe(false);
    }
  });

  it('canRemoveMember: owners remove anyone, admins only members', () => {
    useStore.setState({ workspaceRole: 'owner' });
    expect(state().canRemoveMember('admin')).toBe(true);
    expect(state().canRemoveMember('member')).toBe(true);

    useStore.setState({ workspaceRole: 'admin' });
    expect(state().canRemoveMember('member')).toBe(true);
    expect(state().canRemoveMember('admin')).toBe(false);
    expect(state().canRemoveMember('owner')).toBe(false);

    useStore.setState({ workspaceRole: 'member' });
    expect(state().canRemoveMember('member')).toBe(false);
  });
});

describe('timers', () => {
  const t1 = { id: 't1', project_id: 'p1', task_id: null, status: 'running' };
  const t2 = { id: 't2', project_id: 'p1', task_id: 'k1', status: 'running' };

  it('loadActiveTimers stores the server list', async () => {
    timerAPI.getActive.mockResolvedValue([t1, t2]);
    await state().loadActiveTimers();
    expect(state().activeTimers).toEqual([t1, t2]);
  });

  it('loadActiveTimers treats a non-array response as no timers', async () => {
    useStore.setState({ activeTimers: [t1] });
    timerAPI.getActive.mockResolvedValue(null);
    await state().loadActiveTimers();
    expect(state().activeTimers).toEqual([]);
  });

  it('loadActiveTimers keeps the existing array when nothing changed', async () => {
    const current = [t1];
    useStore.setState({ activeTimers: current });
    timerAPI.getActive.mockResolvedValue([{ ...t1 }]);

    await state().loadActiveTimers();

    expect(state().activeTimers).toBe(current);
  });

  it('loadActiveTimers keeps the existing timers on error', async () => {
    useStore.setState({ activeTimers: [t1] });
    timerAPI.getActive.mockRejectedValue(new Error('offline'));
    await state().loadActiveTimers();
    expect(state().activeTimers).toEqual([t1]);
  });

  it('loadActiveTimers skips the sync while a timer operation is running', async () => {
    useStore.setState({ timerOperationInProgress: true });
    await state().loadActiveTimers();
    expect(timerAPI.getActive).not.toHaveBeenCalled();
  });

  it('discards a sync response that is older than a timer mutation', async () => {
    const pending = deferred();
    timerAPI.getActive.mockReturnValueOnce(pending.promise);
    timerAPI.start.mockResolvedValue(t1);

    const sync = state().loadActiveTimers();
    await state().startTimer('p1', null);
    pending.resolve([]); // stale: fetched before the timer was started
    await sync;

    expect(state().activeTimers).toEqual([t1]);
  });

  it('discards a sync response that arrives while a mutation is still in flight', async () => {
    const sync = deferred();
    const start = deferred();
    timerAPI.getActive.mockReturnValueOnce(sync.promise);
    timerAPI.start.mockReturnValueOnce(start.promise);

    const syncDone = state().loadActiveTimers();
    const startDone = state().startTimer('p1', null);
    expect(state().timerOperationInProgress).toBe(true);

    sync.resolve([t2]);
    await syncDone;
    expect(state().activeTimers).toEqual([]);

    start.resolve(t1);
    await startDone;
    expect(state().activeTimers).toEqual([t1]);
    expect(state().timerOperationInProgress).toBe(false);
  });

  it('startTimer appends the new timer and bumps the mutation counter', async () => {
    useStore.setState({ activeTimers: [t1] });
    timerAPI.start.mockResolvedValue(t2);

    const result = await state().startTimer('p1', 'k1');

    expect(timerAPI.start).toHaveBeenCalledWith('p1', 'k1');
    expect(result).toBe(t2);
    expect(state().activeTimers).toEqual([t1, t2]);
    expect(state().timerMutationCount).toBe(1);
    expect(state().timerOperationInProgress).toBe(false);
  });

  it('startTimer releases the lock and rethrows when the server refuses', async () => {
    timerAPI.start.mockRejectedValue(new Error('כבר רץ טיימר'));

    await expect(state().startTimer('p1')).rejects.toThrow('כבר רץ טיימר');

    expect(state().timerOperationInProgress).toBe(false);
    expect(state().activeTimers).toEqual([]);
  });

  it('pauseTimer / resumeTimer / updateTimerStartTime replace only the affected timer', async () => {
    useStore.setState({ activeTimers: [t1, t2] });

    timerAPI.pause.mockResolvedValue({ ...t1, status: 'paused' });
    await state().pauseTimer('t1');
    expect(state().activeTimers).toEqual([{ ...t1, status: 'paused' }, t2]);

    timerAPI.resume.mockResolvedValue({ ...t1, status: 'running' });
    await state().resumeTimer('t1');
    expect(state().activeTimers[0].status).toBe('running');

    timerAPI.updateStartTime.mockResolvedValue({ ...t2, start_time: '2026-10-08T08:00:00Z' });
    await state().updateTimerStartTime('t2', '2026-10-08T08:00:00Z');
    expect(timerAPI.updateStartTime).toHaveBeenCalledWith('t2', '2026-10-08T08:00:00Z');
    expect(state().activeTimers[1].start_time).toBe('2026-10-08T08:00:00Z');

    expect(state().timerMutationCount).toBe(3);
    expect(state().timerOperationInProgress).toBe(false);
  });

  it('stopTimer removes the timer and returns the saved entry', async () => {
    useStore.setState({ activeTimers: [t1, t2] });
    const entry = { id: 'e1', duration: 100 };
    timerAPI.stop.mockResolvedValue(entry);

    const result = await state().stopTimer('t1', 'הערה', [], { task_id: 'k' });

    expect(timerAPI.stop).toHaveBeenCalledWith('t1', 'הערה', [], { task_id: 'k' });
    expect(result).toBe(entry);
    expect(state().activeTimers).toEqual([t2]);
  });

  it('stopTimer keeps the timer when stopping fails', async () => {
    useStore.setState({ activeTimers: [t1] });
    timerAPI.stop.mockRejectedValue(new Error('fail'));

    await expect(state().stopTimer('t1')).rejects.toThrow('fail');

    expect(state().activeTimers).toEqual([t1]);
    expect(state().timerOperationInProgress).toBe(false);
  });

  it('discardTimer removes the timer', async () => {
    useStore.setState({ activeTimers: [t1, t2] });
    timerAPI.discard.mockResolvedValue(null);

    await state().discardTimer('t2');

    expect(state().activeTimers).toEqual([t1]);
  });

  it('getTimerForProject distinguishes project-level and task-level timers', () => {
    useStore.setState({ activeTimers: [t1, t2] });
    expect(state().getTimerForProject('p1')).toBe(t1);
    expect(state().getTimerForProject('p1', 'k1')).toBe(t2);
    expect(state().getTimerForProject('p1', 'other')).toBeUndefined();
    expect(state().getTimerForProject('p2')).toBeUndefined();
  });

  it('hasTimerForProject includes task timers', () => {
    useStore.setState({ activeTimers: [t2] });
    expect(state().hasTimerForProject('p1')).toBe(true);
    expect(state().hasTimerForProject('p2')).toBe(false);
  });
});

describe('integrations and stats', () => {
  it('loadIntegrations sends the auth headers and stores the result', async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('currentWorkspaceId', 'ws-a');
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve([{ id: 'morning' }]) });

    await state().loadIntegrations();

    expect(fetchMock).toHaveBeenCalledWith('/api/integrations', {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok', 'X-Workspace-Id': 'ws-a' }
    });
    expect(state().integrations).toEqual([{ id: 'morning' }]);
  });

  it('loadIntegrations ignores failed responses', async () => {
    useStore.setState({ integrations: [{ id: 'keep' }] });
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'x' }) });

    await state().loadIntegrations();

    expect(state().integrations).toEqual([{ id: 'keep' }]);
  });

  it('loadDashboardStats passes params and keeps old stats on error', async () => {
    statsAPI.getDashboard.mockResolvedValueOnce({ hours: 5 });
    await state().loadDashboardStats({ month: 9, year: 2026 });
    expect(statsAPI.getDashboard).toHaveBeenCalledWith({ month: 9, year: 2026 });
    expect(state().dashboardStats).toEqual({ hours: 5 });

    statsAPI.getDashboard.mockRejectedValueOnce(new Error('x'));
    await state().loadDashboardStats();
    expect(state().dashboardStats).toEqual({ hours: 5 });
  });

  it('loadDashboardStats remembers the period it loaded', async () => {
    const range = { startDate: '2026-08-31T21:00:00.000Z', endDate: '2026-09-30T21:00:00.000Z' };
    await state().loadDashboardStats(range);
    expect(state().dashboardStatsParams).toEqual(range);

    // Back to the default period: the remembered one follows
    await state().loadDashboardStats({});
    expect(state().dashboardStatsParams).toEqual({});
  });

  it('switching workspace reloads the stats for the period the dashboard shows', async () => {
    const range = { startDate: '2026-08-31T21:00:00.000Z', endDate: '2026-09-30T21:00:00.000Z' };
    await state().loadDashboardStats(range);
    statsAPI.getDashboard.mockClear();

    state().setCurrentWorkspace(wsB);

    await vi.waitFor(() => expect(statsAPI.getDashboard).toHaveBeenCalledWith(range));
    expect(statsAPI.getDashboard).toHaveBeenCalledTimes(1);
  });

  it('logout forgets the remembered stats period', async () => {
    await state().loadDashboardStats({ month: 9, year: 2026 });

    state().logout();

    expect(state().dashboardStatsParams).toEqual({});
  });
});

describe('reminders', () => {
  it('loadReminders counts unread reminders that are already due', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    const reminders = [
      { id: 1, is_read: false, due_date: '2026-10-08T11:59:00Z' }, // due
      { id: 2, is_read: false, due_date: '2026-10-08T12:00:00Z' }, // due exactly now
      { id: 3, is_read: false, due_date: '2026-10-08T12:01:00Z' }, // future
      { id: 4, is_read: true, due_date: '2026-10-01T00:00:00Z' }, // read
      { id: 5, is_read: false, due_date: null } // no date
    ];
    remindersAPI.getAll.mockResolvedValue(reminders);

    const result = await state().loadReminders({ upcoming: true });

    expect(remindersAPI.getAll).toHaveBeenCalledWith({ upcoming: true });
    expect(result).toBe(reminders);
    expect(state().reminders).toBe(reminders);
    expect(state().unreadRemindersCount).toBe(2);
  });

  it('loadReminders returns [] on error', async () => {
    remindersAPI.getAll.mockRejectedValue(new Error('x'));
    await expect(state().loadReminders()).resolves.toEqual([]);
  });

  it('addReminder appends and then reloads', async () => {
    const created = { id: 9, title: 'להתקשר' };
    remindersAPI.create.mockResolvedValue(created);
    remindersAPI.getAll.mockResolvedValue([created]);

    await expect(state().addReminder({ title: 'להתקשר' })).resolves.toBe(created);

    expect(state().reminders).toContainEqual(created);
    await vi.waitFor(() => expect(remindersAPI.getAll).toHaveBeenCalled());
  });

  it('updateReminder / deleteReminder update the list and rethrow errors', async () => {
    useStore.setState({ reminders: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] });
    remindersAPI.getAll.mockReturnValue(new Promise(() => {})); // keep the follow-up reload pending

    remindersAPI.update.mockResolvedValue({ id: 1, title: 'A' });
    await state().updateReminder(1, { title: 'A' });
    expect(state().reminders).toEqual([{ id: 1, title: 'A' }, { id: 2, title: 'b' }]);

    remindersAPI.delete.mockResolvedValue(null);
    await state().deleteReminder(2);
    expect(state().reminders).toEqual([{ id: 1, title: 'A' }]);

    remindersAPI.delete.mockRejectedValue(new Error('nope'));
    await expect(state().deleteReminder(1)).rejects.toThrow('nope');
    expect(state().reminders).toEqual([{ id: 1, title: 'A' }]);
  });
});

describe('addons', () => {
  it('loadEnabledAddons keeps the defaults on error', async () => {
    addonsAPI.getEnabled.mockRejectedValue(new Error('x'));
    await expect(state().loadEnabledAddons()).resolves.toEqual(['credentials', 'files', 'notes']);
  });

  it('isAddonEnabled checks the enabled list', () => {
    expect(state().isAddonEnabled('notes')).toBe(true);
    expect(state().isAddonEnabled('ai')).toBe(false);
  });

  it('updateAddon enables and disables', async () => {
    addonsAPI.update.mockResolvedValue(null);

    await state().updateAddon('ai', true);
    expect(addonsAPI.update).toHaveBeenCalledWith('ai', true);
    expect(state().enabledAddons).toEqual(['credentials', 'files', 'notes', 'ai']);

    await state().updateAddon('files', false);
    expect(state().enabledAddons).toEqual(['credentials', 'notes', 'ai']);
  });

  it('updateAddon leaves the list untouched when the server fails', async () => {
    addonsAPI.update.mockRejectedValue(new Error('x'));
    await expect(state().updateAddon('ai', true)).rejects.toThrow('x');
    expect(state().enabledAddons).toEqual(['credentials', 'files', 'notes']);
  });

  // Enabling an addon that is already enabled (double click, retry) adds a duplicate entry
  it.fails('updateAddon does not duplicate an already enabled addon', async () => {
    addonsAPI.update.mockResolvedValue(null);
    await state().updateAddon('notes', true);
    expect(state().enabledAddons).toEqual(['credentials', 'files', 'notes']);
  });
});
