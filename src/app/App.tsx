import { memo, useEffect } from 'react';
import { AppShell } from './AppShell';
import { ReactPageOutlet } from './pages/reactPageOutlet';
import { useZoomLock } from '../hooks/useZoomLock';
import { usePageVisibilityClass } from '../hooks/usePageVisibilityClass';
import { useDevicePerformanceClass } from '../hooks/useDevicePerformanceClass';
import { useRouteChromeBodyClasses } from '../hooks/useRouteChrome';

/** The shell never needs to re-render; memo makes that explicit. */
const StaticShell = memo(AppShell);

/**
 * Root component. The shell is rendered once and never re-rendered, because the feature
 * controllers (and the pages they render into #dynamicPage) own those DOM nodes afterwards.
 * The controller runtime is a separate chunk loaded right after the first paint.
 */
export function App() {
  useZoomLock();
  usePageVisibilityClass();
  useDevicePerformanceClass();
  useRouteChromeBodyClasses();
  useEffect(() => {
    let cancelled = false;
    import('../runtime/legacyRuntime').then(({ startLegacyRuntime }) => {
      if (!cancelled) startLegacyRuntime();
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <>
      <StaticShell />
      <ReactPageOutlet />
    </>
  );
}
