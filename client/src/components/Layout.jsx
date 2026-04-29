import { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Clock, Users, Bell, Share2, User, LogOut, Shield, Target, Menu, X, ChevronRight, ChevronLeft, BarChart2, ChevronUp, Folder, Home, Settings, Calendar, Key, Search, Package, RefreshCw } from 'lucide-react';
import useStore from '../store/useStore';
import { shareAPI, backupAPI } from '../services/api';
import ActiveTimer from './ActiveTimer';
import StatsBar from './StatsBar';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import GlobalSearch from './GlobalSearch';
import AIAssistant from './AIAssistant';
import './Layout.css';

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 220;

function Layout() {
  const { user, unreadRemindersCount, loadReminders, isAddonEnabled } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [sharedWithMeCount, setSharedWithMeCount] = useState(0);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [currentStats, setCurrentStats] = useState([]);
  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    // Load from localStorage
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved === 'true';
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [lastBackup, setLastBackup] = useState(null);
  const [backingUp, setBackingUp] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [dateRange, setDateRange] = useState(null); // { start: Date, end: Date } or null for monthly mode

  // Sidebar resize state
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth');
    return saved ? parseInt(saved, 10) : DEFAULT_SIDEBAR_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef(null);

  useEffect(() => {
    loadSharedWithMeCount();
    loadReminders({ include_read: 'true' });
    backupAPI.getStatus().then(data => {
      if (data.lastBackup) setLastBackup(new Date(data.lastBackup));
    }).catch(() => {});
  }, []);

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Clear stats when location changes (optional, but prevents stale stats)
  useEffect(() => {
    setCurrentStats([]);
    // We could also default isStatsOpen to false here if we wanted
  }, [location.pathname]);

  // Global keyboard shortcut for search (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't interfere with input fields (allow normal text selection and editing)
      const target = e.target;
      const isInputField = target.tagName === 'INPUT' ||
                          target.tagName === 'TEXTAREA' ||
                          target.isContentEditable;

      // Allow Command+A / Ctrl+A in input fields
      if (isInputField && (e.metaKey || e.ctrlKey) && e.key === 'a') {
        return; // Let the browser handle it
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Sidebar resize handlers
  const startResizing = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    localStorage.setItem('sidebarWidth', DEFAULT_SIDEBAR_WIDTH.toString());
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((e) => {
    if (!isResizing || isMobile) return;

    // Calculate new width based on mouse position (RTL: sidebar is on the right)
    const newWidth = window.innerWidth - e.clientX;

    if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
      setSidebarWidth(newWidth);
      localStorage.setItem('sidebarWidth', newWidth.toString());
    }
  }, [isResizing, isMobile]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', stopResizing);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, resize, stopResizing]);

  const handleManualBackup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    try {
      const data = await backupAPI.trigger();
      if (data.lastBackup) setLastBackup(new Date(data.lastBackup));
    } catch (e) {
      // ignore
    } finally {
      setBackingUp(false);
    }
  };

  const loadSharedWithMeCount = async () => {
    try {
      const links = await shareAPI.getSharedWithMe();
      setSharedWithMeCount(links.length);
    } catch (error) {
      // Ignore errors
    }
  };

  const closeMobileSidebar = () => {
    setIsMobileSidebarOpen(false);
  };

  const toggleSidebarCollapse = () => {
    const newState = !isSidebarCollapsed;
    setIsSidebarCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', newState.toString());
  };

  const toggleStats = () => {
    setIsStatsOpen(!isStatsOpen);
  };

  return (
    <div className={`layout ${isResizing ? 'layout-resizing' : ''}`}>
      {/* Mobile Header */}
      <header className="mobile-header">
        <button
          className="mobile-menu-btn"
          onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          aria-label="תפריט"
        >
          <Menu size={24} />
        </button>

        <NavLink to="/" className="mobile-logo">
          <Clock className="logo-icon" size={24} strokeWidth={2.5} />
          <span>Clockwize</span>
        </NavLink>

        <div className="mobile-header-actions">
          <ActiveTimer />
        </div>
      </header>

      {/* Sidebar Overlay for Mobile */}
      {isMobileSidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={closeMobileSidebar}
        />
      )}

      {/* Sidebar Collapse Button - outside sidebar */}
      <button
        className={`sidebar-collapse-btn ${isSidebarCollapsed ? 'collapsed' : ''}`}
        onClick={toggleSidebarCollapse}
        aria-label={isSidebarCollapsed ? 'הרחב תפריט' : 'כווץ תפריט'}
        title={isSidebarCollapsed ? 'הרחב תפריט' : 'כווץ תפריט'}
        style={!isMobile && !isSidebarCollapsed ? { right: `${sidebarWidth}px` } : undefined}
      >
        {isSidebarCollapsed ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`sidebar ${isMobileSidebarOpen ? 'sidebar-open' : ''} ${isSidebarCollapsed ? 'sidebar-collapsed' : ''} ${isResizing ? 'sidebar-resizing' : ''} mobile-sidebar`}
        style={!isMobile && !isSidebarCollapsed ? { width: `${sidebarWidth}px` } : undefined}
      >
        {/* Resize Handle */}
        {!isMobile && !isSidebarCollapsed && (
          <div
            className="sidebar-resize-handle"
            onMouseDown={startResizing}
            onDoubleClick={resetSidebarWidth}
            title="גרור לשינוי גודל, לחיצה כפולה לאיפוס"
          />
        )}
        {/* ... (sidebar content remains the same, I'm just showing context) ... */}
        <div className="sidebar-header">
          {/* ... */}
          <NavLink to="/" className="logo" onClick={closeMobileSidebar}>
            <Clock className="logo-icon" size={32} strokeWidth={2.5} />
            {(!isSidebarCollapsed || isMobile) && <span>Clockwize</span>}
          </NavLink>
          <button
            className="sidebar-close-btn"
            onClick={closeMobileSidebar}
            aria-label="סגור תפריט"
          >
            <X size={24} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <button
            className="nav-link search-btn"
            onClick={() => {
              setIsSearchOpen(true);
              closeMobileSidebar();
            }}
            title="חיפוש (Ctrl+K)"
          >
            <Search size={20} />
            {(!isSidebarCollapsed || isMobile) && <span>חיפוש</span>}
            {(!isSidebarCollapsed || isMobile) && <kbd className="search-shortcut-badge">⌘K</kbd>}
          </button>

          <NavLink
            to="/"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeMobileSidebar}
            title="דף הבית"
          >
            <Home size={20} />
            {(!isSidebarCollapsed || isMobile) && <span>דף הבית</span>}
          </NavLink>


          {isAddonEnabled('schedule') && (
            <NavLink
              to="/schedule"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={closeMobileSidebar}
              title="לו״ז"
            >
              <Calendar size={20} />
              {(!isSidebarCollapsed || isMobile) && <span>לו״ז</span>}
            </NavLink>
          )}

          {isAddonEnabled('leads_management') && (
            <NavLink
              to="/leads"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={closeMobileSidebar}
              title="לידים"
            >
              <Target size={20} />
              {(!isSidebarCollapsed || isMobile) && <span>לידים</span>}
            </NavLink>
          )}

          {isAddonEnabled('reminders') && (
            <NavLink
              to="/reminders"
              className={({ isActive }) => `nav-link reminders-link ${isActive ? 'active' : ''}`}
              onClick={closeMobileSidebar}
              title={`תזכורות${unreadRemindersCount > 0 ? ` (${unreadRemindersCount})` : ''}`}
            >
              <div className="nav-link-icon-wrapper">
                <Bell size={20} />
                {unreadRemindersCount > 0 && isSidebarCollapsed && (
                  <span className="nav-badge-dot reminder-badge-dot"></span>
                )}
              </div>
              {(!isSidebarCollapsed || isMobile) && (
                <>
                  <span>תזכורות</span>
                  {unreadRemindersCount > 0 && (
                    <span className="nav-badge reminder-badge">{unreadRemindersCount}</span>
                  )}
                </>
              )}
            </NavLink>
          )}

          {sharedWithMeCount > 0 && (
            <NavLink
              to="/shared-with-me"
              className={({ isActive }) => `nav-link shared-link ${isActive ? 'active' : ''}`}
              onClick={closeMobileSidebar}
              title={`שותף איתי (${sharedWithMeCount})`}
            >
              <div className="nav-link-icon-wrapper">
                <Share2 size={20} />
                {isSidebarCollapsed && (
                  <span className="nav-badge-dot">{sharedWithMeCount}</span>
                )}
              </div>
              {(!isSidebarCollapsed || isMobile) && (
                <>
                  <span>שותף איתי</span>
                  <span className="nav-badge">{sharedWithMeCount}</span>
                </>
              )}
            </NavLink>
          )}

          {isAddonEnabled('credentials') && (
            <NavLink
              to="/credentials"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={closeMobileSidebar}
              title="סיסמאות"
            >
              <Key size={20} />
              {(!isSidebarCollapsed || isMobile) && <span>סיסמאות</span>}
            </NavLink>
          )}

          {isAddonEnabled('catalog') && (
            <NavLink
              to="/catalog"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={closeMobileSidebar}
              title="קטלוג"
            >
              <Package size={20} />
              {(!isSidebarCollapsed || isMobile) && <span>קטלוג</span>}
            </NavLink>
          )}

          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-link ${isActive || location.pathname.startsWith('/settings') ? 'active' : ''}`}
            onClick={closeMobileSidebar}
            title="הגדרות"
          >
            <Settings size={20} />
            {(!isSidebarCollapsed || isMobile) && <span>הגדרות</span>}
          </NavLink>

          {user?.is_admin === 1 && (
            <NavLink
              to="/admin"
              className={({ isActive }) => `nav-link admin-link ${isActive ? 'active' : ''}`}
              onClick={closeMobileSidebar}
              title="ניהול"
            >
              <Shield size={20} />
              {(!isSidebarCollapsed || isMobile) && <span>ניהול</span>}
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-timer">
            <ActiveTimer isSidebar={true} isCollapsed={isSidebarCollapsed && !isMobile} />
          </div>

          <div className="sidebar-user">
            <WorkspaceSwitcher
              collapsed={isSidebarCollapsed && !isMobile}
              isMobile={isMobile}
              onClose={closeMobileSidebar}
            />
          </div>

          {lastBackup && (!isSidebarCollapsed || isMobile) && (
            <div className="sidebar-backup-status">
              <button
                className={`backup-trigger-btn${backingUp ? ' spinning' : ''}`}
                onClick={handleManualBackup}
                disabled={backingUp}
                title="גיבוי עכשיו"
              >
                <RefreshCw size={12} />
              </button>
              גיבוי אחרון: {lastBackup.toLocaleDateString('he-IL')} {lastBackup.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Stats Bar Section */}
        {currentStats.length > 0 && (
          <>
            <div className={`stats-panel ${isStatsOpen ? 'open' : ''}`}>
              <div className="container">
                <StatsBar 
                  stats={currentStats} 
                  selectedMonth={selectedMonth}
                  onMonthChange={setSelectedMonth}
                  dateRange={dateRange}
                  onDateRangeChange={setDateRange}
                />
              </div>
            </div>

            {/* Stats Collapse Button */}
            <div className="stats-toggle-wrapper">
              <button
                className="stats-collapse-btn"
                onClick={toggleStats}
                aria-label={isStatsOpen ? 'סגור סטטיסטיקות' : 'הצג סטטיסטיקות'}
                title={isStatsOpen ? 'סגור סטטיסטיקות' : 'הצג סטטיסטיקות'}
              >
                {isStatsOpen ? <ChevronUp size={20} /> : <BarChart2 size={20} />}
              </button>
            </div>
          </>
        )}

        <div className="container content-container">
          <Outlet context={{ setStats: setCurrentStats, selectedMonth, setSelectedMonth, dateRange, setDateRange }} />
        </div>
      </main>

      {/* Global Search */}
      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      {/* AI Assistant */}
      <AIAssistant />
    </div>
  );
}

export default Layout;

