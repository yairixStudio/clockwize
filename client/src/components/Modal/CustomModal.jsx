import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import './CustomModal.css';

const ICONS = {
  info: '💬',
  success: '✓',
  warning: '⚠',
  error: '✕',
  confirm: '?'
};

function CustomModal({
  isOpen,
  type = 'info',
  title,
  message,
  confirmText = 'אישור',
  cancelText = 'ביטול',
  showCancel = false,
  isPrompt = false,
  promptValue = '',
  placeholder = '',
  onConfirm,
  onCancel
}) {
  const confirmBtnRef = useRef(null);
  const inputRef = useRef(null);
  const [inputValue, setInputValue] = useState('');
  
  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (isOpen) {
      if (isPrompt && inputRef.current) {
        inputRef.current.focus();
        setInputValue('');
      } else if (confirmBtnRef.current) {
        confirmBtnRef.current.focus();
      }
    }
  }, [isOpen, isPrompt]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      
      if (e.key === 'Escape') {
        if (showCancel && onCancel) {
          onCancel();
        } else if (onConfirm) {
          onConfirm(isPrompt ? inputValue : undefined);
        }
      } else if (e.key === 'Enter') {
        if (onConfirm) {
          onConfirm(isPrompt ? inputValue : undefined);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel, showCancel, isPrompt, inputValue]);

  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      if (showCancel && onCancel) {
        onCancel();
      }
    }
  };

  return createPortal(
    <div className="custom-modal-overlay" onClick={handleOverlayClick}>
      <div className={`custom-modal custom-modal--${type}`}>
        <div className={`custom-modal__icon custom-modal__icon--${type}`}>
          {ICONS[type]}
        </div>
        
        <h3 className="custom-modal__title">{title}</h3>
        
        <p className="custom-modal__message">{message}</p>
        
        {isPrompt && (
          <input
            ref={inputRef}
            type="text"
            className="custom-modal__input"
            placeholder={placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
        )}
        
        <div className="custom-modal__actions">
          <button
            ref={!isPrompt ? confirmBtnRef : null}
            className={`custom-modal__btn custom-modal__btn--${type}`}
            onClick={() => onConfirm(isPrompt ? inputValue : undefined)}
          >
            {confirmText}
          </button>
          
          {showCancel && (
            <button
              className="custom-modal__btn custom-modal__btn--cancel"
              onClick={onCancel}
            >
              {cancelText}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CustomModal;
