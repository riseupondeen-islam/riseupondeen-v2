/* "People" — everyone on Deen Friends, in small rows (V3.1). Mutual-friend suggestions (prepared
 * server-side) come first, then every other member, paged. Tapping a row opens the profile. Only
 * display name, username and avatar are shown; people who turned discovery off are not listed. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { friendlyMessage, logError } from '../services/errors';
import { connectionStatus, sendFriendRequest } from '../services/friendService';
import { readPublicProfile } from '../services/format';
import {
  dismissSuggestion,
  dismissedSuggestions,
  eligible,
  loadMembers,
  loadBlockedUids,
  loadMutualSuggestions,
  type Suggestion,
} from '../services/suggestionService';
import { relationshipSnapshot, useDeenFriends } from '../state/deenFriendsStore';
import { Avatar, Icon, SkeletonRows, useToast } from './ui';

export function SuggestionsSection({ onOpenProfile }: { onOpenProfile: (uid: string) => void }) {
  const s = useDeenFriends();
  const toast = useToast();
  const [mutual, setMutual] = useState<Suggestion[] | null>(null);
  const [active, setActive] = useState<Suggestion[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [done, setDone] = useState(false);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<string[]>(() => dismissedSuggestions());
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [m, b, first] = await Promise.all([loadMutualSuggestions(), loadBlockedUids(), loadMembers(null)]);
      setMutual(m.items);
      setBlocked(b);
      setActive(first.items);
      setCursor(first.cursor);
      setDone(first.done);
    } catch (err) {
      logError('suggestions load', err);
      setError(friendlyMessage(err, 'Suggestions could not be loaded.'));
      setMutual((x) => x || []);
    }
  }, []);

  // Load when the section comes near the screen (it sits below the circle), not on page open.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver !== 'function') {
      void load();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void load();
        }
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  const rel = relationshipSnapshot(s);
  const myUid = s.profile?.uid || '';
  const items = useMemo(() => {
    const seen = new Set<string>([myUid]);
    const out: Suggestion[] = [];
    for (const item of [...(mutual || []), ...active]) {
      if (seen.has(item.uid)) continue;
      seen.add(item.uid);
      if (eligible(item, rel, blocked, dismissed)) out.push(item);
    }
    return out;
  }, [mutual, active, rel, blocked, dismissed, myUid]);

  async function more() {
    if (loadingMore || done) return;
    setLoadingMore(true);
    try {
      const page = await loadMembers(cursor);
      setActive((list) => [...list, ...page.items]);
      setCursor(page.cursor);
      setDone(page.done);
    } catch (err) {
      logError('suggestions more', err);
      setError(friendlyMessage(err, 'More suggestions could not be loaded.'));
    } finally {
      setLoadingMore(false);
    }
  }

  async function add(item: Suggestion) {
    setBusy(item.uid);
    try {
      const target = readPublicProfile(item.uid, { username: item.username, displayName: item.displayName, avatar: item.avatar });
      const outcome = await sendFriendRequest(target, relationshipSnapshot(s));
      toast(
        outcome === 'accepted-theirs'
          ? `@${item.username} had already asked you — you are now Deen Friends.`
          : outcome === 'already-sent'
            ? 'Your request is already waiting for them.'
            : `Request sent to @${item.username}.`,
        'success',
      );
    } catch (err) {
      logError('suggestion request', err);
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <section ref={sectionRef} className="df2-section df2-suggestions" aria-labelledby="df2-suggest-title" data-tour="df-suggestions">
      <div className="df2-section-head">
        <h2 id="df2-suggest-title">People</h2>
        {items.length ? <span className="df2-section-meta">{items.length}{done ? '' : '+'}</span> : null}
      </div>
      {error ? (
        <p className="df2-inline-note">
          {error}{' '}
          <button type="button" className="df2-link-btn" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}
      {mutual === null ? (
        <SkeletonRows count={3} />
      ) : items.length ? (
        <>
          <ul className="df2-people">
            {items.map((item) => {
              const status = connectionStatus(item.uid, rel);
              return (
                <li key={item.uid} className="df2-person-row df2-suggest">
                  <button type="button" className="df2-person-open" onClick={() => onOpenProfile(item.uid)} aria-label={`View ${item.displayName}’s profile`}>
                    <Avatar avatar={item.avatar} config={item.avatarConfig} name={item.displayName} size={36} />
                    <span>
                      <strong>{item.displayName}</strong>
                      <small>
                        @{item.username}
                        {item.mutualCount ? ` · ${item.mutualCount} mutual friend${item.mutualCount === 1 ? '' : 's'}` : ''}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="df2-btn df2-btn-primary df2-btn-xs"
                    disabled={busy === item.uid || status !== 'none'}
                    onClick={() => void add(item)}
                  >
                    {busy === item.uid ? '…' : status === 'outgoing' ? 'Sent' : 'Add'}
                  </button>
                  <button
                    type="button"
                    className="df2-icon-btn df2-icon-btn-xs"
                    aria-label={`Hide ${item.displayName}`}
                    onClick={() => {
                      dismissSuggestion(item.uid);
                      setDismissed(dismissedSuggestions());
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
          {!done ? (
            <button type="button" className="df2-link-btn df2-people-more" disabled={loadingMore} onClick={() => void more()}>
              {loadingMore ? 'Loading…' : 'Show more'}
            </button>
          ) : null}
        </>
      ) : (
        <p className="df2-inline-note">No one new to add right now.</p>
      )}
    </section>
  );
}
