/* Admin › Notification Settings — the switches every notification sender obeys.
 *
 *   deens_admin_settings/notifications
 *   { masterEnabled, dailyChallengeEnabled, prayerEnabled, otherEnabled, updatedAtMs, updatedBy, updatedByEmail }
 *
 * The trusted scheduler (push-scheduler/notificationPolicy.js) is the authority: it reads this document
 * and checks it immediately before every send. The rules below mirror it so the console shows exactly
 * what the scheduler will do — keep the two in step:
 *   - masterEnabled false → nothing is sent, whatever the categories say.
 *   - Daily Deen Challenge → on unless explicitly false (the existing workflow stays on by default).
 *   - Prayer reminders and every other notification → off unless explicitly true.
 *   - A missing document means these defaults; a document that cannot be read means nothing is sent.
 * firestore.rules let only the Super Admin write deens_admin_settings; members can neither read nor
 * change it. Saving a switch never sends anything by itself. */
import { doc, getDoc, setDoc } from '../../../services/firebase/sdk';
import { currentDeenUser, requireSignedIn } from '../../deen-friends/services/firebaseSession';

export type NotificationCategory = 'dailyChallenge' | 'prayer' | 'other';

export interface NotificationSettings {
  master: boolean;
  dailyChallenge: boolean;
  prayer: boolean;
  other: boolean;
  /** True when the document does not exist yet (the defaults apply). */
  isDefault: boolean;
  updatedAtMs: number;
  updatedByEmail: string;
}

const PATH = ['deens_admin_settings', 'notifications'] as const;
const FIELD: Record<'master' | NotificationCategory, string> = {
  master: 'masterEnabled',
  dailyChallenge: 'dailyChallengeEnabled',
  prayer: 'prayerEnabled',
  other: 'otherEnabled',
};

export function resolveSettings(data: Record<string, unknown> | null): NotificationSettings {
  const d = data || {};
  return {
    master: d.masterEnabled !== false,
    dailyChallenge: d.dailyChallengeEnabled !== false,
    prayer: d.prayerEnabled === true,
    other: d.otherEnabled === true,
    isDefault: !data,
    updatedAtMs: Number(d.updatedAtMs) || 0,
    updatedByEmail: typeof d.updatedByEmail === 'string' ? d.updatedByEmail : '',
  };
}

/** Whether the scheduler will deliver this category (master AND category on). */
export function categoryAllowed(s: NotificationSettings | null, category: NotificationCategory): boolean {
  return !!s && s.master && s[category] === true;
}

export async function readNotificationSettings(): Promise<NotificationSettings> {
  const { db } = await requireSignedIn();
  const snap = await getDoc(doc(db, PATH[0], PATH[1]));
  return resolveSettings(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
}

/** Saves one switch. All four switches are written so the stored document is always explicit. */
export async function saveNotificationSwitch(
  current: NotificationSettings,
  key: 'master' | NotificationCategory,
  enabled: boolean,
): Promise<NotificationSettings> {
  const { db, uid } = await requireSignedIn();
  const next = { ...current, [key]: enabled };
  const updatedAtMs = Date.now();
  const updatedByEmail = currentDeenUser()?.email || '';
  await setDoc(
    doc(db, PATH[0], PATH[1]),
    {
      [FIELD.master]: next.master,
      [FIELD.dailyChallenge]: next.dailyChallenge,
      [FIELD.prayer]: next.prayer,
      [FIELD.other]: next.other,
      updatedBy: uid,
      updatedByEmail,
      updatedAtMs,
    },
    { merge: true },
  );
  return { ...next, isDefault: false, updatedAtMs, updatedByEmail };
}
