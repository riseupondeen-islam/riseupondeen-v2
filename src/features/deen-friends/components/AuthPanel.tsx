/* Sign in / create account, shown inside the Deen Friends page when nobody is signed in. */
import { checkUsername } from '../services/username';
import { useState, type FormEvent } from 'react';
import {
  createDeenAccount,
  createProfileForCurrentUser,
  sendDeenPasswordReset,
  signInToDeenFriends,
  signOutOfDeenFriends,
} from '../services/accountService';
import { friendlyMessage } from '../services/errors';
import { currentDeenUser } from '../services/firebaseSession';
import { setSignedIn } from '../state/deenFriendsStore';
import { Icon, useToast } from './ui';

type Mode = 'signin' | 'create';

const FEATURES = [
  { icon: 'people', title: 'Friends you choose', copy: 'Connect only with people you know, by username.' },
  { icon: 'flame', title: 'Gentle shared streaks', copy: 'Check in together and keep each other going.' },
  { icon: 'target', title: 'Deen challenges', copy: 'Qur’an, salah, dhikr — set goals and finish them together.' },
  { icon: 'shield', title: 'Private by design', copy: 'No public feed. Your worship stays yours to share.' },
] as const;

export function AuthPanel() {
  const toast = useToast();
  const orphanUser = currentDeenUser();
  const [mode, setMode] = useState<Mode>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '' });

  const update = (field: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [field]: event.target.value }));
    setError('');
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const profile = orphanUser
        ? await createProfileForCurrentUser({ displayName: form.displayName, username: form.username })
        : mode === 'signin'
          ? await signInToDeenFriends(form.email, form.password)
          : await createDeenAccount(form);
      setSignedIn(profile);
      toast(
        mode === 'signin' && !orphanUser ? 'Signed in. Welcome back.' : 'Your Deen Friends profile is ready.',
        'success',
      );
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    setError('');
    setNotice('');
    try {
      await sendDeenPasswordReset(form.email);
      setNotice('Password reset email sent. Please check your inbox.');
    } catch (err) {
      setError(friendlyMessage(err));
    }
  }

  return (
    <section className="df2-auth">
      <div className="df2-auth-intro">
        <span className="df2-kicker">RISE UPON DEEN · RISE TOGETHER</span>
        <h1 className="df2-title">Deen Friends</h1>
        <p className="df2-lead">
          A private, purpose-first space to grow in Deen with friends — encourage one another, keep gentle streaks and
          share what benefits.
        </p>
        <ul className="df2-feature-list">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="df2-feature-icon">
                <Icon name={f.icon} />
              </span>
              <span>
                <strong>{f.title}</strong>
                <small>{f.copy}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <form className="df2-card df2-auth-card" onSubmit={submit} noValidate>
        {orphanUser ? (
          <>
            <h2>Create your Deen Friends profile</h2>
            <p className="df2-muted">
              You are signed in as <strong>{orphanUser.email || 'this account'}</strong>, but it has no Deen Friends
              profile yet.
            </p>
          </>
        ) : (
          <div className="df2-segmented" role="tablist" aria-label="Account">
            {(['signin', 'create'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={mode === m ? 'active' : ''}
                onClick={() => {
                  setMode(m);
                  setError('');
                  setNotice('');
                }}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>
        )}

        {orphanUser || mode === 'create' ? (
          <>
            <label className="df2-field">
              <span>Your name</span>
              <input
                value={form.displayName}
                onChange={update('displayName')}
                maxLength={40}
                autoComplete="name"
                required
              />
            </label>
            <label className="df2-field">
              <span>Unique username</span>
              <input
                value={form.username}
                onChange={update('username')}
                maxLength={20}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                pattern="[A-Za-z0-9]{3,20}"
                aria-invalid={!!form.username && !checkUsername(form.username).ok}
                aria-describedby="df2-username-help"
                required
              />
              <small id="df2-username-help" className={form.username && !checkUsername(form.username).ok ? 'df2-field-error' : ''}>
                {form.username && !checkUsername(form.username).ok
                  ? (checkUsername(form.username) as { message: string }).message
                  : 'Friends find you by this. 3–20 English letters or numbers; capitals don’t make a different name.'}
              </small>
            </label>
          </>
        ) : null}

        {!orphanUser ? (
          <>
            <label className="df2-field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={update('email')}
                autoComplete="email"
                maxLength={160}
                required
              />
            </label>
            <label className="df2-field">
              <span>Password</span>
              <input
                type="password"
                value={form.password}
                onChange={update('password')}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={8}
                maxLength={128}
                required
              />
              {mode === 'create' ? (
                <small>At least 8 characters. Your password is never stored in our database.</small>
              ) : null}
            </label>
          </>
        ) : null}

        {error ? (
          <p className="df2-form-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p className="df2-form-notice">{notice}</p> : null}

        <button className="df2-btn df2-btn-primary df2-btn-block" type="submit" disabled={busy}>
          {busy
            ? 'Please wait…'
            : orphanUser
              ? 'Create profile'
              : mode === 'signin'
                ? 'Sign in securely'
                : 'Create secure account'}
        </button>

        {orphanUser ? (
          <button
            type="button"
            className="df2-link-btn"
            onClick={async () => {
              await signOutOfDeenFriends();
              location.reload();
            }}
          >
            Use a different account
          </button>
        ) : mode === 'signin' ? (
          <button type="button" className="df2-link-btn" onClick={forgotPassword}>
            Forgot password?
          </button>
        ) : null}
      </form>
    </section>
  );
}
