/* READ-ONLY username audit for the V3 username rules (Section 17). Writes nothing.
 *
 *   FIREBASE_SERVICE_ACCOUNT_JSON='…' node push-scheduler/scripts/auditUsernames.js > username-audit.json
 *
 * Reports, without changing any account:
 *   - legacy:     usernames that don't meet the new rule (3–20 English letters/digits). They keep
 *                 working; only NEW usernames must follow the rule. Contact these users only if you
 *                 decide to migrate, and never rename silently.
 *   - collisions: different accounts whose usernames are equal ignoring case (e.g. Ameen123/ameen123).
 *   - keyMismatch: profiles whose stored usernameKey differs from the lowercase username.
 *   - unreserved: profiles whose visitor_usernames/{usernameKey} reservation is missing or owned by
 *                 someone else.
 * Emails and other personal fields are never printed (uid + username only). */
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const RULE = /^[A-Za-z0-9]{3,20}$/;

(async () => {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
  if (!sa.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing.');
  if (!getApps().length) initializeApp({ credential: cert(sa) });
  const db = getFirestore();
  const report = { scanned: 0, legacy: [], collisions: [], keyMismatch: [], unreserved: [] };
  const byLower = new Map();
  let last = null;
  for (;;) {
    let q = db.collection('deens_users').orderBy('__name__').limit(500);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;
    for (const d of page.docs) {
      report.scanned++;
      const username = String(d.get('username') || '');
      const key = String(d.get('usernameKey') || '');
      const lower = username.toLowerCase();
      if (!RULE.test(username)) report.legacy.push({ uid: d.id, username });
      if (key && key !== lower) report.keyMismatch.push({ uid: d.id, username, usernameKey: key });
      if (!byLower.has(lower)) byLower.set(lower, []);
      byLower.get(lower).push({ uid: d.id, username });
      if (key) {
        const reservation = await db.collection('visitor_usernames').doc(key).get();
        if (!reservation.exists || reservation.get('ownerUid') !== d.id)
          report.unreserved.push({ uid: d.id, username, usernameKey: key, reservedBy: reservation.exists ? reservation.get('ownerUid') : null });
      }
    }
    last = page.docs[page.docs.length - 1];
  }
  for (const [lower, list] of byLower) if (list.length > 1) report.collisions.push({ lower, accounts: list });
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
