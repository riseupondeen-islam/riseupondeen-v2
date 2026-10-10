/**
 * Public side of admin broadcasts: realtime listener, audience matching, full-screen overlay and receipts.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import {
  rudAnalyticsSessionId,
  rudCurrentRoute,
  rudDeviceType,
  rudDisplayMode,
  rudIsInstalledApp,
  rudSessionId,
  rudVisitorId,
} from '../analytics/visitorAnalytics';
import { legacyDocumentLoading, onLegacyDomContentLoaded } from '../../runtime/lifecycle';
import { ADMIN_EMAIL } from '../../services/firebase/config';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from '../../services/firebase/sdk';

let RUD_BROADCAST_COLLECTION, rudBroadcastUnsub, rudCurrentBroadcast;

function rudIsAdminBroadcastSession() {
  try {
    if (location.hash.startsWith('#riseupondeen.admin.login.1722')) return true;
    const email = String(S.auth?.currentUser?.email || '').toLowerCase();
    return !!email && email === String(ADMIN_EMAIL || '').toLowerCase();
  } catch {
    return false;
  }
}
function rudBroadcastAudienceMatches(message) {
  if (rudIsAdminBroadcastSession()) return false;

  const target = String(message?.audience || 'all');
  const visitorId = (() => {
    try {
      return rudVisitorId();
    } catch {
      return '';
    }
  })();

  if (target === 'single') {
    return !!visitorId && visitorId === String(message?.targetVisitorId || '');
  }
  if (target === 'app') return rudIsInstalledApp() || rudDisplayMode() !== 'browser';
  if (target === 'browser') return rudDisplayMode() === 'browser';
  return true;
}
async function rudTrackBroadcastEvent(message, eventType) {
  if (!S.firebaseReady || !S.db || !message?.id) return;
  try {
    const visitorId = rudVisitorId();
    const sessionId = rudAnalyticsSessionId || rudSessionId();
    const key = `${message.id}_${visitorId}_${eventType}`;
    await setDoc(
      doc(S.db, 'broadcast_receipts', key),
      {
        broadcastId: message.id,
        visitorId,
        visitorName: (() => {
          try {
            return (localStorage.getItem('rud_visitor_name') || '').slice(0, 50);
          } catch {
            return '';
          }
        })(),
        visitorNameKey: (() => {
          try {
            return (localStorage.getItem('rud_visitor_name_key') || '').slice(0, 80);
          } catch {
            return '';
          }
        })(),
        sessionId,
        eventType,
        device: rudDeviceType(),
        appMode: rudDisplayMode(),
        installedApp: rudIsInstalledApp(),
        route: rudCurrentRoute(),
        occurredAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    if (String(e?.code || '').includes('permission')) console.warn('Broadcast receipts need Firestore rules.');
  }
}
function rudBroadcastSeen(id) {
  if (!id) return true;
  try {
    return localStorage.getItem(`rud_broadcast_seen_${id}`) === '1';
  } catch {
    return false;
  }
}
function rudMarkBroadcastSeen(id) {
  if (!id) return;
  try {
    localStorage.setItem(`rud_broadcast_seen_${id}`, '1');
  } catch {}
}
function rudBroadcastMillis(v) {
  if (!v) return 0;
  try {
    if (v?.toMillis) return v.toMillis();
    if (v?.toDate) return v.toDate().getTime();
    return new Date(v).getTime() || 0;
  } catch {
    return 0;
  }
}
function rudBroadcastIsActive(message) {
  if (!message?.active || !rudBroadcastAudienceMatches(message)) return false;
  const now = Date.now(),
    start = rudBroadcastMillis(message.startsAt),
    end = rudBroadcastMillis(message.endsAt);
  if (start && start > now) return false;
  if (end && end <= now) return false;
  if (message.oncePerVisitor !== false && rudBroadcastSeen(message.id)) return false;
  return true;
}
function rudHideBroadcast(markSeen = true) {
  const overlay = document.getElementById('rudBroadcastOverlay');
  const current = rudCurrentBroadcast;
  const id = current?.id || '';
  if (markSeen && id) {
    rudMarkBroadcastSeen(id);
    rudTrackBroadcastEvent(current, 'dismissed');
  }
  rudCurrentBroadcast = null;
  document.body.classList.remove('rud-broadcast-open');
  if (!overlay) return;

  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.pointerEvents = 'none';
  overlay.style.opacity = '0';
  overlay.style.visibility = 'hidden';

  /* display:none after the fade guarantees the overlay can never
     remain over the website because of another CSS rule. */
  setTimeout(() => {
    if (!rudCurrentBroadcast) {
      overlay.style.display = 'none';
    }
  }, 420);
}
function rudShowBroadcast(message) {
  const overlay = document.getElementById('rudBroadcastOverlay');
  if (
    !overlay ||
    !message ||
    rudIsAdminBroadcastSession() ||
    window.RUD_MAINTENANCE_ACTIVE === true ||
    document.documentElement.dataset.maintenance === 'active'
  )
    return;
  rudCurrentBroadcast = message;
  overlay.style.display = 'grid';
  overlay.style.opacity = '';
  overlay.style.visibility = '';
  overlay.style.pointerEvents = '';
  document.getElementById('rudBroadcastTitle').textContent = String(message.title || 'A Reminder for You').slice(
    0,
    120,
  );
  document.getElementById('rudBroadcastMessage').textContent = String(message.message || '').slice(0, 1200);
  document.getElementById('rudBroadcastDismiss').textContent = String(message.buttonText || 'Continue').slice(0, 40);
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('rud-broadcast-open');
  rudTrackBroadcastEvent(message, 'shown');
}
function rudStopBroadcastListener() {
  if (typeof rudBroadcastUnsub === 'function') {
    try {
      rudBroadcastUnsub();
    } catch {}
  }
  rudBroadcastUnsub = null;
}
function rudStartBroadcastListener() {
  if (
    !S.firebaseReady ||
    !S.db ||
    rudBroadcastUnsub ||
    rudIsAdminBroadcastSession() ||
    window.RUD_MAINTENANCE_ACTIVE === true ||
    document.documentElement.dataset.maintenance === 'active'
  )
    return;
  rudBroadcastUnsub = onSnapshot(
    query(collection(S.db, RUD_BROADCAST_COLLECTION), where('active', '==', true)),
    (snap) => {
      if (rudIsAdminBroadcastSession()) {
        rudStopBroadcastListener();
        rudHideBroadcast(false);
        return;
      }
      const messages = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(rudBroadcastIsActive)
        .sort((a, b) => rudBroadcastMillis(b.createdAt) - rudBroadcastMillis(a.createdAt));
      if (messages[0]) rudShowBroadcast(messages[0]);
      else if (rudCurrentBroadcast) rudHideBroadcast(false);
    },
    (e) => {
      if (String(e?.code || '').includes('permission')) console.warn('Broadcast messages need Firestore rules.');
    },
  );
}
function rudBindBroadcastDismiss() {
  const btn = document.getElementById('rudBroadcastDismiss');
  if (btn && !btn.dataset.dismissBound) {
    btn.dataset.dismissBound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      rudHideBroadcast(true);
    });
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  RUD_BROADCAST_COLLECTION = 'broadcast_messages';
  rudBroadcastUnsub = null;
  rudCurrentBroadcast = null;
  if (legacyDocumentLoading()) {
    onLegacyDomContentLoaded(rudBindBroadcastDismiss);
  } else {
    rudBindBroadcastDismiss();
  }
  /* Capture fallback: guarantees Continue closes even if another handler
   prevents bubbling or the button was re-rendered. */
  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest?.('#rudBroadcastDismiss')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        rudHideBroadcast(true);
      }
    },
    true,
  );
}

export { RUD_BROADCAST_COLLECTION, rudHideBroadcast, rudStartBroadcastListener, rudStopBroadcastListener };
