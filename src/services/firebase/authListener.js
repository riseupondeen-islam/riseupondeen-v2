/* Firebase Auth state listener — attached once Firebase is ready, for every visitor.
 * Moved out of the admin console module so the console can be loaded on demand: on public routes
 * it only (re)starts the admin broadcast listener; the admin views are touched only when the
 * visitor is on the admin route (where the console is already being loaded).
 */
import { S } from '../../runtime/store';
import { rudIsAdminRoute } from '../../app/routing/routeState';
import { showAdminDashboard, showAdminLogin } from '../../features/admin/adminLoader';
import {
  rudHideBroadcast,
  rudStartBroadcastListener,
  rudStopBroadcastListener,
} from '../../features/broadcast/broadcast';
import { $ } from '../../runtime/core';
import { ADMIN_EMAIL } from './config';
import { onAuthStateChanged, signOut } from './sdk';

let rudAuthListenerAttached = false;

function rudAttachAuthListener() {
  if (rudAuthListenerAttached || !S.firebaseReady || !S.auth || !onAuthStateChanged) return;
  rudAuthListenerAttached = true;
  onAuthStateChanged(S.auth, async (u) => {
    const ok = u && (u.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();

    if (ok) {
      try {
        rudStopBroadcastListener();
        rudHideBroadcast(false);
      } catch {}
    } else if (!rudIsAdminRoute()) {
      try {
        rudStartBroadcastListener();
      } catch {}
    }

    /* Anonymous Firebase identity is used by public features such as the
     globally unique visitor-name reservation. Do not sign it out. Only a
     signed-in non-admin account must be rejected here. */
    if (u && !ok && u.isAnonymous === false && rudIsAdminRoute()) {
      await signOut(S.auth);
      showAdminLogin();
      return;
    }
    if (ok) {
      $('#adminUserEmail').textContent = u.email;
      if (rudIsAdminRoute()) showAdminDashboard();
    } else if (rudIsAdminRoute()) showAdminLogin();
  });
}

export { rudAttachAuthListener };
