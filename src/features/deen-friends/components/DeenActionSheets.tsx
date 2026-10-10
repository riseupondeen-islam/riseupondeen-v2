/* The sheets opened from a friend conversation: Deen actions, sharing content, encouragement and
 * creating a challenge (recommended, official template or your own). */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { collection, getDocs, limit, query, where } from '../../../services/firebase/sdk';
import type { ChallengeActivity, Interaction, SharedContentType } from '../types';
import { friendlyMessage, logError } from '../services/errors';
import { cleanText, endOfLocalDay, addDays, localDay, toAsciiDigits } from '../services/format';
import { requireSignedIn } from '../services/firebaseSession';
import {
  ENCOURAGEMENTS,
  sendChallenge,
  sendEncouragement,
  shareContent,
  type FriendRef,
} from '../services/interactionService';
import {
  parseAyahReference,
  publishedShareItems,
  quranShareItem,
  surahEnglishNames,
  type ShareItem,
} from '../services/shareCatalog';
import { Icon, Sheet, useToast, type IconName } from './ui';

/* ---------- action menu ---------- */

export type DeenAction = 'challenge' | 'quran' | 'dua' | 'hadith' | 'zikr' | 'reminder' | 'checkin' | 'encourage';

const ACTIONS: Array<{ id: DeenAction; icon: IconName; title: string; copy: string }> = [
  { id: 'challenge', icon: 'target', title: 'Challenge', copy: 'Set a Deen goal to complete together' },
  { id: 'quran', icon: 'book', title: 'Qur’an ayah', copy: 'Share an ayah with its reference' },
  { id: 'dua', icon: 'hands', title: 'Dua', copy: 'Share an authentic dua' },
  { id: 'hadith', icon: 'scroll', title: 'Hadith', copy: 'Share a hadith published by RISE' },
  { id: 'zikr', icon: 'beads', title: 'Dhikr', copy: 'Share a remembrance of Allah' },
  { id: 'reminder', icon: 'sparkle', title: 'Reminder', copy: 'Share a daily Islamic reminder' },
  { id: 'checkin', icon: 'check', title: 'Check in', copy: 'Mark today on your shared streak' },
  { id: 'encourage', icon: 'heart', title: 'Encourage', copy: 'Send a kind word' },
];

export function DeenActionMenu({ onPick, onClose }: { onPick: (action: DeenAction) => void; onClose: () => void }) {
  return (
    <Sheet title="Deen action" kicker="SHARE WHAT BENEFITS" onClose={onClose}>
      <div className="df2-action-grid">
        {ACTIONS.map((a) => (
          <button key={a.id} type="button" className="df2-action-tile" onClick={() => onPick(a.id)}>
            <span className="df2-action-icon">
              <Icon name={a.icon} size={22} />
            </span>
            <strong>{a.title}</strong>
            <small>{a.copy}</small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ---------- encouragement ---------- */

export function EncourageSheet({
  friend,
  onClose,
  send,
}: {
  friend?: FriendRef;
  onClose: () => void;
  /** V3: send somewhere other than a friend chat (e.g. a Deen circle). */
  send?: (text: string) => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  return (
    <Sheet title="Encourage your friend" kicker="KIND WORDS" onClose={onClose}>
      <div className="df2-option-list">
        {ENCOURAGEMENTS.map((text) => (
          <button
            key={text}
            type="button"
            className="df2-option"
            disabled={!!busy}
            onClick={async () => {
              setBusy(text);
              try {
                if (send) await send(text);
                else if (friend) await sendEncouragement(friend, text);
                toast('Encouragement sent.', 'success');
                onClose();
              } catch (err) {
                logError('encouragement', err);
                toast(friendlyMessage(err), 'error');
                setBusy('');
              }
            }}
          >
            {busy === text ? 'Sending…' : text}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ---------- share content ---------- */

const SHARE_FILTERS: Array<{ id: 'all' | SharedContentType; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'quran', label: 'Qur’an' },
  { id: 'dua', label: 'Dua' },
  { id: 'hadith', label: 'Hadith' },
  { id: 'zikr', label: 'Dhikr' },
  { id: 'reminder', label: 'Reminders' },
];

export function ShareSheet({
  friend,
  initialType,
  onClose,
  send,
  sentText = 'Shared with your friend.',
}: {
  friend?: FriendRef;
  initialType: 'all' | SharedContentType;
  onClose: () => void;
  /** V3: share somewhere other than a friend chat (e.g. a Deen circle). */
  send?: (item: ShareItem) => Promise<void>;
  sentText?: string;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | SharedContentType>(initialType);
  const [term, setTerm] = useState('');
  const [busyId, setBusyId] = useState('');
  const [ayah, setAyah] = useState<ShareItem | null>(null);
  const [ayahMessage, setAyahMessage] = useState('');
  const published = useMemo(() => publishedShareItems(), []);

  const list = useMemo(() => {
    const q = term.trim().toLowerCase();
    return published
      .filter((x) => (filter === 'all' || x.type === filter) && (!q || x.searchText.includes(q)))
      .slice(0, 40);
  }, [published, filter, term]);

  async function lookUpAyah(event: FormEvent) {
    event.preventDefault();
    setAyah(null);
    setAyahMessage('');
    try {
      const names = await surahEnglishNames().catch(() => []);
      const ref = parseAyahReference(toAsciiDigits(term), names);
      if (!ref) {
        setAyahMessage('Type a reference such as 2:255 or Al-Kahf 10.');
        return;
      }
      const item = await quranShareItem(ref[0], ref[1]);
      if (!item) setAyahMessage('That ayah was not found. Check the surah and ayah numbers.');
      setAyah(item);
    } catch (err) {
      logError('ayah lookup', err);
      setAyahMessage('The Qur’an text could not be loaded. Please check your connection.');
    }
  }

  async function share(item: ShareItem) {
    setBusyId(item.id);
    try {
      if (send) await send(item);
      else if (friend) await shareContent(friend, item);
      toast(sentText, 'success');
      onClose();
    } catch (err) {
      logError('share content', err);
      toast(friendlyMessage(err), 'error');
      setBusyId('');
    }
  }

  const card = (item: ShareItem) => (
    <button key={item.id} type="button" className="df2-share-item" disabled={!!busyId} onClick={() => share(item)}>
      <span className="df2-share-kind">{SHARE_FILTERS.find((f) => f.id === item.type)?.label || item.type}</span>
      <strong>{item.title}</strong>
      {item.arabic ? (
        <span className="df2-arabic df2-arabic-sm" lang="ar" dir="rtl">
          {item.arabic.slice(0, 140)}
        </span>
      ) : null}
      {item.preview ? <small>{item.preview.slice(0, 160)}</small> : null}
      {item.reference ? <em>{item.reference}</em> : null}
      <span className="df2-share-send">{busyId === item.id ? 'Sharing…' : 'Share'}</span>
    </button>
  );

  return (
    <Sheet title="Share something beneficial" kicker="FROM RISE · WITH REFERENCES" onClose={onClose} wide>
      <div className="df2-chip-row" role="tablist" aria-label="Content type">
        {SHARE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`df2-chip${filter === f.id ? ' active' : ''}`}
            onClick={() => {
              setFilter(f.id);
              setAyah(null);
              setAyahMessage('');
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      {filter === 'quran' ? (
        <form className="df2-search-row" onSubmit={lookUpAyah}>
          <input
            className="df2-input"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Ayah reference, e.g. 2:255"
            aria-label="Ayah reference"
            inputMode="text"
          />
          <button className="df2-btn df2-btn-primary" type="submit">
            Find ayah
          </button>
        </form>
      ) : (
        <input
          className="df2-input"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search duas, hadith, dhikr, reminders"
          aria-label="Search content"
        />
      )}
      {ayahMessage ? <p className="df2-inline-note">{ayahMessage}</p> : null}
      <div className="df2-share-list">
        {ayah ? card(ayah) : null}
        {filter !== 'quran' ? (
          list.length ? (
            list.map(card)
          ) : (
            <p className="df2-inline-note">Nothing matches yet. Try another word.</p>
          )
        ) : null}
      </div>
    </Sheet>
  );
}

/* ---------- challenges ---------- */

interface RecommendedGoal {
  type: string;
  category: string;
  title: string;
  target?: number;
  fridayOnly?: boolean;
}

/** Recommended goals (same set as V1). Each lasts until the end of today. */
const RECOMMENDED: RecommendedGoal[] = [
  { type: 'quran1', category: "Qur'an", title: "Read 1 page of Qur'an today" },
  { type: 'quran2', category: "Qur'an", title: "Read 2 pages of Qur'an today" },
  { type: 'quran5', category: "Qur'an", title: "Read 5 pages of Qur'an today" },
  { type: 'salah5', category: 'Salah', title: 'Protect all five prayers today' },
  { type: 'salahT', category: 'Salah', title: 'Pray every prayer on time today' },
  { type: 'fajr', category: 'Salah', title: 'Fajr accountability today' },
  { type: 'morning', category: 'Zikr', title: 'Complete your morning adhkar' },
  { type: 'evening', category: 'Zikr', title: 'Complete your evening adhkar' },
  { type: 'istighfar', category: 'Istighfar', title: 'Complete your planned Istighfar today', target: 100 },
  { type: 'hadith1', category: 'Hadith', title: 'Read one authentic Hadith today' },
  { type: 'dua1', category: 'Dua', title: 'Learn one authentic Dua today' },
  { type: 'kahf', category: 'Friday', title: 'Read Surah Al-Kahf this Friday', fridayOnly: true },
  { type: 'salawat', category: 'Friday', title: 'Send salawat on the Prophet ﷺ today', fridayOnly: true },
];

const CATEGORIES = ["Qur'an", 'Salah', 'Zikr', 'Istighfar', 'Hadith', 'Dua', 'Friday'];
const DUE_OPTIONS = [
  { days: 0, label: 'Tonight' },
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: 'In 3 days' },
  { days: 7, label: 'In 7 days' },
];

interface OfficialTemplate {
  id: string;
  title: string;
  description: string;
  category: string;
  target: number;
  durationDays: number;
  activity: ChallengeActivity;
  endAtMs: number;
}

export function ChallengeSheet({
  friend,
  rows,
  onClose,
}: {
  friend: FriendRef;
  rows: Interaction[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'recommended' | 'official' | 'custom'>('recommended');
  const [busy, setBusy] = useState('');
  const [official, setOfficial] = useState<OfficialTemplate[] | null>(null);
  const isFriday = new Date().getDay() === 5;

  useEffect(() => {
    if (mode !== 'official' || official) return;
    void (async () => {
      try {
        const { db } = await requireSignedIn();
        const snap = await getDocs(
          query(collection(db, 'deens_official_challenges'), where('active', '==', true), limit(20)),
        );
        setOfficial(
          snap.docs
            .map((d) => {
              const x = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                title: cleanText(x.title, 80),
                description: cleanText(x.description, 200),
                category: cleanText(x.category || 'Official', 30),
                target: Math.max(1, Math.min(1000, Number(x.target) || 1)),
                durationDays: Math.max(1, Math.min(90, Number(x.durationDays) || 1)),
                activity: (x.activity === 'tasbih' ? 'tasbih' : 'manual') as ChallengeActivity,
                endAtMs: Number(x.endAtMs) || 0,
              };
            })
            .filter((x) => x.title && (!x.endAtMs || x.endAtMs > Date.now())),
        );
      } catch (err) {
        logError('official templates', err);
        setOfficial([]);
      }
    })();
  }, [mode, official]);

  async function send(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    try {
      await run();
      toast('Challenge sent. Your friend can accept it now.', 'success');
      onClose();
    } catch (err) {
      logError('send challenge', err);
      toast(friendlyMessage(err), 'error');
      setBusy('');
    }
  }

  return (
    <Sheet title="Challenge your friend" kicker="DEEN CHALLENGE" onClose={onClose} wide>
      <div className="df2-segmented" role="tablist" aria-label="Challenge type">
        {(
          [
            ['recommended', 'Recommended'],
            ['official', 'RISE templates'],
            ['custom', 'Your own'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={mode === id ? 'active' : ''}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'recommended' ? (
        <div className="df2-option-list">
          {RECOMMENDED.filter((g) => !g.fridayOnly || isFriday).map((g) => (
            <button
              key={g.type}
              type="button"
              className="df2-option df2-option-rich"
              disabled={!!busy}
              onClick={() =>
                send(g.type, () =>
                  sendChallenge(
                    friend,
                    {
                      details: {
                        type: g.type,
                        category: g.category,
                        title: g.title,
                        target: g.target || 1,
                        activity: (g.target || 1) > 1 ? 'tasbih' : 'manual',
                      },
                      expiresAtMs: endOfLocalDay(localDay()),
                    },
                    rows,
                  ),
                )
              }
            >
              <span className="df2-share-kind">{g.category}</span>
              <strong>{busy === g.type ? 'Sending…' : g.title}</strong>
              <small>{g.target ? `Count ${g.target} in Tasbih · ` : ''}Due tonight</small>
            </button>
          ))}
        </div>
      ) : null}

      {mode === 'official' ? (
        official === null ? (
          <p className="df2-inline-note">Loading RISE templates…</p>
        ) : official.length ? (
          <div className="df2-option-list">
            {official.map((x) => (
              <button
                key={x.id}
                type="button"
                className="df2-option df2-option-rich"
                disabled={!!busy}
                onClick={() =>
                  send(x.id, () => {
                    const end = Math.min(endOfLocalDay(addDays(localDay(), x.durationDays - 1)), x.endAtMs || Infinity);
                    return sendChallenge(
                      friend,
                      {
                        details: {
                          type: 'official',
                          official: true,
                          officialId: x.id,
                          category: x.category,
                          title: x.title,
                          description: x.description || undefined,
                          target: x.target,
                          activity: x.activity === 'tasbih' && x.target > 1 ? 'tasbih' : 'manual',
                        },
                        expiresAtMs: end,
                      },
                      rows,
                    );
                  })
                }
              >
                <span className="df2-share-kind">Official · {x.category}</span>
                <strong>{busy === x.id ? 'Sending…' : x.title}</strong>
                {x.description ? <small>{x.description}</small> : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="df2-inline-note">
            RISE has no active templates right now. Try a recommended goal or create your own.
          </p>
        )
      ) : null}

      {mode === 'custom' ? <CustomChallengeForm friend={friend} rows={rows} onSent={onClose} /> : null}
    </Sheet>
  );
}

/** The single custom-challenge form: one validation, one write. */
function CustomChallengeForm({ friend, rows, onSent }: { friend: FriendRef; rows: Interaction[]; onSent: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [activity, setActivity] = useState<ChallengeActivity>('manual');
  const [activityTouched, setActivityTouched] = useState(false);
  const [target, setTarget] = useState('100');
  const [dueDays, setDueDays] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function pickCategory(next: string) {
    setCategory(next);
    if (!activityTouched) setActivity(next === 'Zikr' || next === 'Istighfar' ? 'tasbih' : 'manual');
    setError('');
  }

  function validate(): { ok: true; target: number; expiresAtMs: number } | { ok: false; message: string } {
    const cleanTitle = cleanText(title, 80);
    if (cleanTitle.length < 3 || !/[\p{L}\p{N}]/u.test(cleanTitle))
      return { ok: false, message: 'Give your challenge a clear title (at least 3 characters).' };
    let count = 1;
    if (activity === 'tasbih') {
      const raw = toAsciiDigits(target.trim());
      if (!/^\d+$/.test(raw))
        return { ok: false, message: 'Enter the Tasbih target as a whole number, for example 100.' };
      count = Number(raw);
      if (count < 2 || count > 1000) return { ok: false, message: 'A Tasbih target must be between 2 and 1,000.' };
    }
    const expiresAtMs = endOfLocalDay(addDays(localDay(), dueDays));
    if (expiresAtMs <= Date.now()) return { ok: false, message: 'That due time has passed. Choose a later day.' };
    return { ok: true, target: count, expiresAtMs };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const result = validate();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const desc = cleanText(description, 200);
      await sendChallenge(
        friend,
        {
          details: {
            type: 'custom',
            category,
            title: cleanText(title, 80),
            ...(desc ? { description: desc } : {}),
            target: result.target,
            activity,
          },
          expiresAtMs: result.expiresAtMs,
        },
        rows,
      );
      toast('Challenge sent. Your friend can accept it now.', 'success');
      onSent();
    } catch (err) {
      logError('custom challenge', err);
      setError(friendlyMessage(err, 'The challenge could not be sent. Please try again.'));
      setBusy(false);
    }
  }

  const dueLabel = DUE_OPTIONS.find((d) => d.days === dueDays)?.label || 'Tonight';
  return (
    <form className="df2-form" onSubmit={submit} noValidate>
      <label className="df2-field">
        <span>Challenge title</span>
        <input
          value={title}
          onChange={(e) => (setTitle(e.target.value), setError(''))}
          maxLength={80}
          placeholder="Read Surah Al-Mulk tonight"
          autoComplete="off"
        />
      </label>
      <label className="df2-field">
        <span>
          Description <small>(optional)</small>
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          rows={2}
          placeholder="Let’s do it together, in sha Allah."
        />
      </label>
      <fieldset className="df2-fieldset">
        <legend>Category</legend>
        <div className="df2-chip-row">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`df2-chip${category === c ? ' active' : ''}`}
              aria-pressed={category === c}
              onClick={() => pickCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="df2-fieldset">
        <legend>How is it completed?</legend>
        <div className="df2-segmented">
          {(
            [
              ['manual', 'Mark as done'],
              ['tasbih', 'Count in Tasbih'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={activity === id ? 'active' : ''}
              aria-pressed={activity === id}
              onClick={() => {
                setActivity(id);
                setActivityTouched(true);
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      {activity === 'tasbih' ? (
        <label className="df2-field">
          <span>Tasbih target</span>
          <input
            value={target}
            onChange={(e) => (setTarget(e.target.value), setError(''))}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
          />
          <small>Between 2 and 1,000. Counted in the Tasbih.</small>
        </label>
      ) : null}
      <fieldset className="df2-fieldset">
        <legend>Due</legend>
        <div className="df2-chip-row">
          {DUE_OPTIONS.map((d) => (
            <button
              key={d.days}
              type="button"
              className={`df2-chip${dueDays === d.days ? ' active' : ''}`}
              aria-pressed={dueDays === d.days}
              onClick={() => setDueDays(d.days)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="df2-preview" aria-live="polite">
        <span className="df2-kicker">PREVIEW</span>
        <strong>{cleanText(title, 80) || 'Your challenge title'}</strong>
        <small>
          {category} · {dueLabel}
          {activity === 'tasbih' ? ` · Target ${toAsciiDigits(target) || '—'}` : ''} · Completed when you both finish
        </small>
      </div>
      {error ? (
        <p className="df2-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="df2-btn df2-btn-primary df2-btn-block" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send challenge'}
      </button>
    </form>
  );
}
