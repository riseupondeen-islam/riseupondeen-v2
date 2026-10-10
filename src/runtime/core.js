/**
 * Core DOM helpers and constants shared by the feature modules ($, $$, publicMain/publicFooter, …).
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */

let $, $$, coarsePointer, reducedMotion, COLLECTION, DEFAULT_TITLE, publicMain, publicFooter;

function dailyPick(items, offset = 0) {
  if (!items || !items.length) return null;
  const now = new Date();
  const dayKey = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return items[(dayKey + offset) % items.length];
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  /* ==============================
   APPLICATION STATE
================================ */
  $ = (s, root = document) => root.querySelector(s);
  $$ = (s, root = document) => [...root.querySelectorAll(s)];
  coarsePointer = true;
  /* Performance mode: disables decorative parallax/tilt/custom-cursor loops. */
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  COLLECTION = 'content';
  DEFAULT_TITLE = 'Rise Upon Deen | Islamic Reminders, Duas, Hadith & 99 Names of Allah';
  publicMain = document.querySelector('#root > main:not(#dynamicPage):not(#adminApp)');
  publicFooter = document.querySelector('#root > footer');
}

export { $, $$, COLLECTION, DEFAULT_TITLE, coarsePointer, dailyPick, publicFooter, publicMain };
