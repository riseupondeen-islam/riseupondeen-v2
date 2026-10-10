/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */
import brandLogoUrl from '../../../assets/images/brand-logo.png';

export function AdminLoginView() {
  return (
    <section className="admin-login" id="adminLoginView">
      <form className="admin-login-card glass" id="adminLoginForm">
        <div className="brand">
          <img
            alt="AK Islamic logo — Rise Upon Deen"
            className="brand-logo"
            decoding="async"
            height="128"
            src={brandLogoUrl}
            width="128"
          />
          <span>{'RISE UPON DEEN'}</span>
        </div>
        <h1>{'Content Administration'}</h1>
        <p>{'Secure access for the single authorized administrator.'}</p>
        <div className="config-note" hidden id="firebaseConfigNote">
          {
            'Firebase configuration is loading. If this message remains, check your internet connection and Firebase project settings.'
          }
        </div>
        <div className="field">
          <label htmlFor="adminEmail">{'Email'}</label>
          <input autoComplete="username" className="input" id="adminEmail" required type="email" />
        </div>
        <div className="field">
          <label htmlFor="adminPassword">{'Password'}</label>
          <input autoComplete="current-password" className="input" id="adminPassword" required type="password" />
        </div>
        <button className="premium-btn primary" id="adminLoginBtn" style={{ width: '100%' }} type="submit">
          {'Secure Login'}
        </button>
        <a className="premium-btn" href="#home" style={{ width: '100%', marginTop: '10px' }}>
          {'Return to Website'}
        </a>
      </form>
    </section>
  );
}
