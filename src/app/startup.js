/**
 * Start-up: renders the cached home content and runs the first route.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { rudIsAdminRoute, rudNormalizeAdminRoute } from './routing/routeState';
import { handleRoute } from './routing/router';
import { renderAdminRoute } from '../features/admin/adminLoader';
import { bindHomeDiscovery, renderHomeLive, renderSocialLinks } from '../features/home/homeContent';
import { startPublic } from '../services/content/publicContentSync';

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  renderSocialLinks();
  bindHomeDiscovery();
  if (rudIsAdminRoute()) {
    rudNormalizeAdminRoute();
    handleRoute();
    addEventListener(
      'pageshow',
      (e) => {
        if (e.persisted && rudIsAdminRoute()) renderAdminRoute();
      },
      { passive: true },
    );
  } else {
    startPublic();
    renderHomeLive();
    handleRoute();
  }
}
