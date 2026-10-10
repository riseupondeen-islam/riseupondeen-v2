/**
 * Admin console sign-in form and sign-out (only the configured admin account is accepted; Firestore rules remain the real authority).
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { renderAdminRoute } from './adminRouter';
import { stopMaintenanceLive } from '../maintenance/maintenance';
import { $ } from '../../runtime/core';
import { ADMIN_EMAIL } from '../../services/firebase/config';
import { configured, firebaseInitPromise } from '../../services/firebase/firebaseInit';
import { signInWithEmailAndPassword, signOut } from '../../services/firebase/sdk';
import { busy, toast } from '../../utils/ui';

let adminLoginForm;

/* ==============================
   AUTHENTICATION
================================ */
async function login(email, password) {
  if (!configured()) throw new Error('not-configured');
  if (!S.firebaseReady) await firebaseInitPromise;
  if (!S.firebaseReady || !S.auth) throw new Error('firebase-unavailable');
  const c = await signInWithEmailAndPassword(S.auth, email, password);
  if ((c.user.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    await signOut(S.auth);
    throw new Error('unauthorized');
  }
  return c.user;
}
/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  adminLoginForm = $('#adminLoginForm');
  if (adminLoginForm && !adminLoginForm.dataset.bound) {
    adminLoginForm.dataset.bound = '1';
    adminLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = $('#adminLoginBtn');
      if (b?.disabled) return;
      busy(b, true, 'Signing in…');
      try {
        await login($('#adminEmail').value.trim(), $('#adminPassword').value);
        toast('Login successful.');
        renderAdminRoute();
      } catch (err) {
        console.warn('[Admin] login failed', err);
        const m =
          err.message === 'not-configured'
            ? 'Firebase configuration is missing.'
            : err.message === 'firebase-unavailable'
              ? 'Firebase could not connect. Please check your internet connection and try again.'
              : err.message === 'unauthorized'
                ? 'This account is not authorized for administration.'
                : ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(err.code)
                  ? 'Incorrect email or password.'
                  : err.message || 'Unable to sign in. Check your connection and credentials.';
        toast(m, 'error');
      } finally {
        busy(b, false);
      }
    });
  }
  $('#adminLogoutBtn').addEventListener('click', async () => {
    if (!S.auth) return;
    try {
      await signOut(S.auth);
      S.adminUnsub?.();
      S.adminUnsub = null;
      stopMaintenanceLive();
      clearTimeout(S.adminScheduleTimer);
      S.adminScheduleTimer = null;
      S.adminContent = [];
      S.editingId = null;
      S.currentAdminView = 'names';
      location.hash = '#riseupondeen.admin.login.1722';
      toast('Logged out securely.');
    } catch {
      toast('Unable to log out.', 'error');
    }
  });
  /* (the Firebase Auth state listener now lives in services/firebase/authListener.js) */
}
