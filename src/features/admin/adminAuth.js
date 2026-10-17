/**
 * Admin console sign-in form and sign-out.
 *
 * Sign-in uses the existing Firebase Authentication account (no separate mechanism). Only the
 * configured administrator account is accepted; the router then verifies the ID token before the
 * console is shown, and firestore.rules remain the real authority over every read and write.
 * Sign-out removes every administrative screen, listener and cached admin dataset at once.
 */
import { S } from '../../runtime/store';
import { clearAdminAnalyticsCache, renderAdminRoute, showAdminLogin, showLoginError } from './adminRouter';
import { clearAdminContentCache } from './adminPersistence';
import { stopMaintenanceLive } from '../maintenance/maintenance';
import { $ } from '../../runtime/core';
import { ADMIN_EMAIL } from '../../services/firebase/config';
import { configured, firebaseInitPromise } from '../../services/firebase/firebaseInit';
import { signInWithEmailAndPassword, signOut } from '../../services/firebase/sdk';
import { toast } from '../../utils/ui';

let adminLoginForm;
let signingIn = false;

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

function loginMessage(err) {
  const code = String(err?.code || '');
  if (err?.message === 'not-configured') return 'Firebase configuration is missing.';
  if (err?.message === 'firebase-unavailable') return 'Firebase could not connect. Check your internet connection and try again.';
  if (err?.message === 'unauthorized') return 'This account is not authorized for the Admin Console.';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code))
    return 'Incorrect email or password.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait a few minutes and try again.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection and try again.';
  return 'Unable to sign in. Check your connection and credentials.';
}

function setSigningIn(on) {
  const b = $('#adminLoginBtn');
  if (!b) return;
  b.disabled = on;
  b.setAttribute('aria-busy', on ? 'true' : 'false');
  b.classList.toggle('is-busy', on);
  const label = b.querySelector('span');
  if (label) label.textContent = on ? 'Signing in…' : 'Secure sign in';
  ['#adminEmail', '#adminPassword'].forEach((id) => {
    const el = $(id);
    if (el) el.readOnly = on;
  });
}

async function submitLogin(e) {
  e.preventDefault();
  if (signingIn) return; // one request at a time, even before the button re-renders
  const email = $('#adminEmail').value.trim();
  const password = $('#adminPassword').value;
  if (!email || !password) {
    showLoginError(!email ? 'Enter the administrator email address.' : 'Enter your password.');
    (!email ? $('#adminEmail') : $('#adminPassword'))?.focus();
    return;
  }
  signingIn = true;
  showLoginError('');
  setSigningIn(true);
  try {
    await login(email, password);
    $('#adminPassword').value = '';
    renderAdminRoute();
    toast('Signed in securely.');
  } catch (err) {
    console.warn('[Admin] login failed', err?.code || err?.message || err);
    const message = loginMessage(err);
    showLoginError(message);
    toast(message, 'error');
    $('#adminPassword')?.select();
  } finally {
    signingIn = false;
    setSigningIn(false);
  }
}

async function logout() {
  const btn = $('#adminLogoutBtn');
  if (!S.auth || btn?.disabled) return;
  if (btn) btn.disabled = true;
  try {
    stopMaintenanceLive();
    S.adminContent = [];
    S.editingId = null;
    S.currentAdminView = 'names';
    try {
      sessionStorage.removeItem('rud_admin_view_v1');
    } catch {}
    clearAdminContentCache();
    clearAdminAnalyticsCache();
    // Remove every admin screen first, so nothing stays visible while sign-out completes.
    showAdminLogin();
    await signOut(S.auth);
    toast('Signed out securely.');
  } catch {
    toast('Unable to sign out. Close this tab to end the session.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  adminLoginForm = $('#adminLoginForm');
  if (adminLoginForm && !adminLoginForm.dataset.bound) {
    adminLoginForm.dataset.bound = '1';
    adminLoginForm.addEventListener('submit', submitLogin);
    ['#adminEmail', '#adminPassword'].forEach((id) => $(id)?.addEventListener('input', () => showLoginError('')));
  }
  const out = $('#adminLogoutBtn');
  if (out && !out.dataset.bound) {
    out.dataset.bound = '1';
    out.addEventListener('click', logout);
  }
  /* (the Firebase Auth state listener lives in services/firebase/authListener.js) */
}
