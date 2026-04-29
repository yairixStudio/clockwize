import { createContext, useContext, useEffect, useRef } from 'react';
import useStore from '../store/useStore';

const TimerSyncContext = createContext(null);

// Sync interval in milliseconds
const SYNC_INTERVAL = 5000; // 5 seconds for more responsive sync

/**
 * Provider for real-time timer synchronization across the app.
 * Polls the server periodically and syncs on visibility/focus changes.
 */
export function TimerSyncProvider({ children }) {
  const isAuthenticated = useStore(state => state.isAuthenticated);
  const currentWorkspace = useStore(state => state.currentWorkspace);
  const loadActiveTimers = useStore(state => state.loadActiveTimers);
  const timerOperationInProgress = useStore(state => state.timerOperationInProgress);
  
  const intervalRef = useRef(null);
  const lastSyncRef = useRef(0);
  const isSyncingRef = useRef(false);

  useEffect(() => {
    // Only sync when authenticated and have a workspace
    if (!isAuthenticated || !currentWorkspace) {
      // Clear interval if not authenticated
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Sync function
    const syncTimers = async () => {
      // Prevent concurrent syncs or sync during timer operations
      if (isSyncingRef.current) {
        console.log('[TimerSync] Already syncing, skipping');
        return;
      }
      
      isSyncingRef.current = true;
      try {
        console.log('[TimerSync] Syncing timers...');
        await loadActiveTimers();
        lastSyncRef.current = Date.now();
        console.log('[TimerSync] Sync complete');
      } catch (error) {
        console.error('[TimerSync] Error:', error);
      } finally {
        isSyncingRef.current = false;
      }
    };

    // Handle visibility change - sync when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[TimerSync] Tab visible, syncing...');
        syncTimers();
      }
    };

    // Handle focus - sync when window gains focus
    const handleFocus = () => {
      console.log('[TimerSync] Window focused, syncing...');
      syncTimers();
    };

    // Handle online - sync when network comes back
    const handleOnline = () => {
      console.log('[TimerSync] Network online, syncing...');
      syncTimers();
    };

    // Set up periodic polling
    console.log('[TimerSync] Starting polling every', SYNC_INTERVAL, 'ms');
    intervalRef.current = setInterval(() => {
      // Only sync if tab is visible
      if (document.visibilityState === 'visible') {
        syncTimers();
      }
    }, SYNC_INTERVAL);

    // Add event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    // Initial sync
    syncTimers();

    // Cleanup
    return () => {
      console.log('[TimerSync] Cleaning up');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [isAuthenticated, currentWorkspace?.id, loadActiveTimers]);

  return (
    <TimerSyncContext.Provider value={{ lastSync: lastSyncRef.current }}>
      {children}
    </TimerSyncContext.Provider>
  );
}

/**
 * Hook to access timer sync functionality
 */
export function useTimerSyncContext() {
  return useContext(TimerSyncContext);
}

export default TimerSyncProvider;
