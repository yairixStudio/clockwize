import { Suspense } from 'react';

// Shown while a lazily loaded page (App.jsx) downloads its code
export function RouteFallback({ fullPage = false }) {
  return (
    <div
      className="loading route-loading"
      role="status"
      aria-label="טוען…"
      style={fullPage ? { height: '100vh' } : { minHeight: '40vh' }}
    >
      <div className="spinner"></div>
    </div>
  );
}

// Suspense boundary for routed pages. Inside Layout it wraps only the <Outlet>, so the sidebar and
// header stay on screen while the next page's chunk loads.
function RouteSuspense({ children, fullPage = false }) {
  return <Suspense fallback={<RouteFallback fullPage={fullPage} />}>{children}</Suspense>;
}

export default RouteSuspense;
