// Stylesheets of the lazily loaded pages (App.jsx), imported eagerly and in a fixed order.
//
// The page stylesheets are not scoped: several of them define classes that other pages use too
// (Reminders.css, Settings.css, Credentials.css, ...), so the result depends on the order the rules
// end up in. All CSS still ships as a single file (build.cssCodeSplit: false in vite.config.js), and
// this list keeps that file identical to the one built before the pages were code-split: it is the
// order the stylesheets were first reached when App.jsx imported every page statically, from
// ClientDetail down to CatalogPage. Without it, the CSS of every lazy page would move after
// styles/global.css and change which rule wins.
//
// A stylesheet that only a lazy page imports and that is missing here still works, but lands at the
// end of the CSS file - vite.config.js warns about it at build time. Add it here, in the position of
// the page that first imports it.

// ClientDetail
import './components/BreadcrumbItem.css';
import './components/ShareModal.css';
import './pages/Reminders.css';
import 'react-quill/dist/quill.snow.css';
import './components/NotesTab.css';
import './components/FilesSection.css';
import './components/TimeEntryItem.css';
import './components/ActiveTimerEntry.css';
import './components/SmartPaymentModal.css';
import './components/TimeSummary.css';
import './components/Credentials.css';
import './pages/ClientDetail.css';
import './styles/reminders-mini.css';
import './pages/Settings.css'; // through apps/morning
// Projects
import './pages/Projects.css';
// ProjectDetail, TaskDetail, Tasks, Profile
import './pages/ProjectDetail.css';
import './pages/TaskDetail.css';
import './pages/Tasks.css';
import './pages/Profile.css';
// SharedClient (also SharedProject, SharedAccess), SharedWithMe, AdminPanel
import './pages/SharedClient.css';
import './pages/SharedWithMe.css';
import './pages/AdminPanel.css';
// SettingsPage
import './components/PasskeysManager.css';
import './pages/SettingsPage.css';
// LeadsManagement, LeadDetail
import './components/LeadFilterBar.css';
import './components/LeadListView.css';
import './components/LeadKanbanBoard.css';
import './components/LeadTimelineView.css';
import './pages/LeadsManagement.css';
import './components/LeadActivityTimeline.css';
import './pages/LeadDetail.css';
// TimeEntries, Payments, Schedule, WorkspaceSettings, JoinWorkspace, CatalogPage
import './pages/TimeEntries.css';
import './pages/Payments.css';
import './pages/Schedule.css';
import './pages/WorkspaceSettings.css';
import './pages/JoinWorkspace.css';
import './components/CatalogModal.css';
import './pages/CatalogPage.css';
