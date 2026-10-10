/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */
/* Admin console shell (#adminApp). Behaviour lives in features/admin. */
import { AdminLoginView } from './AdminLoginView';
import { AdminDashboardShell } from './AdminDashboardShell';

export function AdminApp() {
  return (
    <main hidden id="adminApp">
      <AdminLoginView />
      <AdminDashboardShell />
    </main>
  );
}
