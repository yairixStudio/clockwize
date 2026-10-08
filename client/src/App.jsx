import { lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { authAPI } from './services/api';
import useStore from './store/useStore';
import { ModalProvider } from './components/Modal';
import { TimerSyncProvider } from './components/TimerSyncProvider';
import ErrorBoundary from './components/ErrorBoundary';
import RouteSuspense from './components/RouteSuspense';

// Layout
import Layout from './components/Layout';
import AuthLayout from './components/AuthLayout';

// Pages on the first screen a user sees stay in the main bundle
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';

// The CSS of the lazy pages below, in its original cascade order (see routeStyles.js)
import './routeStyles';

// After a new build is deployed, an open tab still asks for the previous build's chunk files, which
// are gone. Reload once to pick up the new build instead of showing the error screen.
const RELOADED_FOR_CHUNK = 'clockwize:reloaded-for-chunk';
const lazyPage = (load) => lazy(() => load().then(
  (module) => {
    try { sessionStorage.removeItem(RELOADED_FOR_CHUNK); } catch { /* storage unavailable */ }
    return module;
  },
  (error) => {
    let reloaded = true;
    try {
      reloaded = sessionStorage.getItem(RELOADED_FOR_CHUNK) === '1';
      if (!reloaded) sessionStorage.setItem(RELOADED_FOR_CHUNK, '1');
    } catch { /* storage unavailable - don't risk a reload loop */ }
    if (reloaded) throw error;
    window.location.reload();
    return new Promise(() => {});
  }
));

// Every other page is split into its own chunk, loaded on first visit
const ClientDetail = lazyPage(() => import('./pages/ClientDetail'));
const Projects = lazyPage(() => import('./pages/Projects'));
const ProjectDetail = lazyPage(() => import('./pages/ProjectDetail'));
const TaskDetail = lazyPage(() => import('./pages/TaskDetail'));
const Tasks = lazyPage(() => import('./pages/Tasks'));
const Profile = lazyPage(() => import('./pages/Profile'));
const SharedClient = lazyPage(() => import('./pages/SharedClient'));
const SharedProject = lazyPage(() => import('./pages/SharedProject'));
const SharedAccess = lazyPage(() => import('./pages/SharedAccess'));
const SharedWithMe = lazyPage(() => import('./pages/SharedWithMe'));
const Reminders = lazyPage(() => import('./pages/Reminders'));
const AdminPanel = lazyPage(() => import('./pages/AdminPanel'));
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'));
const CredentialsPage = lazyPage(() => import('./pages/CredentialsPage'));
const LeadsManagement = lazyPage(() => import('./pages/LeadsManagement'));
const LeadDetail = lazyPage(() => import('./pages/LeadDetail'));
const TimeEntries = lazyPage(() => import('./pages/TimeEntries'));
const Payments = lazyPage(() => import('./pages/Payments'));
const Schedule = lazyPage(() => import('./pages/Schedule'));
const WorkspaceSettings = lazyPage(() => import('./pages/WorkspaceSettings'));
const JoinWorkspace = lazyPage(() => import('./pages/JoinWorkspace'));
const CatalogPage = lazyPage(() => import('./pages/CatalogPage'));

// Protected Route
// Shown while the session is being restored; says so when the server is slow to answer
const SessionLoading = () => {
  const connectionError = useStore((state) => state.connectionError);
  return (
    <div className="loading" style={{ height: '100vh', flexDirection: 'column', gap: '1rem' }}>
      <div className="spinner"></div>
      {connectionError && <p className="text-muted" role="status">מתחבר לשרת…</p>}
    </div>
  );
};

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useStore();

  if (isLoading) {
    return <SessionLoading />;
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

// Addon Protected Route - redirects to home if addon is disabled
const AddonProtectedRoute = ({ children, addonId }) => {
  const { isAddonEnabled } = useStore();
  
  // Check if addon is enabled
  if (!isAddonEnabled(addonId)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

// Guest Route (only for non-authenticated users)
const GuestRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useStore();

  if (isLoading) {
    return <SessionLoading />;
  }

  if (isAuthenticated && new URLSearchParams(window.location.search).get('passkey') === 'desktop') {
    return <DesktopHandoff />;
  }

  return !isAuthenticated ? children : <Navigate to="/" replace />;
};

// The desktop app sent the user here to sign in with a passkey, but this browser is already
// signed in: pass the session over instead of asking again
function DesktopHandoff() {
  const [status, setStatus] = useState('working');

  useEffect(() => {
    authAPI.desktopHandoff()
      .then(() => setStatus('done'))
      .catch(() => setStatus('failed'));
  }, []);

  return (
    <div className="desktop-handoff" role="status">
      <h1>Clockwize</h1>
      <p>
        {status === 'working' && 'מעביר את ההתחברות לאפליקציה…'}
        {status === 'done' && 'האפליקציה מחוברת. אפשר לסגור את הלשונית ולחזור ל-Clockwize.'}
        {status === 'failed' && 'ההעברה לא הצליחה. נסו להתחבר מחדש באפליקציה.'}
      </p>
      {status !== 'working' && <Link to="/" className="btn btn-secondary">להמשיך בדפדפן</Link>}
    </div>
  );
}

function App() {
  const { initAuth } = useStore();

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // Auth bridge for Chrome extension
  useEffect(() => {
    const handleMessage = (event) => {
      // Only the Clockwize side panel (an extension page framing this app) may ask for the token -
      // any other window that opens or frames the app must not be able to read it
      const fromExtensionParent = event.origin.startsWith('chrome-extension://') && event.source === window.parent && window.parent !== window;
      if (event.data?.type === 'GET_AUTH_TOKEN' && fromExtensionParent) {
        const token = localStorage.getItem('token');
        const workspaceId = localStorage.getItem('currentWorkspaceId');
        event.source?.postMessage({
          type: 'AUTH_TOKEN_RESPONSE',
          token,
          workspaceId
        }, event.origin);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <ErrorBoundary>
    <ModalProvider>
      <TimerSyncProvider>
      {/* Pages inside Layout have their own boundary around the <Outlet>; this one covers the rest */}
      <RouteSuspense fullPage>
      <Routes>
        {/* New unified share access (with password/email support) */}
        <Route path="/s/:token" element={<SharedAccess />} />

        {/* Workspace join page (can be accessed when not logged in) */}
        <Route path="/join/:code" element={<JoinWorkspace />} />

        {/* Legacy public shared views (backwards compatibility) */}
        <Route path="/shared/client/:token" element={<SharedClient />} />
        <Route path="/shared/project/:token" element={<SharedProject />} />
        <Route path="/shared/:token" element={<SharedClient />} />

        {/* Auth routes */}
        <Route element={<GuestRoute><AuthLayout /></GuestRoute>}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>

        {/* Protected routes */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/shared-with-me" element={<SharedWithMe />} />
          <Route path="/reminders" element={
            <AddonProtectedRoute addonId="reminders">
              <Reminders />
            </AddonProtectedRoute>
          } />
          <Route path="/leads" element={
            <AddonProtectedRoute addonId="leads_management">
              <LeadsManagement />
            </AddonProtectedRoute>
          } />
          <Route path="/leads/:id" element={
            <AddonProtectedRoute addonId="leads_management">
              <LeadDetail />
            </AddonProtectedRoute>
          } />
          <Route path="/schedule" element={
            <AddonProtectedRoute addonId="schedule">
              <Schedule />
            </AddonProtectedRoute>
          } />
          <Route path="/credentials" element={
            <AddonProtectedRoute addonId="credentials">
              <CredentialsPage />
            </AddonProtectedRoute>
          } />
          <Route path="/catalog" element={
            <AddonProtectedRoute addonId="catalog">
              <CatalogPage />
            </AddonProtectedRoute>
          } />
          <Route path="/time-entries" element={<TimeEntries />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/workspace" element={<WorkspaceSettings />} />
          <Route path="/admin" element={<AdminPanel />} />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </RouteSuspense>
      </TimerSyncProvider>
    </ModalProvider>
    </ErrorBoundary>
  );
}

export default App;
