import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalProvider, useModal } from './index';

let modal;
function Grab() {
  modal = useModal();
  return null;
}

const renderProvider = () => {
  render(<ModalProvider><Grab /></ModalProvider>);
  return userEvent.setup();
};

const openPrompt = (options) => {
  let result;
  act(() => { result = modal.prompt('הזן ערך:', options); });
  return result;
};

describe('modal.prompt input type', () => {
  it('is a labelled plain text field by default', () => {
    renderProvider();
    openPrompt({ placeholder: 'שם' });

    const input = screen.getByLabelText('הזן ערך:');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).not.toHaveAttribute('autocomplete');
    expect(document.querySelector('.custom-modal')).toHaveClass('custom-modal--info');
  });

  it('masks the value with inputType: "password" and resolves with what was typed', async () => {
    const user = renderProvider();
    const result = openPrompt({ inputType: 'password', placeholder: 'סיסמה חדשה' });

    const input = screen.getByLabelText('הזן ערך:');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');

    await user.type(input, 'secret');
    await user.click(screen.getByRole('button', { name: 'אישור' }));
    await expect(result).resolves.toBe('secret');
  });

  it('reads the older { type: "password" } as a masked field with the default style', () => {
    renderProvider();
    openPrompt({ type: 'password' });

    expect(screen.getByLabelText('הזן ערך:')).toHaveAttribute('type', 'password');
    expect(document.querySelector('.custom-modal')).toHaveClass('custom-modal--info');
    expect(document.querySelector('.custom-modal__icon')).toHaveTextContent('💬');
  });

  it('keeps type as the modal style for other values', () => {
    renderProvider();
    openPrompt({ type: 'warning' });

    expect(screen.getByLabelText('הזן ערך:')).toHaveAttribute('type', 'text');
    expect(document.querySelector('.custom-modal')).toHaveClass('custom-modal--warning');
  });

  it('a later prompt without inputType is a text field again', async () => {
    const user = renderProvider();
    openPrompt({ inputType: 'password' });
    await user.click(screen.getByRole('button', { name: 'ביטול' }));

    openPrompt();
    expect(screen.getByLabelText('הזן ערך:')).toHaveAttribute('type', 'text');
  });
});
