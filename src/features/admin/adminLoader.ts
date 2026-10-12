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
    .catch((error: unknown) => {
      console.error('[Rise Upon Deen] Admin console could not be loaded.', error);
      const gate = document.querySelector('#adminAuthGate span');
      if (gate && rudIsAdminRoute()) gate.textContent = 'The Admin Console could not load. Check your connection and reload the page.';
    });
}

/** Shows the neutral "verifying" screen at once, so neither the public page nor any admin screen is
 *  visible while the console chunk downloads and the session is checked. */
function showVerifyingScreen(): void {
  const app = document.getElementById('adminApp');
  if (!app) return;
  if (!loaded) app.dataset.auth = 'checking';
  app.hidden = false;
  for (const el of [
    document.querySelector('#root > main:not(#dynamicPage):not(#adminApp)'),
    document.querySelector('#root > footer'),
    document.getElementById('dynamicPage'),
  ])
    if (el instanceof HTMLElement) el.hidden = true;
}

export function renderAdminRoute(): void {
  showVerifyingScreen();
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
