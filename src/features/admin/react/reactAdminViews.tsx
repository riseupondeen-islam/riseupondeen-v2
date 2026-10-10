/* Mounts the React-based admin views into #adminMain (the rest of the console renders HTML strings).
 * The admin dispatcher calls unmountReactAdminView() before rendering any view, so a React root is
 * never left attached to replaced markup. */
import { createRoot, type Root } from 'react-dom/client';
import { DailyChallengesAdmin } from './DailyChallengesAdmin';
import { RiseInboxAdmin } from './RiseInboxAdmin';

let root: Root | null = null;

export function unmountReactAdminView(): void {
  if (!root) return;
  root.unmount();
  root = null;
}

export function renderReactAdminView(view: 'daily-challenges' | 'rise-inbox'): void {
  const main = document.getElementById('adminMain');
  if (!main) return;
  unmountReactAdminView();
  main.innerHTML = '';
  const host = document.createElement('div');
  host.className = 'df2-root df2-admin';
  main.appendChild(host);
  root = createRoot(host);
  root.render(view === 'daily-challenges' ? <DailyChallengesAdmin /> : <RiseInboxAdmin />);
}
