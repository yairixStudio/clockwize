import { createContext, useContext, useState, useCallback } from 'react';
import CustomModal from './CustomModal';

const ModalContext = createContext(null);

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within ModalProvider');
  }
  return context;
};

export function ModalProvider({ children }) {
  const [modalState, setModalState] = useState({
    isOpen: false,
    type: 'info', // info, success, warning, error, confirm, prompt
    title: '',
    message: '',
    onConfirm: null,
    onCancel: null,
    confirmText: 'אישור',
    cancelText: 'ביטול',
    showCancel: false,
    isPrompt: false,
    promptValue: '',
    placeholder: ''
  });

  const closeModal = useCallback(() => {
    setModalState(prev => ({ ...prev, isOpen: false }));
  }, []);

  // Alert - just shows a message
  const alert = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        type: options.type || 'info',
        title: options.title || 'הודעה',
        message,
        confirmText: options.confirmText || 'אישור',
        cancelText: 'ביטול',
        showCancel: false,
        onConfirm: () => {
          closeModal();
          resolve(true);
        },
        onCancel: null
      });
    });
  }, [closeModal]);

  // Success message
  const success = useCallback((message, options = {}) => {
    return alert(message, { ...options, type: 'success', title: options.title || 'הצלחה' });
  }, [alert]);

  // Error message
  const error = useCallback((message, options = {}) => {
    return alert(message, { ...options, type: 'error', title: options.title || 'שגיאה' });
  }, [alert]);

  // Warning message
  const warning = useCallback((message, options = {}) => {
    return alert(message, { ...options, type: 'warning', title: options.title || 'אזהרה' });
  }, [alert]);

  // Confirm - asks for confirmation
  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        type: options.type || 'warning',
        title: options.title || 'אישור',
        message,
        confirmText: options.confirmText || 'אישור',
        cancelText: options.cancelText || 'ביטול',
        showCancel: true,
        isPrompt: false,
        onConfirm: () => {
          closeModal();
          resolve(true);
        },
        onCancel: () => {
          closeModal();
          resolve(false);
        }
      });
    });
  }, [closeModal]);

  // Prompt - asks for text input
  const prompt = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        type: options.type || 'info',
        title: options.title || 'הזן ערך',
        message,
        confirmText: options.confirmText || 'אישור',
        cancelText: options.cancelText || 'ביטול',
        showCancel: true,
        isPrompt: true,
        promptValue: '',
        placeholder: options.placeholder || '',
        onConfirm: (value) => {
          closeModal();
          resolve(value);
        },
        onCancel: () => {
          closeModal();
          resolve(null);
        }
      });
    });
  }, [closeModal]);

  const value = {
    alert,
    success,
    error,
    warning,
    confirm,
    prompt,
    closeModal
  };

  return (
    <ModalContext.Provider value={value}>
      {children}
      <CustomModal
        isOpen={modalState.isOpen}
        type={modalState.type}
        title={modalState.title}
        message={modalState.message}
        confirmText={modalState.confirmText}
        cancelText={modalState.cancelText}
        showCancel={modalState.showCancel}
        isPrompt={modalState.isPrompt}
        promptValue={modalState.promptValue}
        placeholder={modalState.placeholder}
        onConfirm={modalState.onConfirm}
        onCancel={modalState.onCancel}
      />
    </ModalContext.Provider>
  );
}


