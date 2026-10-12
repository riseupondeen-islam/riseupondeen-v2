/* Admin Console root (#adminApp). Behaviour lives in features/admin (adminRouter, adminAuth, views).
 *
 * data-auth decides what is on screen, and only one pane is ever rendered visible:
 *   "checking"   → the neutral verification screen (Firebase / the saved session is still loading)
 *   "signed-out" → the login page only
 *   "authorized" → the console (set only after the signed-in token is verified as the administrator)
 * Nothing administrative is rendered into #adminMain before "authorized", and it is cleared again
 * on sign-out. Firestore rules remain the real authority over every read and write.
 *
 * The small inline style below covers the moment before the console's own stylesheet (a lazy
 * chunk) has arrived, so a direct visit never flashes the public page or unstyled admin markup. */
import { AdminLoginView } from './AdminLoginView';
import { AdminDashboardShell } from './AdminDashboardShell';

const CRITICAL_CSS = `
html:has(#adminApp:not([hidden])),html:has(#adminApp:not([hidden])) body{overflow:hidden!important;height:100%}
#adminApp:not([hidden]){position:fixed;inset:0;z-index:3500;background:#050505;color:#f3efe5}
html:has(#adminApp:not([hidden])) :is(.back-to-top,.classic-scroll-up,#rudScrollTop,#scrollProgress,.cursor-dot,.cursor-ring){display:none!important}
html.light-mode #adminApp:not([hidden]){background:#ffffff;color:#1d2621}
#adminApp[data-auth="checking"] #adminLoginView,#adminApp[data-auth="checking"] #adminDashboard,
#adminApp[data-auth="signed-out"] #adminAuthGate,#adminApp[data-auth="signed-out"] #adminDashboard,
#adminApp[data-auth="authorized"] #adminAuthGate,#adminApp[data-auth="authorized"] #adminLoginView{display:none!important}
#adminAuthGate{position:absolute;inset:0;display:grid;place-items:center;font:600 13px/1.5 Manrope,system-ui,sans-serif;letter-spacing:.02em}
#adminAuthGate .rad-gate-spin{width:28px;height:28px;margin:0 auto 12px;border-radius:50%;border:2px solid rgba(217,186,114,.25);border-top-color:#d9ba72;animation:radGateSpin .8s linear infinite}
html.light-mode #adminAuthGate .rad-gate-spin{border-color:rgba(148,112,31,.2);border-top-color:#94701f}
@keyframes radGateSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){#adminAuthGate .rad-gate-spin{animation-duration:2.4s}}
`;

function AdminAuthGate() {
  return (
    <section aria-live="polite" className="rad-gate" id="adminAuthGate" role="status">
      <div>
        <div aria-hidden="true" className="rad-gate-spin" />
        <span>Verifying secure session…</span>
      </div>
    </section>
  );
}

export function AdminApp() {
  return (
    <main className="rad-app" data-auth="checking" hidden id="adminApp">
      <style>{CRITICAL_CSS}</style>
      <AdminAuthGate />
      <AdminLoginView />
      <AdminDashboardShell />
    </main>
  );
}
