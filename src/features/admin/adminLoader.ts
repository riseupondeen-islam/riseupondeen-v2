/* Public entry points into the admin console. The console itself (≈250 KB of code) is a separate
 * chunk that is only downloaded when someone opens the admin route. Calls made before it has
 * loaded are applied once it is ready (and only if the visitor is still on the admin route).
 */
import { rudIsAdminRoute } from '../../app/routing/routeState';

type AdminConsole = typeof import('./adminConsole');

let loaded: AdminConsole | null = null;
let loading: Promise<AdminConsole> | null = null;

export function loadAdminConsole(): Promise<AdminConsole> {
  if (!loading) {
    loading = import('./adminConsole')
      .then((mod) => {
        mod.startAdminConsole();
        loaded = mod;
        return mod;
      })
      .catch((error: unknown) => {
        loading = null; // allow a retry, e.g. after reconnecting
        throw error;
      });
  }
  return loading;
}

function whenLoaded(action: (mod: AdminConsole) => void): void {
  if (loaded) {
    action(loaded);
    return;
  }
  loadAdminConsole()
    .then((mod) => {
      if (rudIsAdminRoute()) action(mod);
    })
    .catch((error: unknown) => console.error('[Rise Upon Deen] Admin console could not be loaded.', error));
}

export function renderAdminRoute(): void {
  whenLoaded((mod) => mod.renderAdminRoute());
}
export function showAdminLogin(): void {
  whenLoaded((mod) => mod.showAdminLogin());
}
export function showAdminDashboard(): void {
  whenLoaded((mod) => mod.showAdminDashboard());
}
/** Only meaningful once the console exists (it closes the admin sidebar drawer). */
export function setAdminDrawer(open: boolean): void {
  loaded?.setAdminDrawer(open);
}
