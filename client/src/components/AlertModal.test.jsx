import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlertModal from './AlertModal';

const FIELD_NAMES = ['alert_type', 'threshold_value', 'threshold_days', 'message'];

// AlertModal reads values via form named access (form.alert_type), which browsers support
// but jsdom does not implement. Emulate it so the submit handler sees the real fields.
const shimFormNamedAccess = () => {
  const form = document.querySelector('form');
  FIELD_NAMES.forEach(name => {
    Object.defineProperty(form, name, {
      configurable: true,
      get: () => form.elements.namedItem(name) ?? undefined
    });
  });
  return form;
};

const renderModal = (props = {}) => {
  const onSave = props.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onClose = props.onClose ?? vi.fn();
  const utils = render(<AlertModal projectId="p1" onSave={onSave} onClose={onClose} {...props} />);
  shimFormNamedAccess();
  return { ...utils, onSave, onClose, user: userEvent.setup() };
};

const typeSelect = () => screen.getByRole('combobox');

describe('AlertModal - creating', () => {
  it('renders the "new alert" form into document.body', () => {
    const { container } = renderModal();

    expect(screen.getByRole('heading', { name: 'התראה חדשה' })).toBeInTheDocument();
    expect(typeSelect()).toHaveValue('');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    // Portal: nothing is rendered inside the component's own container
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['hours', 'סף שעות', 'מספר שעות', '0.5'],
    ['budget', 'סף סכום (₪)', 'סכום ב-₪', '1'],
    ['payment', 'סף סכום (₪)', 'סכום ב-₪', '1']
  ])('type "%s" shows the threshold amount field', async (type, label, placeholder, step) => {
    const { user } = renderModal();

    await user.selectOptions(typeSelect(), type);

    expect(screen.getByText(label)).toBeInTheDocument();
    const input = screen.getByPlaceholderText(placeholder);
    expect(input).toHaveAttribute('step', step);
    expect(input).toBeRequired();
    expect(screen.queryByPlaceholderText('מספר ימים')).not.toBeInTheDocument();
  });

  it('type "deadline" shows the days field instead', async () => {
    const { user } = renderModal();

    await user.selectOptions(typeSelect(), 'deadline');

    expect(screen.getByText('מספר ימים לפני הדדליין')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('מספר ימים')).toHaveAttribute('min', '1');
    expect(screen.queryByPlaceholderText('מספר שעות')).not.toBeInTheDocument();
  });

  it('saves an hours alert with numeric threshold and the project id', async () => {
    const { user, onSave } = renderModal();

    await user.selectOptions(typeSelect(), 'hours');
    await user.type(screen.getByPlaceholderText('מספר שעות'), '12.5');
    await user.type(screen.getByRole('textbox'), 'להתקשר ללקוח');
    await user.click(screen.getByRole('button', { name: 'שמור' }));

    expect(onSave).toHaveBeenCalledWith({
      alert_type: 'hours',
      threshold_value: 12.5,
      threshold_days: null,
      message: 'להתקשר ללקוח',
      project_id: 'p1'
    });
  });

  it('saves a deadline alert with integer days and a null message when empty', async () => {
    const { user, onSave } = renderModal();

    await user.selectOptions(typeSelect(), 'deadline');
    await user.type(screen.getByPlaceholderText('מספר ימים'), '7');
    await user.click(screen.getByRole('button', { name: 'שמור' }));

    expect(onSave).toHaveBeenCalledWith({
      alert_type: 'deadline',
      threshold_value: null,
      threshold_days: 7,
      message: null,
      project_id: 'p1'
    });
  });

  it('does not submit without an alert type (required field)', async () => {
    const { user, onSave } = renderModal();

    await user.click(screen.getByRole('button', { name: 'שמור' }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not submit an amount alert without a threshold', async () => {
    const { user, onSave } = renderModal();

    await user.selectOptions(typeSelect(), 'budget');
    await user.click(screen.getByRole('button', { name: 'שמור' }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a saving state while onSave is pending and blocks double submits', async () => {
    let finish;
    const onSave = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const { user } = renderModal({ onSave });

    await user.selectOptions(typeSelect(), 'hours');
    await user.type(screen.getByPlaceholderText('מספר שעות'), '3');
    await user.click(screen.getByRole('button', { name: 'שמור' }));

    const saving = screen.getByRole('button', { name: 'שומר...' });
    expect(saving).toBeDisabled();
    await user.click(saving);
    expect(onSave).toHaveBeenCalledTimes(1);

    finish();
    expect(await screen.findByRole('button', { name: 'שמור' })).toBeEnabled();
  });
});

describe('AlertModal - editing', () => {
  const existing = { id: 'a1', alert_type: 'budget', threshold_value: 5000, threshold_days: null, message: 'לשלוח חשבונית' };

  it('pre-fills the form from the alert', () => {
    renderModal({ alert: existing });

    expect(screen.getByRole('heading', { name: 'עריכת התראה' })).toBeInTheDocument();
    expect(typeSelect()).toHaveValue('budget');
    expect(screen.getByPlaceholderText('סכום ב-₪')).toHaveValue(5000);
    expect(screen.getByRole('textbox')).toHaveValue('לשלוח חשבונית');
  });

  it('saves the edited values without re-sending the project id', async () => {
    const { user, onSave } = renderModal({ alert: existing });

    const amount = screen.getByPlaceholderText('סכום ב-₪');
    await user.clear(amount);
    await user.type(amount, '7500');
    await user.clear(screen.getByRole('textbox'));
    await user.click(screen.getByRole('button', { name: 'שמור' }));

    expect(onSave).toHaveBeenCalledWith({
      alert_type: 'budget',
      threshold_value: 7500,
      threshold_days: null,
      message: null
    });
  });

  it('switching type drops the threshold that no longer applies', async () => {
    const { user, onSave } = renderModal({ alert: existing });

    await user.selectOptions(typeSelect(), 'deadline');
    await user.type(screen.getByPlaceholderText('מספר ימים'), '3');
    await user.click(screen.getByRole('button', { name: 'שמור' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      alert_type: 'deadline',
      threshold_value: null,
      threshold_days: 3
    }));
  });
});

describe('AlertModal - closing and scroll lock', () => {
  it('closes from the X button, the cancel button and the overlay, but not from inside the dialog', async () => {
    const { user, onClose } = renderModal();

    await user.click(screen.getByRole('heading', { name: 'התראה חדשה' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(document.querySelector('.modal-header button'));
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.click(document.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('locks body scrolling while open', () => {
    const { unmount } = renderModal();
    expect(document.body).toHaveClass('modal-open');

    unmount();
    expect(document.body).not.toHaveClass('modal-open');
  });
});
