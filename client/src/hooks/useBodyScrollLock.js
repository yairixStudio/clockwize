import { useEffect } from 'react';

// Nested modals each lock the body, so the styles are applied on the first
// lock and restored only when the last one is released
let lockCount = 0;
let savedScrollY = 0;
let savedScrollX = 0;

/**
 * Hook to lock body scroll when a modal is open
 * @param {boolean} isLocked - Whether to lock the scroll
 */
export function useBodyScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked) return;

    lockCount += 1;

    if (lockCount === 1) {
      // Store scroll position
      savedScrollY = window.scrollY;
      savedScrollX = window.scrollX;

      // Add modal-open class to body
      document.body.classList.add('modal-open');
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.left = '0';
    }

    return () => {
      lockCount -= 1;
      if (lockCount > 0) return;

      // Remove modal-open class
      document.body.classList.remove('modal-open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.left = '';

      // Restore scroll position
      window.scrollTo(savedScrollX, savedScrollY);
    };
  }, [isLocked]);
}

export default useBodyScrollLock;
