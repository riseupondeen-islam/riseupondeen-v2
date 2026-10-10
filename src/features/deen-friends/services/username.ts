/* Username rules (Section 17) — one definition for registration, profile edits, username-change
 * requests and the admin console. Mirrored by firestore.rules (validNewUsername).
 *
 *   - English letters A–Z / a–z and digits 0–9 only (no spaces, symbols or punctuation)
 *   - 3 to 20 characters
 *   - unique without regard to case: "Ameen123" and "ameen123" are the same name. The lowercase form
 *     is the key reserved in visitor_usernames/{key} inside the account-creation transaction, so two
 *     people can never claim it at the same moment.
 *
 * Existing accounts whose usernames predate these rules keep them (nothing is renamed silently);
 * the rules apply to new usernames. See push-scheduler/scripts/auditUsernames.js for the audit. */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_PATTERN = /^[A-Za-z0-9]{3,20}$/;

export type UsernameCheck = { ok: true; username: string; key: string } | { ok: false; message: string };

export function checkUsername(raw: string): UsernameCheck {
  const value = String(raw ?? '').replace(/^@+/, '');
  if (!value.trim()) return { ok: false, message: 'Choose a username.' };
  if (/\s/.test(value)) return { ok: false, message: 'Usernames can’t contain spaces.' };
  if (/[^\x00-\x7F]/.test(value) || /[^A-Za-z0-9]/.test(value))
    return { ok: false, message: 'Use only English letters (A–Z) and numbers (0–9) — no symbols, punctuation or underscores.' };
  if (value.length < USERNAME_MIN) return { ok: false, message: `Use at least ${USERNAME_MIN} characters.` };
  if (value.length > USERNAME_MAX) return { ok: false, message: `Use at most ${USERNAME_MAX} characters.` };
  return { ok: true, username: value, key: value.toLowerCase() };
}
