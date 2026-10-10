/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */
import brandLogoUrl from '../../../assets/images/brand-logo.png';

export function AdminDashboardShell() {
  return (
    <section className="admin-shell" hidden id="adminDashboard">
      <div className="admin-backdrop" id="adminBackdrop" />
      <aside className="admin-sidebar" id="adminSidebar">
        <div className="brand">
          <img
            alt="AK Islamic logo — Rise Upon Deen"
            className="brand-logo"
            decoding="async"
            height="128"
            src={brandLogoUrl}
            width="128"
          />
        </div>
        <nav className="admin-nav">
          {'\n'}
          <button className="active" data-admin-view="names">
            {'Names of Allah '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="duas">
            {'Duas '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="hadith">
            {'Hadith '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="reminders">
            {'Reminders '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="zikr">
            {'Zikr '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="sadaqah">
            {'Sadaqah Requests '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="maintenance">
            {'Maintenance Mode '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="scheduled">
            {'Scheduled '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="trash">
            {'Recycle Bin '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="analytics">
            {'Analytics '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="notifications">
            {'Send Notification '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="deen-friends">
            {'Deen Friends '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="daily-challenges">
            {'Daily Deen Challenges '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="rise-inbox">
            {'RISE Inbox '}
            <span>{'›'}</span>
          </button>
          {'\n'}
          <button data-admin-view="broadcast">
            {'Broadcast Message '}
            <span>{'›'}</span>
          </button>
          {'\n'}
        </nav>
        <div className="admin-sidebar-bottom">
          <button className="premium-btn small" id="adminLogoutBtn">
            {'Logout'}
          </button>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button aria-label="Open admin menu" className="icon-btn admin-mobile-menu" id="adminMenuBtn">
              {'☰'}
            </button>
            <strong id="adminTopTitle">{'Dashboard'}</strong>
          </div>
          <span id="adminUserEmail" style={{ color: '#85868c', fontSize: '12px' }} />
        </header>
        <div className="admin-main" id="adminMain" />
      </div>
    </section>
  );
}
