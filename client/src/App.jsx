import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import useStore from './store/useStore';
import { ModalProvider } from './components/Modal';
import { TimerSyncProvider } from './components/TimerSyncProvider';

// Layout
import Layout from './components/Layout';
import AuthLayout from './components/AuthLayout';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import ClientDetail from './pages/ClientDetail';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import TaskDetail from './pages/TaskDetail';
import Tasks from './pages/Tasks';
import Profile from './pages/Profile';
import SharedClient from './pages/SharedClient';
import SharedProject from './pages/SharedProject';
import SharedAccess from './pages/SharedAccess';
import SharedWithMe from './pages/SharedWithMe';
import Reminders from './pages/Reminders';
import AdminPanel from './pages/AdminPanel';
import SettingsPage from './pages/SettingsPage';
import CredentialsPage from './pages/CredentialsPage';
import LeadsManagement from './pages/LeadsManagement';
import LeadDetail from './pages/LeadDetail';
import TimeEntries from './pages/TimeEntries';
import Payments from './pages/Payments';
import Schedule from './pages/Schedule';
import WorkspaceSettings from './pages/WorkspaceSettings';
import JoinWorkspace from './pages/JoinWorkspace';
import CatalogPage from './pages/CatalogPage';

// Protected Route
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useStore();

  if (isLoading) {
    return (
      <div className="loading" style={{ height: '100vh' }}>
        <div className="spinner"></div>
      </div>
    );
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
    return (
      <div className="loading" style={{ height: '100vh' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return !isAuthenticated ? children : <Navigate to="/" replace />;
};

function App() {
  const { initAuth } = useStore();

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // Auth bridge for Chrome extension
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.type === 'GET_AUTH_TOKEN') {
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
    <ModalProvider>
      <TimerSyncProvider>
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
      </TimerSyncProvider>
    </ModalProvider>
  );
}

export default App;
