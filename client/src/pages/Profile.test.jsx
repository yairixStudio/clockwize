import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
  authAPI: { deleteAccount: vi.fn(), updateProfile: vi.fn() }
}));
vi.mock('../services/api', () => apiMocks);

import Profile from './Profile';
import useStore from '../store/useStore';
import { ModalProvider } from '../components/Modal';

const { authAPI } = apiMocks;
const initialState = useStore.getState();

const renderProfile = (user) => {
  useStore.setState({ user, isAuthenticated: true });
  const ui = userEvent.setup();
  render(
    <ModalProvider>
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<Profile />} />
          <Route path="/login" element={<p>עמוד התחברות</p>} />
        </Routes>
      </MemoryRouter>
    </ModalProvider>
  );
  return ui;
};

const openDeleteDialog = (ui) => ui.click(screen.getByRole('button', { name: 'מחק את החשבון' }));
const confirmDelete = (ui) => ui.click(screen.getByRole('button', { name: 'מחק את החשבון לצמיתות' }));

beforeEach(() => {
  useStore.setState(initialState, true);
  authAPI.deleteAccount.mockReset();
  authAPI.deleteAccount.mockResolvedValue({ message: 'החשבון נמחק בהצלחה' });
  authAPI.updateProfile.mockReset();
});

const savedUser = (extra = {}) => ({ id: 'u1', name: 'דנה', email: 'dana@example.com', default_hourly_rate: 250, has_password: 1, ...extra });

describe('Profile - password', () => {
  it('changes the password with the current one and keeps this session with the fresh token', async () => {
    localStorage.setItem('token', 'old-session');
    authAPI.updateProfile.mockResolvedValue({ ...savedUser(), token: 'fresh-session' });
    const ui = renderProfile({ id: 'u1', name: 'דנה', email: 'dana@example.com', has_password: 1 });

    expect(screen.getByRole('heading', { name: 'שינוי סיסמה' })).toBeInTheDocument();
    await ui.type(screen.getByLabelText('סיסמה נוכחית'), 'old-pass');
    await ui.type(screen.getByLabelText('סיסמה חדשה'), 'new-pass1');
    await ui.type(screen.getByLabelText('אימות סיסמה חדשה'), 'new-pass1');
    await ui.click(screen.getByRole('button', { name: 'שמור שינויים' }));

    expect(await screen.findByText('הפרופיל עודכן בהצלחה')).toBeInTheDocument();
    expect(authAPI.updateProfile).toHaveBeenCalledWith({
      name: 'דנה', email: 'dana@example.com', currentPassword: 'old-pass', password: 'new-pass1'
    });
    expect(localStorage.getItem('token')).toBe('fresh-session');
    expect(useStore.getState().user).not.toHaveProperty('token');
    expect(useStore.getState().isAuthenticated).toBe(true);
  });

  it('keeps the stored token when the response has none (no password change)', async () => {
    localStorage.setItem('token', 'old-session');
    authAPI.updateProfile.mockResolvedValue(savedUser({ name: 'דנה כהן' }));
    const ui = renderProfile({ id: 'u1', name: 'דנה', email: 'dana@example.com', has_password: 1 });

    await ui.clear(screen.getByLabelText('שם מלא'));
    await ui.type(screen.getByLabelText('שם מלא'), 'דנה כהן');
    await ui.click(screen.getByRole('button', { name: 'שמור שינויים' }));

    expect(await screen.findByText('הפרופיל עודכן בהצלחה')).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBe('old-session');
    expect(useStore.getState().user.name).toBe('דנה כהן');
  });

  it('a passkey-only account sets a first password without a current one', async () => {
    authAPI.updateProfile.mockResolvedValue({ ...savedUser(), token: 'fresh-session' });
    const ui = renderProfile({ id: 'u1', name: 'דנה', email: 'dana@example.com', has_password: 0 });

    expect(screen.getByRole('heading', { name: 'הגדרת סיסמה' })).toBeInTheDocument();
    expect(screen.queryByLabelText('סיסמה נוכחית')).not.toBeInTheDocument();
    await ui.type(screen.getByLabelText('סיסמה חדשה'), 'first-pass');
    await ui.type(screen.getByLabelText('אימות סיסמה חדשה'), 'first-pass');
    await ui.click(screen.getByRole('button', { name: 'שמור שינויים' }));

    expect(await screen.findByText('הפרופיל עודכן בהצלחה')).toBeInTheDocument();
    expect(authAPI.updateProfile).toHaveBeenCalledWith({ name: 'דנה', email: 'dana@example.com', password: 'first-pass' });
    expect(localStorage.getItem('token')).toBe('fresh-session');
    // The account has a password now: the next change asks for it
    expect(useStore.getState().user.has_password).toBe(1);
    expect(screen.getByLabelText('סיסמה נוכחית')).toBeInTheDocument();
  });
});

describe('Profile - delete account', () => {
  it('asks for the password of an account that has one', async () => {
    const ui = renderProfile({ id: 'u1', name: 'דנה', email: 'dana@example.com', has_password: 1 });

    await openDeleteDialog(ui);
    expect(screen.queryByLabelText('הקלידו את האימייל שלכם לאישור')).not.toBeInTheDocument();
    const password = screen.getByLabelText('הזן את הסיסמה שלך לאישור');
    expect(password).toHaveAttribute('type', 'password');

    await ui.type(password, 'secret');
    await confirmDelete(ui);

    expect(authAPI.deleteAccount).toHaveBeenCalledWith({ password: 'secret' });
    expect(await screen.findByText('עמוד התחברות')).toBeInTheDocument();
    expect(useStore.getState().isAuthenticated).toBe(false);
  });

  it('treats a user without has_password (e.g. right after registering) as having a password', async () => {
    const ui = renderProfile({ id: 'u1', name: 'דנה', email: 'dana@example.com' });

    await openDeleteDialog(ui);

    expect(screen.getByLabelText('הזן את הסיסמה שלך לאישור')).toBeInTheDocument();
  });

  it('a passkey-only account confirms with its email instead of a password', async () => {
    const ui = renderProfile({ id: 'u1', name: 'דנה', email: 'dana@example.com', has_password: 0 });

    await openDeleteDialog(ui);
    expect(screen.queryByLabelText('הזן את הסיסמה שלך לאישור')).not.toBeInTheDocument();
    const email = screen.getByLabelText('הקלידו את האימייל שלכם לאישור');
    expect(email).toHaveAttribute('type', 'email');

    await ui.type(email, ' dana@example.com ');
    await confirmDelete(ui);

    expect(authAPI.deleteAccount).toHaveBeenCalledWith({ confirmEmail: 'dana@example.com' });
    expect(await screen.findByText('עמוד התחברות')).toBeInTheDocument();
  });

  it('does not call the server with an empty confirmation, and shows a server refusal', async () => {
    authAPI.deleteAccount.mockRejectedValue(new Error('כתובת האימייל אינה תואמת לחשבון'));
    const ui = renderProfile({ id: 'u1', name: 'דנה', email: 'dana@example.com', has_password: 0 });

    await openDeleteDialog(ui);
    await confirmDelete(ui);
    expect(await screen.findByText('נא להקליד את כתובת האימייל')).toBeInTheDocument();
    expect(authAPI.deleteAccount).not.toHaveBeenCalled();
    await ui.click(screen.getByRole('button', { name: 'אישור' }));

    await ui.type(screen.getByLabelText('הקלידו את האימייל שלכם לאישור'), 'other@example.com');
    await confirmDelete(ui);
    expect(await screen.findByText('כתובת האימייל אינה תואמת לחשבון')).toBeInTheDocument();
    expect(useStore.getState().isAuthenticated).toBe(true);
  });
});
