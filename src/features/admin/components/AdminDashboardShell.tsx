/* Admin Console shell (#adminDashboard): a fixed sidebar that scrolls on its own, and a workspace
   whose content area (#adminMain) is the only vertical scroller on desktop. On small screens the
   sidebar becomes a drawer. Navigation behaviour lives in features/admin/adminRouter.js; the
   data-admin-view values are the contract with the view dispatcher (adminViews.js). */
import brandLogoUrl from '../../../assets/images/brand-logo.png';
import { AdminIcon } from './AdminIcon';
import { AdminThemeToggle } from './AdminThemeToggle';

type NavItem = { view: string; label: string; icon: string };

export const ADMIN_NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Overview',
    items: [
      { view: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { view: 'analytics', label: 'Visitor Analytics', icon: 'analytics' },
    ],
  },
  {
    group: 'Content',
    items: [
      { view: 'names', label: 'Names of Allah', icon: 'names' },
      { view: 'duas', label: 'Duas', icon: 'duas' },
      { view: 'hadith', label: 'Hadith', icon: 'hadith' },
      { view: 'reminders', label: 'Reminders', icon: 'reminders' },
      { view: 'zikr', label: 'Zikr', icon: 'zikr' },
      { view: 'sadaqah', label: 'Sadaqah Requests', icon: 'sadaqah' },
      { view: 'scheduled', label: 'Scheduled', icon: 'scheduled' },
      { view: 'trash', label: 'Recycle Bin', icon: 'trash' },
    ],
  },
  {
    group: 'Deen Friends',
    items: [
      { view: 'deen-friends', label: 'Deen Friends', icon: 'friends' },
      { view: 'daily-challenges', label: 'Daily Deen Challenges', icon: 'challenges' },
      { view: 'monthly-winner', label: 'Monthly Winner', icon: 'winner' },
      { view: 'rise-inbox', label: 'RISE Inbox', icon: 'inbox' },
      { view: 'rise-messages', label: 'RISE Messages', icon: 'messages' },
    ],
  },
  {
    group: 'Communication',
    items: [
      { view: 'notifications', label: 'Send Notification', icon: 'notifications' },
      { view: 'broadcast', label: 'Broadcast Message', icon: 'broadcast' },
    ],
  },
  {
    group: 'System',
    items: [
      { view: 'maintenance', label: 'Maintenance Mode', icon: 'maintenance' },
      { view: 'app-guide', label: 'App Guide', icon: 'guide' },
      { view: 'data-reset', label: 'Data & Accounts', icon: 'data' },
    ],
  },
];

export function AdminDashboardShell() {
  return (
    <section className="admin-shell rad-shell" hidden id="adminDashboard">
      <div aria-hidden="true" className="admin-backdrop rad-backdrop" id="adminBackdrop" />
      <aside aria-label="Admin navigation" className="admin-sidebar rad-sidebar" id="adminSidebar">
        <div className="rad-brand">
          <img alt="" className="rad-brand-logo" decoding="async" height="40" src={brandLogoUrl} width="40" />
          <div className="rad-brand-text">
            <b>Rise Upon Deen</b>
            <span>Admin Console</span>
          </div>
          <button aria-label="Close menu" className="rad-icon-btn rad-sidebar-close" id="adminMenuClose" type="button">
            <AdminIcon name="close" />
          </button>
        </div>
        <nav aria-label="Sections" className="admin-nav rad-nav">
          {ADMIN_NAV.map((section) => (
            <div className="rad-nav-group" key={section.group} role="group" aria-label={section.group}>
              <p className="rad-nav-label">{section.group}</p>
              {section.items.map((item) => (
                <button
                  className={item.view === 'dashboard' ? 'active' : undefined}
                  data-admin-view={item.view}
                  key={item.view}
                  type="button"
                >
                  <AdminIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar-bottom rad-sidebar-bottom">
          <a className="rad-nav-link" href="#home">
            <AdminIcon name="external" />
            <span>View website</span>
          </a>
          <button className="rad-nav-link rad-logout" id="adminLogoutBtn" type="button">
            <AdminIcon name="logout" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      <div className="admin-workspace rad-workspace">
        <header className="admin-topbar rad-topbar">
          <div className="rad-topbar-start">
            <button
              aria-controls="adminSidebar"
              aria-expanded="false"
              aria-label="Open admin menu"
              className="rad-icon-btn admin-mobile-menu"
              id="adminMenuBtn"
              type="button"
            >
              <AdminIcon name="menu" />
            </button>
            <div className="rad-topbar-title">
              <span className="rad-crumb">Admin Console</span>
              <strong id="adminTopTitle">Dashboard</strong>
            </div>
          </div>
          <div className="rad-topbar-end">
            <AdminThemeToggle id="adminThemeToggle" />
            <span className="rad-user-chip" title="Signed-in administrator">
              <span aria-hidden="true" className="rad-user-dot" />
              <span id="adminUserEmail" />
            </span>
          </div>
        </header>
        <div className="admin-main rad-main" id="adminMain" tabIndex={-1} />
      </div>
    </section>
  );
}
