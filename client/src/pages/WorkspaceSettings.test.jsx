import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
  workspacesAPI: { getMembers: vi.fn(), getInvites: vi.fn(), update: vi.fn() }
}));
vi.mock('../services/api', () => apiMocks);

import WorkspaceSettings from './WorkspaceSettings';
import useStore from '../store/useStore';
import { ModalProvider } from '../components/Modal';

const { workspacesAPI } = apiMocks;
const initialState = useStore.getState();

const members = [
  { user_id: 'u-owner', user_name: 'Owner', user_email: 'owner@example.com', role: 'owner' },
  { user_id: 'u-admin', user_name: 'Admin', user_email: 'admin@example.com', role: 'admin' },
  { user_id: 'u-member', user_name: 'Member', user_email: 'member@example.com', role: 'member' }
];

const renderAs = async (role) => {
  const workspace = { id: 'ws-1', name: 'צוות', role };
  useStore.setState({ currentWorkspace: workspace, workspaceRole: role, workspaces: [workspace] });
  const user = userEvent.setup();
  render(
    <ModalProvider>
      <MemoryRouter>
        <WorkspaceSettings />
      </MemoryRouter>
    </ModalProvider>
  );
  await screen.findByText('member@example.com');
  return user;
};

const row = (email) => screen.getByText(email).closest('.member-row');

beforeEach(() => {
  useStore.setState(initialState, true);
  Object.values(workspacesAPI).forEach((fn) => fn.mockReset());
  workspacesAPI.getMembers.mockResolvedValue(members);
  workspacesAPI.getInvites.mockResolvedValue([]);
  workspacesAPI.update.mockResolvedValue({ name: 'שם חדש' });
});

describe('WorkspaceSettings - what each role can do (matches the server)', () => {
  it('owner: changes roles, removes anyone but the owner, renames and deletes the workspace', async () => {
    const user = await renderAs('owner');

    expect(within(row('admin@example.com')).getByRole('combobox')).toHaveValue('admin');
    expect(within(row('member@example.com')).getByRole('combobox')).toHaveValue('member');
    expect(within(row('owner@example.com')).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(row('admin@example.com')).getByTitle('הסר')).toBeInTheDocument();
    expect(within(row('owner@example.com')).queryByTitle('הסר')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /כללי/ }));
    expect(screen.getByLabelText('שם ה-Workspace')).toHaveValue('צוות');
    expect(screen.getByRole('button', { name: 'מחק Workspace' })).toBeInTheDocument();
  });

  it('admin: renames the workspace and removes members, but cannot change roles or delete it', async () => {
    const user = await renderAs('admin');

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(row('member@example.com')).getByTitle('הסר')).toBeInTheDocument();
    expect(within(row('admin@example.com')).queryByTitle('הסר')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /הזמנות/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /כללי/ }));
    const name = screen.getByLabelText('שם ה-Workspace');
    await user.clear(name);
    await user.type(name, 'שם חדש');
    await user.click(screen.getByRole('button', { name: 'שמור' }));
    expect(workspacesAPI.update).toHaveBeenCalledWith('ws-1', { name: 'שם חדש' });
    expect(screen.queryByRole('button', { name: 'מחק Workspace' })).not.toBeInTheDocument();
  });

  it('member: no management at all', async () => {
    await renderAs('member');

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByTitle('הסר')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /כללי/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /הזמנות/ })).not.toBeInTheDocument();
    expect(workspacesAPI.getInvites).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'עזוב את ה-Workspace' })).toBeInTheDocument();
  });
});
