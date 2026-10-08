import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMocks = vi.hoisted(() => ({
  clientSourcesAPI: { getAll: vi.fn(), create: vi.fn() },
  clientsAPI: { delete: vi.fn() }
}));

vi.mock('../services/api', () => apiMocks);

import ClientModal from './ClientModal';
import { ModalProvider } from './Modal';

const { clientSourcesAPI } = apiMocks;
const sources = [
  { id: 's1', name: 'הפניות' },
  { id: 's2', name: 'גוגל' }
];

beforeEach(() => {
  Object.values(apiMocks).forEach(group => Object.values(group).forEach(fn => fn.mockReset()));
  clientSourcesAPI.getAll.mockResolvedValue(sources);
});

// Waits for the sources list to load so the async state update happens inside the test
const renderModal = async (props = {}) => {
  const user = userEvent.setup();
  render(
    <ModalProvider>
      <ClientModal onSave={vi.fn()} onClose={vi.fn()} {...props} />
    </ModalProvider>
  );
  await screen.findByRole('option', { name: 'גוגל' });
  return user;
};

describe('ClientModal - labelled fields', () => {
  it('exposes the form fields through their labels', async () => {
    await renderModal();

    const name = screen.getByLabelText('שם לקוח *');
    expect(name.tagName).toBe('INPUT');
    expect(name).toHaveAttribute('name', 'name');
    expect(name).toBeRequired();

    const status = screen.getByLabelText('סטטוס');
    expect(status.tagName).toBe('SELECT');
    expect(status).toHaveAttribute('name', 'status');

    expect(screen.getByLabelText('אימייל')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('טלפון')).toHaveAttribute('type', 'tel');
    expect(screen.getByLabelText('ח.פ / מספר עוסק')).toHaveAttribute('name', 'tax_id');
    expect(screen.getByLabelText('כתובת')).toHaveAttribute('name', 'address');
    expect(screen.getByLabelText('שם הבנק')).toHaveAttribute('name', 'bank_name');
    expect(screen.getByLabelText('סניף')).toHaveAttribute('name', 'bank_branch');
    expect(screen.getByLabelText('מספר חשבון')).toHaveAttribute('name', 'bank_account');
    expect(screen.getByLabelText('מחיר לשעה (₪)')).toHaveAttribute('name', 'hourly_rate');
    expect(screen.getByLabelText('📝 פתק פרטי (לעצמך)').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('מקור הגעה')).toHaveAttribute('name', 'source_id');
    expect(screen.getByLabelText('כינויים לחיפוש')).toHaveAttribute('placeholder', 'הוסף כינוי...');
    expect(screen.getByLabelText('דומיינים (לזיהוי אוטומטי)')).toHaveAttribute('placeholder', 'zrp.co.il');
  });

  it('accepts typing into a field found by its label', async () => {
    const user = await renderModal();

    const email = screen.getByLabelText('אימייל');
    await user.type(email, 'dana@example.com');
    expect(email).toHaveValue('dana@example.com');

    await user.type(screen.getByLabelText('כינויים לחיפוש'), 'דנה{Enter}');
    expect(screen.getByText('דנה')).toHaveClass('alias-tag');
    expect(screen.getByLabelText('כינויים לחיפוש')).toHaveValue('');
  });

  it('keeps the source label on whichever source control is shown', async () => {
    const user = await renderModal();

    await user.click(screen.getByRole('button', { name: 'הוסף מקור חדש' }));

    const newSource = screen.getByLabelText('מקור הגעה');
    expect(newSource.tagName).toBe('INPUT');
    expect(newSource).toHaveAttribute('placeholder', 'שם המקור החדש...');
  });

  it('labels the referral field when the referrals source is picked', async () => {
    const user = await renderModal();
    expect(screen.queryByLabelText('תת מקור (מי הפנה?)')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('מקור הגעה'), 's1');

    expect(screen.getByLabelText('תת מקור (מי הפנה?)')).toHaveAttribute('name', 'sub_source');
  });
});
