/* Admin › Notification Settings: which notifications members receive.
 *
 * One master switch and three category switches, stored in deens_admin_settings/notifications
 * (services/notificationSettings.ts). The free scheduler enforces them immediately before every send
 * (push-scheduler/notificationPolicy.js), so these are not UI-only controls. The page reads the
 * settings document once when opened (one Firestore read) and writes only when a switch changes.
 * Changing a switch never sends a notification. */
import { useEffect, useState } from 'react';
import { toast } from '../../../utils/ui';
import { friendlyMessage } from '../../deen-friends/services/errors';
import {
  categoryAllowed,
  readNotificationSettings,
  saveNotificationSwitch,
  type NotificationCategory,
  type NotificationSettings,
} from '../services/notificationSettings';
import { Card, ConfirmDialog, Loading, PageHead, fmtDateTime } from './ui';

type SwitchKey = 'master' | NotificationCategory;

const CATEGORIES: Array<{ key: NotificationCategory; title: string; detail: string; byDefault: string }> = [
  {
    key: 'dailyChallenge',
    title: 'Daily Deen Challenge',
    detail:
      'One notification per member when a new Daily Deen Challenge is published (never twice for the same challenge).',
    byDefault: 'On by default',
  },
  {
    key: 'prayer',
    title: 'Five daily prayer reminders',
    detail: 'Fajr, Dhuhr, Asr, Maghrib and Isha reminders at each member’s local prayer time.',
    byDefault: 'Off by default',
  },
  {
    key: 'other',
    title: 'All other notifications',
    detail:
      'Everything else: Send Notification (announcements, Qur’an, Friday, new Dua/Hadith, tests), Deen Friends requests and activity, challenge replies and “RISE replied” alerts.',
    byDefault: 'Off by default',
  },
];

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="rad-switch">
      <input
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        role="switch"
        type="checkbox"
      />
      <i aria-hidden="true" />
      {checked ? 'On' : 'Off'}
    </label>
  );
}

function StatusPill({ settings, category }: { settings: NotificationSettings; category: NotificationCategory }) {
  if (categoryAllowed(settings, category)) return <span className="rad-pill rad-pill-ok">Sending</span>;
  if (settings[category]) return <span className="rad-pill rad-pill-warn">Held · all notifications off</span>;
  return <span className="rad-pill">Not sending</span>;
}

export function NotificationSettingsAdmin() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<SwitchKey | ''>('');
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    let alive = true;
    readNotificationSettings()
      .then((s) => alive && setSettings(s))
      .catch((err) => alive && setError(friendlyMessage(err, 'Notification settings could not be loaded.')));
    return () => {
      alive = false;
    };
  }, []);

  async function change(key: SwitchKey, enabled: boolean) {
    if (!settings || busy) return;
    const previous = settings;
    setBusy(key);
    setError('');
    setSettings({ ...previous, [key]: enabled }); // the switch moves at once; reverted if saving fails
    try {
      const next = await saveNotificationSwitch(previous, key, enabled);
      setSettings(next);
      const name = key === 'master' ? 'All user notifications' : CATEGORIES.find((c) => c.key === key)?.title;
      toast(`${name} turned ${enabled ? 'on' : 'off'}. Nothing was sent.`);
    } catch (err) {
      setSettings(previous);
      setError(friendlyMessage(err, 'The setting could not be saved. Nothing was changed.'));
    } finally {
      setBusy('');
      setConfirmOff(false);
    }
  }

  return (
    <div className="rad-notification-settings">
      <PageHead
        kicker="Communication"
        title="Notification Settings"
        description="Choose which notifications members receive. The scheduler checks these switches immediately before every send; members’ own notification choices and device permission are always respected."
      />
      {error ? (
        <div className="rad-alert rad-alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {!settings ? (
        error ? null : (
          <Loading>Loading notification settings…</Loading>
        )
      ) : (
        <>
          <Card
            title="All user notifications"
            subtitle="Master switch. While it is off nothing is sent to members — no category can bypass it. Turning it back on resumes only the categories that are on below."
            actions={
              <Switch
                checked={settings.master}
                disabled={!!busy}
                label="All user notifications"
                onChange={(next) => (next ? void change('master', true) : setConfirmOff(true))}
              />
            }
          >
            {!settings.master ? (
              <div className="rad-alert rad-alert-warn" role="status">
                All user notifications are off. No member receives any notification until this is turned back on.
              </div>
            ) : null}
          </Card>

          <Card
            title="Categories"
            subtitle="Each category is independent. A category sends only while the master switch is on."
          >
            <div className="rad-list">
              {CATEGORIES.map((c) => (
                <div
                  className={`rad-list-item${categoryAllowed(settings, c.key) ? '' : ' is-muted'}`}
                  data-notification-category={c.key}
                  key={c.key}
                >
                  <div className="rad-list-main">
                    <strong>{c.title}</strong>
                    <small>{c.detail}</small>
                    <span className="rad-meta">
                      <StatusPill category={c.key} settings={settings} />
                      <span>{c.byDefault}</span>
                    </span>
                  </div>
                  <Switch
                    checked={settings[c.key]}
                    disabled={!!busy}
                    label={c.title}
                    onChange={(next) => void change(c.key, next)}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card title="How changes apply">
            <div className="rad-list">
              <div className="rad-list-item">
                <div className="rad-list-main">
                  <strong>Takes effect on the next scheduler run</strong>
                  <small>
                    The free scheduler runs about every 5 minutes. A run that is already sending re-checks these
                    switches within 30 seconds. Notifications that become due while their category is off are cancelled,
                    not saved for later, so turning a category back on never releases a backlog.
                  </small>
                </div>
              </div>
              <div className="rad-list-item">
                <div className="rad-list-main">
                  <strong>Last changed</strong>
                  <small>
                    {settings.isDefault
                      ? 'Never changed — the defaults apply (Daily Deen Challenge on, everything else off).'
                      : `${fmtDateTime(settings.updatedAtMs)}${settings.updatedByEmail ? ` by ${settings.updatedByEmail}` : ''}`}
                  </small>
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
      {confirmOff ? (
        <ConfirmDialog
          busy={busy === 'master'}
          busyLabel="Turning off…"
          confirmLabel="Turn off all notifications"
          danger
          onCancel={() => setConfirmOff(false)}
          onConfirm={() => void change('master', false)}
          title="Turn off all user notifications?"
        >
          <p>
            No member will receive any notification — including the Daily Deen Challenge — until you turn this back on.
            Your category choices are kept.
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
