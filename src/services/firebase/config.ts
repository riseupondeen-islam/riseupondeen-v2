/* Firebase web configuration for the existing "riseupondeen" project.
   These values are the same public client identifiers the original index.html shipped
   (they are not secrets — access is enforced by Firestore/Storage security rules).
   public/sw.js carries the same values for background push messages. */
export const firebaseConfig = {
  apiKey: 'AIzaSyBZPyFOJzSz3av4LgzaysGoebANTE7AgW0',
  authDomain: 'riseupondeen.firebaseapp.com',
  projectId: 'riseupondeen',
  storageBucket: 'riseupondeen.firebasestorage.app',
  messagingSenderId: '1040242494871',
  appId: '1:1040242494871:web:ab5b758e64a4e430b288d2',
  measurementId: 'G-E3W4MGY8G7',
} as const;

/** The single administrator account (UI gate only — Firestore rules are the real authority). */
export const ADMIN_EMAIL = 'riseupondeen@gmail.com';

export const SOCIAL_LINKS: Record<'instagram' | 'youtube' | 'facebook', string> = {
  instagram: '',
  youtube: '',
  facebook: '',
};
