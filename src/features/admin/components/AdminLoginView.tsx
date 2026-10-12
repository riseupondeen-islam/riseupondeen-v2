/* Admin Console sign-in page (#adminLoginView). The submit handler lives in features/admin/adminAuth.js;
   it signs in with the existing Firebase account, then the router verifies the administrator before
   anything else is shown. Element ids are the contract with that controller. */
import brandLogoUrl from '../../../assets/images/brand-logo.png';
import { AdminIcon } from './AdminIcon';
import { AdminThemeToggle } from './AdminThemeToggle';

export function AdminLoginView() {
  return (
    <section aria-labelledby="adminLoginTitle" className="admin-login rad-login" id="adminLoginView">
      <div className="rad-login-top">
        <a className="rad-link-btn" href="#home">
          ← Back to website
        </a>
        <AdminThemeToggle id="adminLoginThemeToggle" />
      </div>
      <form className="admin-login-card rad-login-card" id="adminLoginForm" noValidate>
        <div className="rad-login-brand">
          <img alt="" className="rad-login-logo" decoding="async" height="56" src={brandLogoUrl} width="56" />
          <div>
            <span className="rad-kicker">Rise Upon Deen</span>
            <h1 id="adminLoginTitle">Admin Console</h1>
          </div>
        </div>
        <p className="rad-login-lead">Sign in with the authorized administrator account.</p>
        <div className="config-note rad-alert rad-alert-warn" hidden id="firebaseConfigNote">
          Firebase is still loading. If this message stays, check your internet connection.
        </div>
        <div aria-live="assertive" className="rad-alert rad-alert-error" hidden id="adminLoginError" role="alert" />
        <div className="rad-field">
          <label htmlFor="adminEmail">Email</label>
          <input
            autoComplete="username"
            className="rad-input"
            id="adminEmail"
            inputMode="email"
            required
            spellCheck={false}
            type="email"
          />
        </div>
        <div className="rad-field">
          <label htmlFor="adminPassword">Password</label>
          <div className="rad-input-wrap">
            <input autoComplete="current-password" className="rad-input" id="adminPassword" required type="password" />
            <button
              aria-controls="adminPassword"
              aria-label="Show password"
              aria-pressed="false"
              className="rad-input-affix"
              id="adminPasswordToggle"
              type="button"
            >
              <AdminIcon name="eye" size={17} />
            </button>
          </div>
        </div>
        <button className="rad-btn rad-btn-primary rad-btn-block" id="adminLoginBtn" type="submit">
          <AdminIcon name="lock" size={16} />
          <span>Secure sign in</span>
        </button>
        <p className="rad-login-foot">
          <AdminIcon name="shield" size={14} /> Access is verified on every request by Firebase security rules.
        </p>
      </form>
    </section>
  );
}
