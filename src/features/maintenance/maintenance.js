/**
 * Maintenance mode (public side): live config listener, countdown screen and allow-listed visitors.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { rudIsAdminRoute } from '../../app/routing/routeState';
import { handleRoute } from '../../app/routing/router';
import { rudVisitorId } from '../analytics/visitorAnalytics';
import { rudHideBroadcast, rudStartBroadcastListener, rudStopBroadcastListener } from '../broadcast/broadcast';
import { $, COLLECTION, publicFooter, publicMain } from '../../runtime/core';
import { cachePublicContent } from '../../services/content/publicContentCache';
import { doc, onSnapshot } from '../../services/firebase/sdk';
import { closeLayer, millis } from '../../utils/ui';

let MAINTENANCE_DOC_ID, maintenanceTimer;

function maintenanceConfigFrom(items = S.publicContent) {
  return (
    (items || []).find((x) => x?.id === MAINTENANCE_DOC_ID || (x?.type === 'site' && x?.siteKey === 'maintenance')) ||
    null
  );
}
function maintenanceEndMs(cfg) {
  const v = cfg?.maintenanceEndTime;
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v?.seconds) return Number(v.seconds) * 1000;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}
function maintenanceIsActive(cfg) {
  return !!cfg?.maintenanceEnabled && maintenanceEndMs(cfg) > Date.now();
}
function maintenanceVisitorId() {
  try {
    return typeof rudVisitorId === 'function' ? rudVisitorId() : localStorage.getItem('rud_visitor_id') || '';
  } catch {
    return '';
  }
}
function maintenanceUserAllowed(cfg) {
  const visitorId = maintenanceVisitorId();
  return (
    !!visitorId &&
    Array.isArray(cfg?.maintenanceAllowedVisitorIds) &&
    cfg.maintenanceAllowedVisitorIds.includes(visitorId)
  );
}
function syncMaintenanceConfig(cfg) {
  if (rudIsAdminRoute()) return;
  if (maintenanceIsActive(cfg) && !maintenanceUserAllowed(cfg)) showMaintenance(cfg);
  else if (window.RUD_MAINTENANCE_ACTIVE) {
    /* Maintenance ended, or this visitor was just granted Maintenance Access: the page that was
       hidden behind the maintenance screen must be rendered again. hideMaintenance() alone left
       non-home routes blank until the visitor navigated or reloaded. */
    hideMaintenance();
    try {
      handleRoute();
    } catch {}
  } else hideMaintenance();
}
function stopMaintenanceLive() {
  try {
    S.maintenanceUnsub?.();
  } catch {}
  S.maintenanceUnsub = null;
}
function startMaintenanceLive() {
  if (!S.firebaseReady || !S.db || rudIsAdminRoute() || S.maintenanceUnsub) return;
  stopMaintenanceLive();
  S.maintenanceUnsub = onSnapshot(
    doc(S.db, COLLECTION, MAINTENANCE_DOC_ID),
    (snap) => {
      const cfg = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      if (cfg) {
        const idx = S.publicContent.findIndex(
          (x) => x?.id === MAINTENANCE_DOC_ID || (x?.type === 'site' && x?.siteKey === 'maintenance'),
        );
        if (idx >= 0) S.publicContent[idx] = cfg;
        else if (cfg.published === true) S.publicContent.push(cfg);
        window.RUD_PUBLIC_CONTENT = S.publicContent;
        cachePublicContent(S.publicContent);
      }
      syncMaintenanceConfig(cfg);
    },
    (e) => {
      console.warn('Maintenance live sync unavailable.', e);
      S.maintenanceUnsub = null;
      syncMaintenanceFromContent(S.publicContent);
      if (!rudIsAdminRoute() && S.firebaseReady && S.db) {
        setTimeout(() => {
          try {
            startMaintenanceLive();
          } catch {}
        }, 5000);
      }
    },
  );
}
function ensureMaintenanceShell() {
  let root = document.getElementById('rudMaintenanceApp');
  if (root) return root;
  root = document.createElement('main');
  root.id = 'rudMaintenanceApp';
  root.hidden = true;
  root.innerHTML = `<section class="rud-maintenance-page"><div class="rud-maintenance-card"><div class="rud-maintenance-mark" aria-hidden="true">☾</div><span class="eyebrow">RISE UPON DEEN</span><h1>We'll Be Back Soon</h1><p id="rudMaintenanceMessage">Rise Upon Deen is currently under maintenance.</p><div class="rud-maintenance-until" id="rudMaintenanceUntil"></div><div class="rud-maintenance-count" id="rudMaintenanceCountdown">00:00:00</div><small>Time remaining</small><div class="rud-maintenance-quote" id="rudMaintenanceQuote">A short pause. A better return, in sha Allah.</div></div></section>`;
  /* The Makkah background. The page relied on the site-wide .global-mecca-bg scene, but while
     maintenance is active every other <body> child (including the React root that holds that scene)
     is display:none, so the screen showed a plain gradient (dark) or a mispositioned gradient Kaaba
     drawn over the card (light). The same scene markup is now placed inside the maintenance page. */
  const scene = document.querySelector('.global-mecca-bg');
  if (scene) {
    const copy = scene.cloneNode(true);
    copy.classList.add('rud-maintenance-mecca');
    root.prepend(copy);
  }
  document.body.appendChild(root);
  return root;
}
function formatMaintenanceRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400),
    h = Math.floor((total % 86400) / 3600),
    m = Math.floor((total % 3600) / 60),
    sec = total % 60;
  const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return d ? `${String(d).padStart(2, '0')}d ${clock}` : clock;
}
function hideMaintenance() {
  clearInterval(maintenanceTimer);
  maintenanceTimer = null;
  window.RUD_MAINTENANCE_ACTIVE = false;
  delete document.documentElement.dataset.maintenance;
  document.body.classList.remove('rud-maintenance-active');
  const root = document.getElementById('rudMaintenanceApp');
  if (root) root.hidden = true;
  if (rudIsAdminRoute()) return;
  $('#adminApp').hidden = true;
  try {
    rudStartBroadcastListener();
  } catch {}
  // Never force the public home shell visible while another route is active.
  const route = (location.hash || '#home').slice(1).split('/')[0];
  if (
    route === 'deen-friends' ||
    route === 'quran' ||
    route === 'prayer' ||
    route === 'tasbih' ||
    route === 'my-deen' ||
    route === 'tracker' ||
    route === 'sadaqah' ||
    route === 'umrah' ||
    route === 'hajj' ||
    route === 'heart' ||
    route === 'article' ||
    route === 'hadith' ||
    route === 'dua' ||
    route === 'reminder' ||
    route === 'name' ||
    route === 'names' ||
    route === 'duas' ||
    route === 'reminders' ||
    route === 'about'
  )
    return;
  publicMain.hidden = false;
  publicFooter.hidden = false;
}
function showMaintenance(cfg) {
  const root = ensureMaintenanceShell();
  window.RUD_MAINTENANCE_ACTIVE = true;
  document.documentElement.dataset.maintenance = 'active';
  document.body.classList.add('rud-maintenance-active');
  try {
    rudStopBroadcastListener();
    rudHideBroadcast(false);
  } catch {}
  publicMain.hidden = true;
  publicFooter.hidden = true;
  $('#dynamicPage').hidden = true;
  closeLayer?.('searchOverlay');
  $('#adminApp').hidden = true;
  root.hidden = false;
  const endMs = maintenanceEndMs(cfg);
  const msg = document.getElementById('rudMaintenanceMessage');
  const until = document.getElementById('rudMaintenanceUntil');
  if (msg)
    msg.textContent =
      String(cfg?.maintenanceMessage || '').trim() || 'Rise Upon Deen is currently being improved for you.';
  if (until && endMs) {
    const end = new Date(endMs);
    until.textContent = `Expected back ${new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(end)}`;
  }
  const tick = () => {
    const remaining = endMs - Date.now();
    if (remaining <= 0) {
      hideMaintenance();
      try {
        handleRoute();
      } catch {}
      return;
    }
    const el = document.getElementById('rudMaintenanceCountdown');
    if (el) el.textContent = formatMaintenanceRemaining(remaining);
    const quote = document.getElementById('rudMaintenanceQuote');
    if (quote) {
      const hours = remaining / 3600000;
      quote.textContent =
        hours > 24
          ? 'A thoughtful pause today for a better return, in sha Allah.'
          : hours > 1
            ? 'A short pause for improvement. We will return soon, in sha Allah.'
            : 'Almost there. Thank you for your patience — we will be back shortly, in sha Allah.';
    }
  };
  tick();
  clearInterval(maintenanceTimer);
  maintenanceTimer = setInterval(tick, 1000);
}
function syncMaintenanceFromContent(items = S.publicContent) {
  if (rudIsAdminRoute()) return;
  syncMaintenanceConfig(maintenanceConfigFrom(items));
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  /* ==============================
   ZIKR + MAINTENANCE DATA
   Uses the existing Firestore content collection so the current auth/rules
   architecture remains unchanged.
================================ */
  MAINTENANCE_DOC_ID = 'rud_maintenance_config';
  maintenanceTimer = null;
  window.RUD_MAINTENANCE_ACTIVE = document.documentElement.dataset.maintenance === 'active';
  window.RUD_getPublishedZikr = () =>
    S.publicContent
      .filter((x) => x && x.type === 'zikr' && x.published === true)
      .sort(
        (a, b) =>
          (Number(a.displayOrder) || 9999) - (Number(b.displayOrder) || 9999) ||
          millis(a.createdAt) - millis(b.createdAt),
      )
      .map((x) => ({
        id: x.id,
        title: x.title || x.transliteration || 'Zikr',
        ar: x.arabic || '',
        tr: x.transliteration || x.title || '',
        meaning: x.meaning || '',
        reference: x.reference || '',
        recommendedCount: x.recommendedCount ?? null,
        category: x.category || 'General',
        displayOrder: Number(x.displayOrder) || 9999,
      }));
}

export {
  MAINTENANCE_DOC_ID,
  maintenanceUserAllowed,
  formatMaintenanceRemaining,
  hideMaintenance,
  maintenanceConfigFrom,
  maintenanceEndMs,
  maintenanceIsActive,
  showMaintenance,
  startMaintenanceLive,
  stopMaintenanceLive,
  syncMaintenanceFromContent,
};
