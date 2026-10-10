/* One place that turns Firebase/JS errors into calm, specific messages for people.
 *
 * Raw SDK text ("Missing or insufficient permissions.", "Quota exceeded.") is never shown. The
 * original error is still logged to the console with its code so problems remain diagnosable. */

export type ErrorKind = 'permission' | 'auth' | 'offline' | 'quota' | 'not-found' | 'index' | 'invalid' | 'unknown';

/** An error whose message is already written for the person using the app. */
export class DeenFriendsError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = 'DeenFriendsError';
    this.kind = kind;
  }
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code.replace(/^(firestore|auth)\//, '') : '';
}

function errorText(error: unknown): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : '';
}

export function classifyError(error: unknown): ErrorKind {
  if (error instanceof DeenFriendsError) return error.kind;
  const code = errorCode(error);
  const text = errorText(error);
  // Spark-plan daily limits surface as resource-exhausted ("Quota exceeded.").
  if (code === 'resource-exhausted' || /quota/i.test(text)) return 'quota';
  if (code === 'permission-denied' || /insufficient permissions/i.test(text)) return 'permission';
  if (code === 'unauthenticated' || code === 'user-token-expired' || code === 'requires-recent-login') return 'auth';
  if (code === 'failed-precondition' && /index/i.test(text)) return 'index';
  if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'network-request-failed') return 'offline';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (code === 'not-found') return 'not-found';
  if (code === 'invalid-argument' || code === 'failed-precondition') return 'invalid';
  return 'unknown';
}

const DEFAULT_MESSAGES: Record<ErrorKind, string> = {
  permission: 'That action isn’t allowed for your account. If this keeps happening, contact RISE.',
  auth: 'Your session has ended. Please sign in again.',
  offline: 'You seem to be offline. Please check your connection and try again.',
  quota: 'Deen Friends has reached today’s free usage limit. Nothing was sent — please try again later.',
  'not-found': 'This item is no longer available.',
  index: 'This view is still being prepared on the server. Please try again in a few minutes.',
  invalid: 'Some details weren’t valid. Please check them and try again.',
  unknown: 'Something went wrong. Please try again.',
};

/** A message suitable for a toast or inline error. `fallback` replaces the generic text for unknown errors. */
export function friendlyMessage(error: unknown, fallback?: string): string {
  if (error instanceof DeenFriendsError) return error.message;
  const kind = classifyError(error);
  if (kind === 'unknown' && fallback) return fallback;
  return DEFAULT_MESSAGES[kind];
}

/** Logs the technical details once, without tokens or message bodies. */
export function logError(where: string, error: unknown): void {
  if (error instanceof DeenFriendsError) return;
  console.warn(`[Deen Friends] ${where}`, {
    kind: classifyError(error),
    code: errorCode(error),
    message: errorText(error),
  });
}

/**
 * Completions are recorded in a transaction (so streaks and points stay exact), which needs a
 * connection. Offline and clock problems get a specific explanation instead of a generic failure.
 */
export function offlineAware(error: unknown): unknown {
  if (error instanceof DeenFriendsError) return error;
  const kind = classifyError(error);
  if (kind === 'offline')
    return new DeenFriendsError('offline', 'Completing a challenge needs a connection so your streak counts the right day. Please try again when you are online.');
  if (kind === 'permission')
    return new DeenFriendsError(
      'permission',
      'This completion couldn’t be counted. If your device’s date or time is set manually, switch it to automatic and try again.',
    );
  return error;
}
