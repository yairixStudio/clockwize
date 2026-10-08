import { describe, it, expect, vi, beforeEach } from 'vitest';
import api, {
  authAPI,
  clientsAPI,
  leadsAPI,
  timerAPI,
  statsAPI,
  filesAPI,
  workspacesAPI,
  projectsAPI
} from './api';

// Minimal fetch Response stand-in: handleResponse only uses ok / status / text()
const response = (status, body, { raw = false } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(body === undefined ? '' : raw ? body : JSON.stringify(body)),
  blob: () => Promise.resolve(new Blob([raw ? body : JSON.stringify(body)]))
});

let fetchMock;
let locationMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // jsdom's location methods are non-configurable, so replace the whole object
  locationMock = { pathname: '/dashboard', assign: vi.fn() };
  vi.stubGlobal('location', locationMock);
});

const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
const lastHeaders = () => lastCall()[1]?.headers ?? {};

describe('request headers', () => {
  it('sends Authorization and X-Workspace-Id from localStorage', async () => {
    localStorage.setItem('token', 'tok-123');
    localStorage.setItem('currentWorkspaceId', 'ws-1');
    fetchMock.mockResolvedValue(response(200, []));

    await clientsAPI.getAll();

    expect(lastCall()[0]).toBe('/api/clients');
    expect(lastHeaders()).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-123',
      'X-Workspace-Id': 'ws-1'
    });
  });

  it('omits the auth headers when nothing is stored', async () => {
    fetchMock.mockResolvedValue(response(200, {}));

    await authAPI.getMe();

    expect(lastHeaders()).toEqual({ 'Content-Type': 'application/json' });
  });

  it('reads localStorage on every request (workspace switch takes effect immediately)', async () => {
    localStorage.setItem('token', 't');
    localStorage.setItem('currentWorkspaceId', 'ws-a');
    fetchMock.mockResolvedValue(response(200, []));

    await projectsAPI.getAll();
    expect(lastHeaders()['X-Workspace-Id']).toBe('ws-a');

    localStorage.setItem('currentWorkspaceId', 'ws-b');
    await projectsAPI.getAll();
    expect(lastHeaders()['X-Workspace-Id']).toBe('ws-b');
  });

  it('does not send the stored token to the public login endpoint', async () => {
    localStorage.setItem('token', 'stale');
    fetchMock.mockResolvedValue(response(200, { token: 'new' }));

    await authAPI.login({ email: 'a@b.c', password: 'secret' });

    const [url, init] = lastCall();
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.c', password: 'secret' });
  });

  it('does not set Content-Type for file uploads (browser adds the multipart boundary)', async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('currentWorkspaceId', 'ws');
    fetchMock.mockResolvedValue(response(200, { id: 1 }));
    const form = new FormData();

    await filesAPI.upload(form);

    const [url, init] = lastCall();
    expect(url).toBe('/api/files/upload');
    expect(init.body).toBe(form);
    expect(init.headers).toEqual({ Authorization: 'Bearer tok', 'X-Workspace-Id': 'ws' });
  });
});

describe('URLs and bodies', () => {
  beforeEach(() => fetchMock.mockResolvedValue(response(200, {})));

  it('JSON-encodes bodies with the right method', async () => {
    await clientsAPI.update(5, { name: 'לקוח' });
    const [url, init] = lastCall();
    expect(url).toBe('/api/clients/5');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ name: 'לקוח' });
  });

  it('builds the leads query string, skipping empty values', async () => {
    await leadsAPI.getAll({ status: 'new', priority: '', assigned_to: null, search: 'דני כהן', source: undefined });
    expect(lastCall()[0]).toBe('/api/leads?status=new&search=%D7%93%D7%A0%D7%99+%D7%9B%D7%94%D7%9F');

    await leadsAPI.getAll();
    expect(lastCall()[0]).toBe('/api/leads');
  });

  it('builds the dashboard stats query string (month 0 is kept)', async () => {
    await statsAPI.getDashboard({ month: 0, year: 2026 });
    expect(lastCall()[0]).toBe('/api/stats/dashboard?month=0&year=2026');

    await statsAPI.getDashboard();
    expect(lastCall()[0]).toBe('/api/stats/dashboard');
  });

  it('encodes the domain for client lookup', async () => {
    await clientsAPI.lookupByDomain('a b&c.co.il');
    expect(lastCall()[0]).toBe('/api/clients/lookup/domain?domain=a%20b%26c.co.il');
  });

  it('sends timer stop options as top-level fields', async () => {
    await timerAPI.stop('t1', 'הערות', [{ a: 1 }], { project_id: 'p', task_id: 'k' });
    const [url, init] = lastCall();
    expect(url).toBe('/api/timer/stop/t1');
    expect(JSON.parse(init.body)).toEqual({ notes: 'הערות', intervals: [{ a: 1 }], project_id: 'p', task_id: 'k' });
  });

  it('exposes a generic api helper', async () => {
    await api.get('/x');
    expect(lastCall()[0]).toBe('/api/x');
    await api.post('/y', { a: 1 });
    expect(lastCall()[1]).toMatchObject({ method: 'POST', body: '{"a":1}' });
    await api.delete('/z');
    expect(lastCall()[1].method).toBe('DELETE');
  });
});

describe('response handling', () => {
  it('returns the parsed JSON body on success', async () => {
    fetchMock.mockResolvedValue(response(200, { id: 1, name: 'שלום' }));
    await expect(clientsAPI.getOne(1)).resolves.toEqual({ id: 1, name: 'שלום' });
  });

  it('returns null for an empty successful body (e.g. 204)', async () => {
    fetchMock.mockResolvedValue(response(204));
    await expect(clientsAPI.delete(1)).resolves.toBeNull();
  });

  it('returns null for a non-JSON successful body instead of throwing', async () => {
    fetchMock.mockResolvedValue(response(200, '<!doctype html><html></html>', { raw: true }));
    await expect(clientsAPI.getAll()).resolves.toBeNull();
  });

  it('throws the server error message with .status and .details', async () => {
    fetchMock.mockResolvedValue(response(400, { error: 'שם חובה', details: { field: 'name' } }));

    const error = await clientsAPI.create({}).catch(e => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('שם חובה');
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ field: 'name' });
  });

  it('uses a generic Hebrew message for non-JSON error bodies (proxy / gateway errors)', async () => {
    fetchMock.mockResolvedValue(response(502, '<html>Bad Gateway</html>', { raw: true }));

    const error = await clientsAPI.getAll().catch(e => e);

    expect(error.message).toBe('שגיאה בשרת (502)');
    expect(error.status).toBe(502);
    expect(error.details).toBeUndefined();
  });

  it('uses the generic message for empty or non-object JSON error bodies', async () => {
    fetchMock.mockResolvedValueOnce(response(500));
    await expect(clientsAPI.getAll()).rejects.toMatchObject({ message: 'שגיאה בשרת (500)', status: 500 });

    fetchMock.mockResolvedValueOnce(response(500, 'oops'));
    await expect(clientsAPI.getAll()).rejects.toMatchObject({ message: 'שגיאה בשרת (500)', status: 500 });

    fetchMock.mockResolvedValueOnce(response(500, null));
    await expect(clientsAPI.getAll()).rejects.toMatchObject({ message: 'שגיאה בשרת (500)' });
  });

  it('propagates network failures from fetch', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(clientsAPI.getAll()).rejects.toThrow('Failed to fetch');
  });
});

describe('401 handling', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('currentWorkspaceId', 'ws');
  });

  it.each(['אנא התחבר למערכת', 'טוקן לא תקין'])(
    'clears the session and redirects to /login for auth-middleware error "%s"',
    async (message) => {
      fetchMock.mockResolvedValue(response(401, { error: message }));

      const error = await authAPI.getMe().catch(e => e);

      expect(error.status).toBe(401);
      expect(error.message).toBe(message);
      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('currentWorkspaceId')).toBeNull();
      expect(locationMock.assign).toHaveBeenCalledWith('/login');
    }
  );

  it('does not redirect again when already on /login', async () => {
    locationMock.pathname = '/login';
    fetchMock.mockResolvedValue(response(401, { error: 'טוקן לא תקין' }));

    await authAPI.getMe().catch(() => {});

    expect(localStorage.getItem('token')).toBeNull();
    expect(locationMock.assign).not.toHaveBeenCalled();
  });

  it('keeps the session for other 401s (wrong password, share-link password)', async () => {
    fetchMock.mockResolvedValue(response(401, { error: 'אימייל או סיסמה שגויים' }));

    const error = await authAPI.login({ email: 'a', password: 'b' }).catch(e => e);

    expect(error.message).toBe('אימייל או סיסמה שגויים');
    expect(error.status).toBe(401);
    expect(localStorage.getItem('token')).toBe('tok');
    expect(localStorage.getItem('currentWorkspaceId')).toBe('ws');
    expect(locationMock.assign).not.toHaveBeenCalled();
  });

  it('keeps the session for a 401 without a JSON body', async () => {
    fetchMock.mockResolvedValue(response(401, 'Unauthorized', { raw: true }));

    const error = await workspacesAPI.getAll().catch(e => e);

    expect(error.message).toBe('שגיאה בשרת (401)');
    expect(localStorage.getItem('token')).toBe('tok');
    expect(locationMock.assign).not.toHaveBeenCalled();
  });

  it('does not log out on 403 even with an auth-style message', async () => {
    fetchMock.mockResolvedValue(response(403, { error: 'טוקן לא תקין' }));

    await workspacesAPI.getAll().catch(() => {});

    expect(localStorage.getItem('token')).toBe('tok');
    expect(locationMock.assign).not.toHaveBeenCalled();
  });
});

describe('filesAPI.download', () => {
  it('returns a blob', async () => {
    fetchMock.mockResolvedValue(response(200, 'file-bytes', { raw: true }));

    const blob = await filesAPI.download(9);

    expect(blob).toBeInstanceOf(Blob);
    expect(lastCall()[0]).toBe('/api/files/9/download');
  });

  // The server looks the file up in req.workspaceId; without the header it falls back to the
  // user's first workspace, so files in any other workspace came back 404
  it('sends the token and the current workspace', async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('currentWorkspaceId', 'ws-2');
    fetchMock.mockResolvedValue(response(200, 'file-bytes', { raw: true }));

    await filesAPI.download(9);

    expect(lastHeaders()).toEqual({ Authorization: 'Bearer tok', 'X-Workspace-Id': 'ws-2' });
  });

  it('throws on a failed download', async () => {
    fetchMock.mockResolvedValue(response(404, { error: 'not found' }));
    await expect(filesAPI.download(9)).rejects.toThrow('Failed to download');
  });
});
