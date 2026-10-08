import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMocks = vi.hoisted(() => ({
  clientsAPI: { getAll: vi.fn() }
}));

vi.mock('../services/api', () => apiMocks);

import ProjectModal from './ProjectModal';

const { clientsAPI } = apiMocks;
const clients = [
  { id: 'c1', name: 'סטודיו דנה' },
  { id: 'c2', name: 'יוסי ושות׳' }
];

beforeEach(() => {
  clientsAPI.getAll.mockReset();
  clientsAPI.getAll.mockResolvedValue(clients);
});

// Waits for the client list to load so the async state update happens inside the test
const renderModal = async (props = {}) => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue();
  const onClose = vi.fn();
  render(<ProjectModal onSave={onSave} onClose={onClose} {...props} />);
  await screen.findByRole('option', { name: 'יוסי ושות׳' });
  return { user, onSave, onClose };
};

describe('ProjectModal - labelled fields', () => {
  it('exposes the main fields through their labels', async () => {
    await renderModal();

    const name = screen.getByLabelText('שם הפרויקט *');
    expect(name.tagName).toBe('INPUT');
    expect(name).toHaveAttribute('name', 'name');
    expect(name).toBeRequired();

    const client = screen.getByLabelText('לקוח *');
    expect(client.tagName).toBe('SELECT');
    expect(client).toHaveAttribute('name', 'client_id');

    expect(screen.getByLabelText('תיאור')).toHaveAttribute('name', 'description');
    expect(screen.getByLabelText('סוג תמחור')).toHaveAttribute('name', 'pricing_type');
    expect(screen.getByLabelText('מחיר לשעה (₪)')).toHaveAttribute('name', 'hourly_rate');
    expect(screen.getByLabelText('סטטוס')).toHaveAttribute('name', 'status');
    expect(screen.getByLabelText('🎯 חשיבות')).toHaveAttribute('name', 'priority');
    expect(screen.getByLabelText('⏱️ שעות משוערות')).toHaveAttribute('name', 'estimated_hours');
    expect(screen.getByLabelText('💵 סכום ששולם (₪)')).toHaveAttribute('name', 'paid_amount');
    expect(screen.getByLabelText('📝 פתק פרטי (לעצמך)')).toHaveAttribute('name', 'notes');
  });

  it('labels the communication platform chips as a group', async () => {
    await renderModal();

    const group = screen.getByRole('group', { name: '📱 פלטפורמת התקשרות' });
    expect(group).toContainElement(screen.getByRole('button', { name: 'ווצאפ' }));
  });

  it('keeps the preselected client in the labelled select', async () => {
    await renderModal({ clientId: 'c1' });

    const client = screen.getByLabelText('לקוח *');
    expect(client).toHaveValue('c1');
    expect(client).toBeDisabled();
  });

  it('lets the user type into the labelled project name', async () => {
    const { user } = await renderModal();

    const name = screen.getByLabelText('שם הפרויקט *');
    await user.type(name, 'אתר חדש');

    expect(name).toHaveValue('אתר חדש');
  });

  it('labels the price field that matches the pricing type', async () => {
    const { user } = await renderModal();

    await user.selectOptions(screen.getByLabelText('סוג תמחור'), 'fixed');

    expect(screen.getByLabelText('מחיר קבוע (₪)')).toHaveAttribute('name', 'fixed_price');
    expect(screen.queryByLabelText('מחיר לשעה (₪)')).not.toBeInTheDocument();
  });
});
