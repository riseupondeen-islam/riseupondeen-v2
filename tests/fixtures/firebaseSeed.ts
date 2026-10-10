import { TEST_CONTENT_ITEMS } from './publicContent';

/* Seed for the in-memory Firebase test double (see tests/fake-firebase/core.js). */
export const ADMIN_TEST_PASSWORD = 'admin-test-password';

type Seed = {
  collections: Record<string, Record<string, unknown>>;
  users: Array<{ email: string; password: string; uid: string }>;
};

export function firebaseSeed(): Seed {
  const content: Record<string, unknown> = {};
  for (const { id, createdAt, updatedAt, ...rest } of TEST_CONTENT_ITEMS) {
    content[id] = {
      ...rest,
      createdAt: { __ts: createdAt.seconds * 1000 },
      updatedAt: { __ts: updatedAt.seconds * 1000 },
    };
  }
  return {
    collections: { content, ...deenFriendsSeed() },
    users: [
      { email: 'riseupondeen@gmail.com', password: ADMIN_TEST_PASSWORD, uid: 'fakeadmin001' },
      { email: 'friend.one@example.com', password: 'friend-test-password', uid: 'fakeuser101' },
      { email: 'bilal@example.com', password: 'bilal-test-password', uid: 'fakeuser102' },
    ],
  };
}

/* Two Deen Friends profiles (Aisha = fakeuser101, Bilal = fakeuser102) and Daily Deen Challenges. */
export const DF_USERS = {
  aisha: { uid: 'fakeuser101', email: 'friend.one@example.com', password: 'friend-test-password', username: 'aisha', name: 'Aisha Rahman' },
  bilal: { uid: 'fakeuser102', email: 'bilal@example.com', password: 'bilal-test-password', username: 'bilal', name: 'Bilal Ahmed' },
};

function localDay(offset = 0): string {
  const d = new Date(Date.now() + offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function deenFriendsSeed(): Record<string, Record<string, unknown>> {
  const now = { __ts: Date.now() - 3600000 };
  const profile = (u: (typeof DF_USERS)['aisha'], extra: Record<string, unknown> = {}) => ({
    uid: u.uid,
    visitorId: `v_${u.username}`,
    username: u.username,
    usernameKey: u.username,
    displayName: u.name,
    email: u.email,
    avatar: u.username === 'aisha' ? 'quran' : 'lantern',
    bio: `${u.name.split(' ')[0]} is learning to read the Qur'an daily.`,
    deenFocus: 'Qur’an, Salah',
    currentFocus: '',
    favoriteSurah: 'Al-Mulk',
    languages: 'English, Urdu',
    field: '',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: Date.now() - 600000,
    ...extra,
  });
  const reservation = (u: (typeof DF_USERS)['aisha']) => ({
    visitorId: `v_${u.username}`,
    ownerUid: u.uid,
    name: u.username,
    nameKey: u.username,
    createdAt: now,
  });
  const challenge = (extra: Record<string, unknown>) => ({
    challengeType: 'daily_deen',
    description: 'Read with reflection, even a little.',
    instructions: 'Choose a quiet time after Fajr.',
    category: "Qur'an",
    activity: 'manual',
    target: 1,
    startDate: localDay(-1),
    endDate: localDay(5),
    requiredDays: 3,
    status: 'published',
    audience: 'all',
    assignedUids: [],
    createdBy: 'fakeadmin001',
    updatedBy: 'fakeadmin001',
    createdAt: now,
    updatedAt: now,
    updatedAtMs: Date.now() - 3600000,
    ...extra,
  });
  return {
    deens_users: { fakeuser101: profile(DF_USERS.aisha), fakeuser102: profile(DF_USERS.bilal) },
    visitor_usernames: { aisha: reservation(DF_USERS.aisha), bilal: reservation(DF_USERS.bilal) },
    deens_rise_threads: {
      fakeuser102: {
        uid: 'fakeuser102',
        displayName: 'Bilal Ahmed',
        username: 'bilal',
        lastMessagePreview: 'TEST: the Qur’an audio stops on my phone.',
        lastFrom: 'user',
        lastMessageAtMs: Date.now() - 1800000,
        unreadByUser: 0,
        unreadByRise: 1,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      },
    },
    'deens_rise_threads/fakeuser102/messages': {
      u_seed1: {
        from: 'user',
        senderUid: 'fakeuser102',
        text: 'TEST: the Qur’an audio stops on my phone.',
        automated: false,
        createdAt: now,
        createdAtMs: Date.now() - 1800000,
      },
    },
    deens_daily_challenges: {
      daily_all: challenge({ title: 'TEST Daily: one page of Qur’an' }),
      daily_bilal_only: challenge({ title: 'TEST Daily: for Bilal only', audience: 'selected', assignedUids: ['fakeuser102'] }),
      daily_draft: challenge({ title: 'TEST Daily: draft', status: 'draft' }),
    },
  };
}
