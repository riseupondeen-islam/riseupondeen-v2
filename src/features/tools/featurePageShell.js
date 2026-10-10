/**
 * Shared helpers for feature pages (page header, show page, hash update).
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { showPage } from '../../app/routing/surfaces';

function esc(v = '') {
  return String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c],
  );
}
function pageHead(kicker, title, copy) {
  return `<header class="rud-feature-head"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${copy}</p></div><button type="button" class="rud-mini-btn" data-rud-feature-back aria-label="Back to home">← Back</button></header>`;
}
function featureShowPage(html, title) {
  return typeof showPage === 'function' ? showPage(html, title, window.__RUD_ROUTE_VERSION) : false;
}
function setFeatureHash(hash) {
  if (location.hash !== hash) history.pushState(null, '', hash);
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { esc, featureShowPage, pageHead, setFeatureHash };
