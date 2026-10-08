import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

const login = vi.hoisted(() => vi.fn());

vi.mock('./services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, authAPI: { ...actual.authAPI, login } };
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
};

beforeEach(() => {
  useStore.setState(initialState, true);
  login.mockReset();
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

  // completeAuth() sets isAuthenticated before Login can open the reset prompt, so GuestRoute
  // (App.jsx) redirects to "/" and unmounts Login: a user the admin flagged for a forced
  // password reset goes straight to the dashboard and is never asked to change it
  it.fails('a user flagged for a forced password reset is asked for a new password first', async () => {
    login.mockResolvedValue(loginResponse({ requiresPasswordReset: true }));

    await loginThroughApp();

    expect(await screen.findByRole('heading', { name: 'נדרש איפוס סיסמה' })).toBeInTheDocument();
  });
});
