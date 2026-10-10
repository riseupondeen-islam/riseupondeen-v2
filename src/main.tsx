import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
// Start downloading the Firebase SDK immediately (same timing as the original page).
import './services/firebase/sdk';
import { App } from './app/App';

/* After a new deployment, an already-open tab may request a code chunk that no longer exists on
   Hosting. Vite reports that as "vite:preloadError"; reload (at most once a minute, and only when
   online — offline failures are left to the feature's own error state) to pick up the new build. */
window.addEventListener('vite:preloadError', () => {
  if (!navigator.onLine) return;
  try {
    const last = Number(sessionStorage.getItem('rud_chunk_reload_at') || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('rud_chunk_reload_at', String(Date.now()));
  } catch {
    return;
  }
  window.location.reload();
});

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
