/* Entry point that connects Deen Friends to the rest of the app.
 *
 * - The hash router calls window.rudRenderDeenFriends() for every #deen-friends… URL. The React page
 *   is mounted once; moving between its sections (#deen-friends/chat/<id>, …) does not remount it.
 * - window.RUD_DEEN_FRIENDS keeps the small API other modules use (Tasbih hand-off, router cleanup).
 * - The session (and the navbar badge listeners) start at boot for signed-in users, except on the
 *   admin route.
 *
 * Sub-routes:  #deen-friends                (Friends)
 *              #deen-friends/streaks | /chats | /challenges | /rise
 *              #deen-friends/chat/<friendshipId>
 */
import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import { showReactPage } from '../../app/routing/surfaces';
import { hasReactPage } from '../../app/pages/reactPageOutlet';
import { rudIsAdminRoute } from '../../app/routing/routeState';
import { getDeenFriendsState, startSession } from './state/deenFriendsStore';
import { completeChallenge } from './services/interactionService';
import { completeDailyChallengeToday, readDailyChallenge } from './services/dailyChallengeService';
import { requireSignedIn } from './services/firebaseSession';
import { rudDfPasswordReset } from './services/accountService';
import { doc, getDoc } from '../../services/firebase/sdk';
import { watchPushTokenChanges } from './services/pushDeviceService';

const DeenFriendsPage = lazy(() => import('./DeenFriendsPage'));

export type DeenFriendsTab = 'friends' | 'streaks' | 'chats' | 'challenges' | 'rise';

export interface DeenFriendsRoute {
  tab: DeenFriendsTab;
  chatId: string;
}

export function parseDeenFriendsHash(hash = location.hash): DeenFriendsRoute {
  const parts = hash.replace(/^#/, '').split('/');
  if (parts[0] !== 'deen-friends') return { tab: 'friends', chatId: '' };
  if (parts[1] === 'chat' && parts[2]) return { tab: 'chats', chatId: decodeURIComponent(parts[2]) };
  const tab = (['streaks', 'chats', 'challenges', 'rise'] as const).find((t) => t === parts[1]);
  return { tab: tab || 'friends', chatId: '' };
}

export function deenFriendsHref(route: Partial<DeenFriendsRoute>): string {
  if (route.chatId) return `#deen-friends/chat/${encodeURIComponent(route.chatId)}`;
  return !route.tab || route.tab === 'friends' ? '#deen-friends' : `#deen-friends/${route.tab}`;
}

/* The page reads the current sub-route through this tiny store (updated on every DF hash change). */
let currentRoute = parseDeenFriendsHash();
const routeListeners = new Set<() => void>();
function publishRoute() {
  const next = parseDeenFriendsHash();
  if (next.tab === currentRoute.tab && next.chatId === currentRoute.chatId) return;
  currentRoute = next;
  routeListeners.forEach((l) => l());
}
export function useDeenFriendsRoute(): DeenFriendsRoute {
  return useSyncExternalStore(
    (l) => {
      routeListeners.add(l);
      return () => routeListeners.delete(l);
    },
    () => currentRoute,
    () => currentRoute,
  );
}

/* True while a conversation was opened by pushing a history entry from inside Deen Friends, so
   closing it can simply go back (and the phone's Back button closes it the same way). */
let conversationPushed = false;

/** Navigates within Deen Friends. `replace` avoids stacking history entries (e.g. switching tabs). */
export function goToDeenFriends(route: Partial<DeenFriendsRoute>, replace = false): void {
  const href = deenFriendsHref(route);
  if (location.hash === href) return;
  conversationPushed =
    !replace && (!!route.chatId || route.tab === 'rise') && location.hash.startsWith('#deen-friends');
  if (replace) {
    history.replaceState(history.state || {}, '', location.pathname + location.search + href);
    publishRoute();
  } else {
    location.hash = href;
  }
}

/** Closes the open conversation (friend chat or RISE). */
export function leaveConversation(): void {
  if (conversationPushed) {
    conversationPushed = false;
    history.back();
  } else {
    goToDeenFriends({ tab: 'chats' }, true);
  }
}

/* ---------- mounting ---------- */

let mountedPages = 0;

function PageLoading() {
  return (
    <section className="df2-root df2-route-loading" aria-live="polite">
      <div className="df2-route-loading-card">
        <span className="df2-kicker">RISE UPON DEEN · DEEN FRIENDS</span>
        <strong>Opening Deen Friends…</strong>
        <span>Preparing your private space.</span>
      </div>
    </section>
  );
}

function MountedDeenFriends() {
  useEffect(() => {
    mountedPages += 1;
    return () => {
      mountedPages -= 1;
    };
  }, []);
  return (
    <Suspense fallback={<PageLoading />}>
      <DeenFriendsPage />
    </Suspense>
  );
}

export function renderDeenFriends(): void {
  publishRoute();
  // Already on screen: the page re-renders from the route store; remounting would flash and lose state.
  if (
    mountedPages > 0 &&
    hasReactPage() &&
    document.querySelector('#dynamicPage .df2-page, #dynamicPage .df2-route-loading')
  )
    return;
  showReactPage(<MountedDeenFriends />, 'Deen Friends | Rise Upon Deen');
}

/* ---------- Tasbih hand-off (features/tasbih/tasbih.js) ---------- */

interface TasbihChallengeContext {
  /** 'friend' (default, V1 contexts have no kind) or 'daily'. */
  kind?: 'friend' | 'daily';
  challengeId: string;
  friendshipId?: string;
}

async function completeFromTasbih(ctx: TasbihChallengeContext): Promise<void> {
  await startSession();
  if (getDeenFriendsState().session !== 'signed-in') throw new Error('Please sign in to Deen Friends again.');
  if (ctx.kind === 'daily') {
    const { db } = await requireSignedIn();
    const snap = await getDoc(doc(db, 'deens_daily_challenges', ctx.challengeId));
    if (!snap.exists()) throw new Error('This challenge is no longer available.');
    await completeDailyChallengeToday(readDailyChallenge(snap.id, snap.data() as Record<string, unknown>));
    return;
  }
  await completeChallenge(ctx.challengeId);
}

function returnToInteraction(friendshipId: string): void {
  location.hash = friendshipId ? deenFriendsHref({ chatId: friendshipId }) : deenFriendsHref({ tab: 'challenges' });
}

/** Called once by runtime/legacyRuntime (same slot the V1 controller used). */
export function init(): void {
  window.rudRenderDeenFriends = renderDeenFriends;
  window.rudDfPasswordReset = rudDfPasswordReset;
  window.RUD_DEEN_FRIENDS = {
    render: renderDeenFriends,
    completeFromTasbih,
    returnToInteraction,
    // The page unmounts (and stops its chat listener) when another route replaces it.
    cleanup: () => undefined,
    stopChat: () => undefined,
  };
  watchPushTokenChanges(() => getDeenFriendsState().session === 'signed-in');
  if (!rudIsAdminRoute()) void startSession();
}

declare global {
  interface Window {
    rudRenderDeenFriends?: () => void;
    rudDfPasswordReset?: (email: string) => Promise<void>;
    RUD_DEEN_FRIENDS?: {
      render: () => void;
      completeFromTasbih: (ctx: TasbihChallengeContext) => Promise<void>;
      returnToInteraction: (friendshipId: string) => void;
      cleanup: () => void;
      stopChat: () => void;
    };
  }
}
