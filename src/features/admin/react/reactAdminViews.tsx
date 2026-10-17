/* Mounts the React-based admin views into #adminMain (the older views render HTML strings).
 * The admin dispatcher calls unmountReactAdminView() before rendering any view, so a React root is
 * never left attached to replaced markup, and its listeners stop with it. */
import { Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DailyChallengesAdmin } from './DailyChallengesAdmin';
import { RiseInboxAdmin } from './RiseInboxAdmin';
import { GuideAdmin } from './GuideAdmin';
import { WinnerAdmin } from './WinnerAdmin';
import { DataResetAdmin } from './DataResetAdmin';
import { RiseMessagesAdmin } from './RiseMessagesAdmin';
import { NotificationSettingsAdmin } from './NotificationSettingsAdmin';
import { PageHead } from './ui';

let root: Root | null = null;

export const REACT_ADMIN_VIEWS = [
  'daily-challenges',
  'rise-inbox',
  'rise-messages',
  'app-guide',
  'monthly-winner',
  'data-reset',
  'notification-settings',
] as const;
export type ReactAdminView = (typeof REACT_ADMIN_VIEWS)[number];

class ViewBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('[Admin] view crashed', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="rad-card rad-fatal" role="alert">
        <h2>This section could not be displayed</h2>
        <p className="rad-muted">Your sign-in is still active and nothing was changed.</p>
        <pre className="rad-code">{String(this.state.error.message || this.state.error)}</pre>
        <button className="rad-btn rad-btn-primary" type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </section>
    );
  }
}

export function unmountReactAdminView(): void {
  if (!root) return;
  root.unmount();
  root = null;
}

function viewFor(view: ReactAdminView) {
  switch (view) {
    case 'daily-challenges':
      return <DailyChallengesAdmin />;
    case 'app-guide':
      return <GuideAdmin />;
    case 'monthly-winner':
      return (
        <>
          <PageHead kicker="Deen Friends · Official" title="Monthly Winner" description="Announce up to three members with the most points last month. Members see it first in their Challenges tab." />
          <WinnerAdmin />
        </>
      );
    case 'data-reset':
      return (
        <>
          <PageHead kicker="System" title="Data & Accounts" description="Super Admin data tools. Every action here is recorded in the admin audit log." />
          <DataResetAdmin />
        </>
      );
    case 'rise-messages':
      return <RiseMessagesAdmin />;
    case 'notification-settings':
      return <NotificationSettingsAdmin />;
    default:
      return <RiseInboxAdmin />;
  }
}

export function renderReactAdminView(view: ReactAdminView | string): void {
  const main = document.getElementById('adminMain');
  if (!main) return;
  unmountReactAdminView();
  main.innerHTML = '';
  const host = document.createElement('div');
  host.className = 'rad-react-view df2-root df2-admin';
  host.dataset.view = view;
  main.appendChild(host);
  root = createRoot(host);
  root.render(<ViewBoundary>{viewFor(view as ReactAdminView)}</ViewBoundary>);
}
