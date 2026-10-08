import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { login, resetPassword } = vi.hoisted(() => ({ login: vi.fn(), resetPassword: vi.fn() }));

vi.mock('./services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, authAPI: { ...actual.authAPI, login, resetPassword } };
});
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: () => false
}));

import App from './App';
import useStore from './store/useStore';

const initialState = useStore.getState();

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

const loginResponse = (extra = {}) => ({
  user: { id: 'u1', name: 'דנה', email: 'dana@example.com' },
  token: 'jwt',
  workspaces: [],
  currentWorkspace: null,
  requiresPasswordReset: false,
  ...extra
});

const loginThroughApp = async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/login']}>
      <App />
      <CurrentPath />
    </MemoryRouter>
  );
  await user.type(await screen.findByPlaceholderText('admin או your@email.com'), 'dana@example.com');
  await user.type(screen.getByPlaceholderText('••••••••'), 'old-password');
  await user.click(screen.getByRole('button', { name: 'התחבר' }));
  return user;
};

beforeEach(() => {
  useStore.setState(initialState, true);
  login.mockReset();
  resetPassword.mockReset();
  // Everything other than login goes through the real api module to a stubbed backend
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '[]',
    json: async () => []
  })));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('App routing around login', () => {
  it('a normal login leaves /login for the dashboard', async () => {
    login.mockResolvedValue(loginResponse());

    await loginThroughApp();

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/));
    expect(screen.queryByPlaceholderText('••••••••')).not.toBeInTheDocument();
  });

  // The login response of a flagged user is not a session yet: GuestRoute must keep Login (and its
  // reset prompt) on screen instead of redirecting to the dashboard
  it('a user flagged for a forced password reset is asked for a new password first', async () => {
    login.mockResolvedValue({ requiresPasswordReset: true, resetToken: 'reset-jwt' });

    await loginThroughApp();

    expect(await screen.findByRole('heading', { name: 'נדרש איפוס סיסמה' })).toBeInTheDocument();
    expect(screen.getByLabelText('הזן סיסמה חדשה (לפחות 4 תווים):')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/login$/);
    expect(useStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('cancelling the forced reset keeps the user logged out on /login', async () => {
    login.mockResolvedValue({ requiresPasswordReset: true, resetToken: 'reset-jwt' });

    const user = await loginThroughApp();
    await screen.findByRole('heading', { name: 'נדרש איפוס סיסמה' });
    await user.click(screen.getByRole('button', { name: 'ביטול' }));

    expect(await screen.findByText('חובה לשנות סיסמה כדי להמשיך')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/login$/);
    expect(useStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('enters the app only after the new password was saved', async () => {
    login.mockResolvedValue({ requiresPasswordReset: true, resetToken: 'reset-jwt' });
    resetPassword.mockResolvedValue({ ...loginResponse(), token: 'jwt-after-reset' });

    const user = await loginThroughApp();
    await user.type(await screen.findByLabelText('הזן סיסמה חדשה (לפחות 4 תווים):'), 'new-password');
    await user.click(screen.getByRole('button', { name: 'אישור' }));

    expect(resetPassword).toHaveBeenCalledWith({ resetToken: 'reset-jwt', newPassword: 'new-password' });
    expect(await screen.findByText('סיסמה שונתה בהצלחה!')).toBeInTheDocument();
    expect(useStore.getState().isAuthenticated).toBe(false);
    await user.click(screen.getByRole('button', { name: 'אישור' }));

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/));
    expect(useStore.getState().isAuthenticated).toBe(true);
    expect(localStorage.getItem('token')).toBe('jwt-after-reset');
  });
});
