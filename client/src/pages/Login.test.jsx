import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
  authAPI: { login: vi.fn(), register: vi.fn(), getMe: vi.fn(), resetPassword: vi.fn() },
  passkeysAPI: { loginOptions: vi.fn(), loginVerify: vi.fn() },
  timerAPI: { getActive: vi.fn() },
  statsAPI: { getDashboard: vi.fn() },
  remindersAPI: { getAll: vi.fn() },
  addonsAPI: { getEnabled: vi.fn() },
  workspacesAPI: { getAll: vi.fn() }
}));
const webauthn = vi.hoisted(() => ({
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: vi.fn()
}));

vi.mock('../services/api', () => apiMocks);
vi.mock('@simplewebauthn/browser', () => webauthn);

import Login from './Login';
import useStore from '../store/useStore';
import { ModalProvider } from '../components/Modal';

const { authAPI, passkeysAPI, timerAPI, addonsAPI } = apiMocks;
const initialState = useStore.getState();

const workspace = { id: 'ws-1', name: 'אישי', role: 'owner' };
// What the server sends instead of a session when the admin flagged the account
const resetRequired = () => ({ requiresPasswordReset: true, resetToken: 'reset-jwt' });

const authResponse = (extra = {}) => ({
  user: { id: 'u1', name: 'דנה', email: 'dana@example.com' },
  token: 'jwt-token',
  workspaces: [workspace],
  currentWorkspace: workspace,
  requiresPasswordReset: false,
  ...extra
});

function JoinPage() {
  const { code } = useParams();
  return <p>הצטרפות {code}</p>;
}

const renderLogin = () => {
  const user = userEvent.setup();
  render(
    <ModalProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<p>דשבורד</p>} />
          <Route path="/register" element={<p>עמוד הרשמה</p>} />
          <Route path="/join/:code" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>
    </ModalProvider>
  );
  return user;
};

const emailInput = () => screen.getByPlaceholderText('admin או your@email.com');
const passwordInput = () => screen.getByPlaceholderText('••••••••');
const submitButton = () => screen.getByRole('button', { name: 'התחבר' });

const fillAndSubmit = async (user, email = 'dana@example.com', password = 'secret') => {
  await user.type(emailInput(), email);
  await user.type(passwordInput(), password);
  await user.click(submitButton());
};

beforeEach(() => {
  useStore.setState(initialState, true);
  Object.values(apiMocks).forEach(group => Object.values(group).forEach(fn => fn.mockReset()));
  Object.values(webauthn).forEach(fn => fn.mockReset());
  webauthn.browserSupportsWebAuthn.mockReturnValue(false);
  addonsAPI.getEnabled.mockResolvedValue(['credentials', 'files', 'notes']);
  timerAPI.getActive.mockResolvedValue([]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Login - rendering', () => {
  it('renders the form in Hebrew', () => {
    renderLogin();

    expect(screen.getByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
    expect(screen.getByText('שם משתמש / אימייל')).toBeInTheDocument();
    expect(screen.getByText('סיסמה')).toBeInTheDocument();
    expect(emailInput()).toHaveAttribute('dir', 'ltr');
    expect(emailInput()).toBeRequired();
    expect(passwordInput()).toHaveAttribute('type', 'password');
    expect(passwordInput()).toBeRequired();
    expect(submitButton()).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('links to the registration page', async () => {
    const user = renderLogin();

    await user.click(screen.getByRole('link', { name: 'הירשם עכשיו' }));

    expect(screen.getByText('עמוד הרשמה')).toBeInTheDocument();
  });

  it('hides the passkey button when WebAuthn is not supported', () => {
    renderLogin();
    expect(screen.queryByRole('button', { name: 'התחבר עם Passkey' })).not.toBeInTheDocument();
  });

  it('shows the passkey button when WebAuthn is supported', () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    renderLogin();
    expect(screen.getByRole('button', { name: 'התחבר עם Passkey' })).toBeInTheDocument();
  });

  it('Ctrl/Cmd+A selects the whole field', () => {
    renderLogin();
    fireEvent.change(emailInput(), { target: { value: 'dana@example.com' } });
    emailInput().setSelectionRange(3, 3);

    fireEvent.keyDown(emailInput(), { key: 'a', metaKey: true });

    expect(emailInput().selectionStart).toBe(0);
    expect(emailInput().selectionEnd).toBe('dana@example.com'.length);
  });
});

describe('Login - password login', () => {
  it('does not call the API when the fields are empty (required validation)', async () => {
    const user = renderLogin();

    await user.click(submitButton());
    await user.type(emailInput(), 'dana@example.com');
    await user.click(submitButton());

    expect(authAPI.login).not.toHaveBeenCalled();
  });

  it('logs in, stores the session and goes to the dashboard', async () => {
    authAPI.login.mockResolvedValue(authResponse());
    const user = renderLogin();

    await fillAndSubmit(user, 'dana@example.com', 'secret');

    expect(await screen.findByText('דשבורד')).toBeInTheDocument();
    expect(authAPI.login).toHaveBeenCalledWith({ email: 'dana@example.com', password: 'secret' });
    expect(localStorage.getItem('token')).toBe('jwt-token');
    expect(localStorage.getItem('currentWorkspaceId')).toBe('ws-1');
    expect(useStore.getState().isAuthenticated).toBe(true);
  });

  it('accepts a plain username (not only an e-mail)', async () => {
    authAPI.login.mockResolvedValue(authResponse());
    const user = renderLogin();

    await fillAndSubmit(user, 'admin', 'pw');

    expect(await screen.findByText('דשבורד')).toBeInTheDocument();
    expect(authAPI.login).toHaveBeenCalledWith({ email: 'admin', password: 'pw' });
  });

  it('continues to a pending workspace invite after login', async () => {
    localStorage.setItem('pendingInviteCode', 'ABC123');
    authAPI.login.mockResolvedValue(authResponse());
    const user = renderLogin();

    await fillAndSubmit(user);

    expect(await screen.findByText('הצטרפות ABC123')).toBeInTheDocument();
    expect(localStorage.getItem('pendingInviteCode')).toBeNull();
  });

  it('shows the server error and stays on the page', async () => {
    authAPI.login.mockRejectedValue(Object.assign(new Error('אימייל או סיסמה שגויים'), { status: 401 }));
    const user = renderLogin();

    await fillAndSubmit(user);

    expect(await screen.findByText('אימייל או סיסמה שגויים')).toHaveClass('auth-error');
    expect(screen.queryByText('דשבורד')).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
    expect(useStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('clears the previous error when submitting again', async () => {
    authAPI.login
      .mockRejectedValueOnce(new Error('אימייל או סיסמה שגויים'))
      .mockReturnValueOnce(new Promise(() => {}));
    const user = renderLogin();

    await fillAndSubmit(user);
    expect(await screen.findByText('אימייל או סיסמה שגויים')).toBeInTheDocument();

    await user.click(submitButton());
    expect(screen.queryByText('אימייל או סיסמה שגויים')).not.toBeInTheDocument();
  });

  it('shows a loading state and prevents double submission', async () => {
    authAPI.login.mockReturnValue(new Promise(() => {}));
    const user = renderLogin();

    await fillAndSubmit(user);

    const loading = screen.getByRole('button', { name: 'מתחבר...' });
    expect(loading).toBeDisabled();
    await user.click(loading);
    expect(authAPI.login).toHaveBeenCalledTimes(1);
  });
});

describe('Login - forced password reset', () => {
  it('asks for a new password instead of going to the dashboard', async () => {
    authAPI.login.mockResolvedValue(resetRequired());
    const user = renderLogin();

    await fillAndSubmit(user, 'dana@example.com', 'old-pw');

    expect(await screen.findByRole('heading', { name: 'נדרש איפוס סיסמה' })).toBeInTheDocument();
    expect(screen.getByText('הזן סיסמה חדשה (לפחות 4 תווים):')).toBeInTheDocument();
    expect(screen.queryByText('דשבורד')).not.toBeInTheDocument();
  });

  it('does not log the user in before the password was reset', async () => {
    authAPI.login.mockResolvedValue(resetRequired());
    const user = renderLogin();

    await fillAndSubmit(user, 'dana@example.com', 'old-pw');
    await screen.findByRole('heading', { name: 'נדרש איפוס סיסמה' });

    expect(useStore.getState().isAuthenticated).toBe(false);
    expect(useStore.getState().user).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('currentWorkspaceId')).toBeNull();
  });

  it('resets the password with the old one and then continues to the dashboard', async () => {
    authAPI.login.mockResolvedValue(resetRequired());
    authAPI.resetPassword.mockResolvedValue({ message: 'סיסמה שונתה בהצלחה', ...authResponse(), token: 'session-after-reset' });
    const user = renderLogin();

    await fillAndSubmit(user, 'dana@example.com', 'old-pw');
    await user.type(await screen.findByPlaceholderText('סיסמה חדשה'), 'new-pw');
    await user.click(screen.getByRole('button', { name: 'אישור' }));

    expect(authAPI.resetPassword).toHaveBeenCalledWith({ resetToken: 'reset-jwt', newPassword: 'new-pw' });
    expect(await screen.findByText('סיסמה שונתה בהצלחה!')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'אישור' }));
    expect(await screen.findByText('דשבורד')).toBeInTheDocument();
    expect(useStore.getState().isAuthenticated).toBe(true);
    expect(localStorage.getItem('token')).toBe('session-after-reset');
    expect(localStorage.getItem('currentWorkspaceId')).toBe('ws-1');
  });

  it('continues to a pending workspace invite after the reset', async () => {
    localStorage.setItem('pendingInviteCode', 'ABC123');
    authAPI.login.mockResolvedValue(resetRequired());
    authAPI.resetPassword.mockResolvedValue({ ...authResponse(), token: 'reset-token' });
    const user = renderLogin();

    await fillAndSubmit(user);
    await user.type(await screen.findByPlaceholderText('סיסמה חדשה'), 'new-pw');
    await user.click(screen.getByRole('button', { name: 'אישור' }));
    await user.click(await screen.findByRole('button', { name: 'אישור' }));

    expect(await screen.findByText('הצטרפות ABC123')).toBeInTheDocument();
  });

  it('shows a failed reset and asks again', async () => {
    authAPI.login.mockResolvedValue(resetRequired());
    authAPI.resetPassword.mockRejectedValue(Object.assign(new Error('הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית'), { status: 400 }));
    const user = renderLogin();

    await fillAndSubmit(user);
    await user.type(await screen.findByPlaceholderText('סיסמה חדשה'), 'new-pw');
    await user.click(screen.getByRole('button', { name: 'אישור' }));

    expect(await screen.findByText('הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'אישור' }));
    expect(await screen.findByRole('heading', { name: 'נדרש איפוס סיסמה' })).toBeInTheDocument();
    expect(useStore.getState().isAuthenticated).toBe(false);
  });

  it('an expired reset token ends the reset: the user signs in again', async () => {
    authAPI.login.mockResolvedValue(resetRequired());
    authAPI.resetPassword.mockRejectedValue(Object.assign(new Error('תוקף האיפוס פג. התחבר שוב כדי להגדיר סיסמה חדשה'), { status: 401 }));
    const user = renderLogin();

    await fillAndSubmit(user);
    await user.type(await screen.findByPlaceholderText('סיסמה חדשה'), 'new-pw');
    await user.click(screen.getByRole('button', { name: 'אישור' }));

    expect(await screen.findByText('תוקף האיפוס פג. התחבר שוב כדי להגדיר סיסמה חדשה')).toHaveClass('auth-error');
    expect(screen.queryByRole('heading', { name: 'נדרש איפוס סיסמה' })).not.toBeInTheDocument();
    expect(authAPI.resetPassword).toHaveBeenCalledTimes(1);
    expect(useStore.getState().isAuthenticated).toBe(false);
  });

  it('shows an error when the reset prompt is cancelled', async () => {
    authAPI.login.mockResolvedValue(resetRequired());
    const user = renderLogin();

    await fillAndSubmit(user);
    await screen.findByRole('heading', { name: 'נדרש איפוס סיסמה' });
    await user.click(screen.getByRole('button', { name: 'ביטול' }));

    expect(await screen.findByText('חובה לשנות סיסמה כדי להמשיך')).toBeInTheDocument();
    expect(authAPI.resetPassword).not.toHaveBeenCalled();
    expect(useStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('rejects a new password shorter than 4 characters and asks again', async () => {
    authAPI.login.mockResolvedValue(resetRequired());
    const user = renderLogin();

    await fillAndSubmit(user);
    await user.type(await screen.findByPlaceholderText('סיסמה חדשה'), 'abc');
    await user.click(screen.getByRole('button', { name: 'אישור' }));

    expect(await screen.findByText('סיסמה חייבת להכיל לפחות 4 תווים')).toBeInTheDocument();
    expect(authAPI.resetPassword).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'אישור' }));
    expect(await screen.findByRole('heading', { name: 'נדרש איפוס סיסמה' })).toBeInTheDocument();
  });

  it('masks the new password while it is typed', async () => {
    authAPI.login.mockResolvedValue(resetRequired());
    const user = renderLogin();

    await fillAndSubmit(user);

    const input = await screen.findByLabelText('הזן סיסמה חדשה (לפחות 4 תווים):');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveAttribute('placeholder', 'סיסמה חדשה');
  });
});

describe('Login - passkey', () => {
  beforeEach(() => webauthn.browserSupportsWebAuthn.mockReturnValue(true));

  it('signs in with a passkey and goes to the dashboard', async () => {
    passkeysAPI.loginOptions.mockResolvedValue({ flowId: 'flow-1', options: { challenge: 'abc' } });
    webauthn.startAuthentication.mockResolvedValue({ id: 'cred-1' });
    passkeysAPI.loginVerify.mockResolvedValue(authResponse());
    const user = renderLogin();

    await user.click(screen.getByRole('button', { name: 'התחבר עם Passkey' }));

    expect(await screen.findByText('דשבורד')).toBeInTheDocument();
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'abc' } });
    expect(passkeysAPI.loginVerify).toHaveBeenCalledWith({ flowId: 'flow-1', response: { id: 'cred-1' } });
    expect(localStorage.getItem('token')).toBe('jwt-token');
  });

  it('a flagged account signing in with a passkey sets a new password first', async () => {
    passkeysAPI.loginOptions.mockResolvedValue({ flowId: 'flow-1', options: {} });
    webauthn.startAuthentication.mockResolvedValue({ id: 'cred-1' });
    passkeysAPI.loginVerify.mockResolvedValue(resetRequired());
    authAPI.resetPassword.mockResolvedValue({ ...authResponse(), token: 'session-after-reset' });
    const user = renderLogin();

    await user.click(screen.getByRole('button', { name: 'התחבר עם Passkey' }));
    await user.type(await screen.findByLabelText('הזן סיסמה חדשה (לפחות 4 תווים):'), 'new-pw');
    expect(useStore.getState().isAuthenticated).toBe(false);
    await user.click(screen.getByRole('button', { name: 'אישור' }));
    await user.click(await screen.findByRole('button', { name: 'אישור' }));

    expect(await screen.findByText('דשבורד')).toBeInTheDocument();
    expect(authAPI.resetPassword).toHaveBeenCalledWith({ resetToken: 'reset-jwt', newPassword: 'new-pw' });
    expect(localStorage.getItem('token')).toBe('session-after-reset');
  });

  it('shows a waiting state while the browser dialog is open', async () => {
    passkeysAPI.loginOptions.mockReturnValue(new Promise(() => {}));
    const user = renderLogin();

    await user.click(screen.getByRole('button', { name: 'התחבר עם Passkey' }));

    expect(screen.getByRole('button', { name: 'ממתין לאימות...' })).toBeDisabled();
  });

  it('stays silent when the user closes the passkey dialog', async () => {
    passkeysAPI.loginOptions.mockResolvedValue({ flowId: 'f', options: {} });
    webauthn.startAuthentication.mockRejectedValue(Object.assign(new Error('The operation was cancelled'), { name: 'NotAllowedError' }));
    const user = renderLogin();

    await user.click(screen.getByRole('button', { name: 'התחבר עם Passkey' }));

    expect(await screen.findByRole('button', { name: 'התחבר עם Passkey' })).toBeEnabled();
    expect(screen.queryByText('The operation was cancelled')).not.toBeInTheDocument();
    expect(document.querySelector('.auth-error')).toBeNull();
    expect(passkeysAPI.loginVerify).not.toHaveBeenCalled();
  });

  it('shows other passkey errors', async () => {
    passkeysAPI.loginOptions.mockResolvedValue({ flowId: 'f', options: {} });
    webauthn.startAuthentication.mockResolvedValue({ id: 'c' });
    passkeysAPI.loginVerify.mockRejectedValue(new Error('Passkey לא מוכר'));
    const user = renderLogin();

    await user.click(screen.getByRole('button', { name: 'התחבר עם Passkey' }));

    expect(await screen.findByText('Passkey לא מוכר')).toHaveClass('auth-error');
    expect(useStore.getState().isAuthenticated).toBe(false);
  });

  it('falls back to a generic Hebrew message for errors without a message', async () => {
    passkeysAPI.loginOptions.mockRejectedValue({ name: 'SecurityError' });
    const user = renderLogin();

    await user.click(screen.getByRole('button', { name: 'התחבר עם Passkey' }));

    expect(await screen.findByText('ההתחברות עם Passkey נכשלה')).toBeInTheDocument();
  });
});
