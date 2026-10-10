/* Deen Friends notification settings: explains the benefit first, asks for permission only after a
 * tap, handles every permission state, and lets the user choose which Deen Friends events notify them.
 * Permission and the device token are managed by the app-wide push module (one service worker, one
 * token); this screen only adds the Deen Friends preferences. */
import { useState, type MouseEvent } from 'react';
import { rudEnableDeenReminders, rudPushCapability, rudPushPrefs } from '../../notifications/pushNotifications';
import {
  DEEN_PUSH_CATEGORY_LABELS,
  readDeenPushCategories,
  saveDeenPushCategories,
  syncDeenPushDevice,
  type DeenPushCategories,
} from '../services/pushDeviceService';
import { logError } from '../services/errors';

type State = 'unsupported' | 'install-required' | 'denied' | 'off' | 'on';

function currentState(): State {
  const capability = rudPushCapability();
  if (capability === 'unsupported') return 'unsupported';
  if (capability === 'install-required') return 'install-required';
  if (Notification.permission === 'denied') return 'denied';
  let token = '';
  try {
    token = localStorage.getItem('rud_fcm_token_v2') || '';
  } catch {
    token = '';
  }
  return Notification.permission === 'granted' && rudPushPrefs().enabled && token ? 'on' : 'off';
}

const MESSAGES: Record<State, string> = {
  unsupported: 'This browser cannot receive notifications. Try Chrome, Edge or Firefox, or install the app.',
  'install-required':
    'On iPhone and iPad, add Rise Upon Deen to your Home Screen (Share → Add to Home Screen), open it from there, then turn notifications on.',
  denied:
    'Notifications are blocked for this site. You can allow them again in your browser or phone settings — we won’t ask again automatically.',
  off: 'Get a gentle alert when a friend sends a request or a challenge, and when RISE replies. We only ask your browser after you tap the button.',
  on: 'Notifications are on for this device. Choose what Deen Friends may notify you about:',
};

export function NotificationSettings() {
  const [state, setState] = useState<State>(() => currentState());
  const [categories, setCategories] = useState<DeenPushCategories>(() => readDeenPushCategories());

  async function enable(event: MouseEvent<HTMLButtonElement>) {
    await rudEnableDeenReminders(event.currentTarget);
    const next = currentState();
    setState(next);
    if (next === 'on') void syncDeenPushDevice().catch((e) => logError('push device sync', e));
  }

  function toggle(key: keyof DeenPushCategories, value: boolean) {
    const next = { ...categories, [key]: value };
    setCategories(next);
    saveDeenPushCategories(next);
    void syncDeenPushDevice().catch((e) => logError('push preference sync', e));
  }

  return (
    <div className="df2-subcard" aria-live="polite">
      <p className="df2-muted">{MESSAGES[state]}</p>
      {state === 'off' ? (
        <button type="button" className="df2-btn df2-btn-primary df2-btn-sm" onClick={enable}>
          Turn on notifications
        </button>
      ) : null}
      {state === 'on'
        ? DEEN_PUSH_CATEGORY_LABELS.map(([key, label, hint]) => (
            <label key={key} className="df2-toggle">
              <input type="checkbox" checked={categories[key]} onChange={(e) => toggle(key, e.target.checked)} />
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
            </label>
          ))
        : null}
      <p className="df2-footnote">Notifications never include the content of your conversations.</p>
    </div>
  );
}
