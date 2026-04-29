import { useEffect } from 'react';

/**
 * Hook to lock body scroll when a modal is open
 * @param {boolean} isLocked - Whether to lock the scroll
 */
export function useBodyScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked) return;

    // Store scroll position
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    
    // Add modal-open class to body
    document.body.classList.add('modal-open');
    document.body.style.top = `-${scrollY}px`;
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.left = '0';
    
    return () => {
      // Remove modal-open class
      document.body.classList.remove('modal-open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.left = '';
      
      // Restore scroll position
      window.scrollTo(scrollX, scrollY);
    };
  }, [isLocked]);
}

export default useBodyScrollLock;
