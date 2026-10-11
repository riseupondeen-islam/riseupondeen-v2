/* "Your data on this page" (V3.5) — one shared control, one implementation, used by the pages that keep
 * the visitor's own data: My Deen, Qur'an, Saved and Tasbih.
 *
 * Everything listed here is stored only on this device (localStorage) and belongs only to this
 * visitor, so clearing it can never touch anyone else's data, shared or published content, or the
 * server. Each page clears only its own listed keys; settings that make the app work (theme, reading
 * preferences, reciter, notification settings, install state) are always kept. A copy can be
 * downloaded first, and clearing needs an explicit second confirmation.
 *
 * Not offered: Deen Friends (server data, managed by its own account flows and the admin console) and
 * Prayer (its saved location also drives prayer notifications). */
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppDialog } from '../../components/overlay/AppDialog';
import { esc, toast } from '../../utils/ui';
import { handleRoute } from '../../app/routing/router';

export type DataPage = 'my-deen' | 'quran' | 'saved' | 'tasbih';

interface PageData {
  title: string;
  items: Array<{ key: string; label: string }>;
  kept: string[];
}

export const PAGE_DATA: Record<DataPage, PageData> = {
  'my-deen': {
    title: 'My Deen',
    items: [
      { key: 'rud_deen_history_v2', label: 'Your Deen history' },
      { key: 'rud_my_deen_today_v2', label: 'Today’s checklist' },
      { key: 'rud_daily_deen_plan_v2', label: 'Daily Deen plan' },
      { key: 'rud_guided_adhkar_v2', label: 'Guided adhkar progress' },
      { key: 'rud_khatam_plan_v2', label: 'Khatam planner' },
      { key: 'rud_ramadan_fasting_v2', label: 'Ramadan fasting log' },
    ],
    kept: ['Reading settings and notification settings', 'Your Qur’an, Saved and Tasbih data (each has its own control)'],
  },
  quran: {
    title: 'Qur’an',
    items: [
      { key: 'rud_quran_bookmarks_v1', label: 'Bookmarks' },
      { key: 'rud_quran_last_read_v1', label: 'Last-read position' },
      { key: 'rud_quran_ayah_notes_v2', label: 'Ayah notes' },
      { key: 'rud_quran_memorization_v2', label: 'Memorization progress' },
      { key: 'rud_quran_reading_goal_v2', label: 'Reading goal' },
      { key: 'rud_quran_daily_activity_v2', label: 'Daily reading activity' },
    ],
    kept: ['Reciter, player and reading settings', 'Surahs saved for offline listening'],
  },
  saved: {
    title: 'Saved',
    items: [{ key: 'rud_favorites', label: 'Saved duas, hadith, reminders and names' }],
    kept: ['The published content itself', 'Items you made available offline'],
  },
  tasbih: {
    title: 'Tasbih',
    items: [{ key: 'rud_tasbih_count_v1', label: 'Your tasbih count' }],
    kept: ['Your chosen dhikr', 'Deen Friends challenge progress (kept on your account)'],
  },
};

const has = (key: string) => {
  try {
    const v = localStorage.getItem(key);
    return v !== null && v !== '' && v !== '[]' && v !== '{}' && v !== '0';
  } catch {
    return false;
  }
};

/** The button each page appends (same markup everywhere). */
export function pageDataControlHtml(page: DataPage): string {
  return `<div class="rud-page-data"><button type="button" class="rud-page-data-btn" data-page-data="${esc(page)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg><span>Your data on this page</span></button></div>`;
}

function PageDataDialog({ page, onClose }: { page: DataPage; onClose: () => void }) {
  const data = PAGE_DATA[page];
  const present = data.items.filter((i) => has(i.key));
  const [step, setStep] = useState<'review' | 'confirm'>('review');

  const download = () => {
    const out: Record<string, unknown> = {};
    for (const i of present) {
      try {
        const raw = localStorage.getItem(i.key);
        out[i.key] = raw && /^[[{"]/.test(raw) ? JSON.parse(raw) : raw;
      } catch {
        out[i.key] = localStorage.getItem(i.key);
      }
    }
    const blob = new Blob([JSON.stringify({ app: 'Rise Upon Deen', page, exportedAt: new Date().toISOString(), data: out }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rise-upon-deen-${page}-data.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const clear = () => {
    let failed = 0;
    for (const i of data.items) {
      try {
        localStorage.removeItem(i.key);
      } catch {
        failed++;
      }
    }
    onClose();
    try {
      handleRoute(); // the page re-renders without the cleared data
    } catch {
      /* the next navigation shows it */
    }
    if (failed) toast('Some data could not be cleared on this device.', 'error');
    else toast(`${data.title} data cleared from this device.`);
  };

  return (
    <AppDialog className="rud-page-data-dialog" kicker="Your data" title={`${data.title} on this device`} onClose={onClose}>
      {step === 'review' ? (
        <>
          {present.length ? (
            <>
              <p>Stored only on this device, for you:</p>
              <ul className="rud-page-data-list">
                {present.map((i) => (
                  <li key={i.key}>{i.label}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>There is no personal {data.title} data on this device.</p>
          )}
          <p className="rud-page-data-kept">
            <strong>Always kept:</strong> {data.kept.join(' · ')}.
          </p>
          <div className="rud-page-data-actions">
            {present.length ? (
              <>
                <button type="button" className="rud-btn rud-btn-quiet" onClick={download}>
                  Download a copy
                </button>
                <button type="button" className="rud-btn rud-btn-danger" onClick={() => setStep('confirm')}>
                  Clear this data…
                </button>
              </>
            ) : (
              <button type="button" className="rud-btn rud-btn-quiet" onClick={onClose}>
                Close
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p>
            Clear {present.length === 1 ? 'this item' : `these ${present.length} items`} from this device? This can’t be undone (unless you
            downloaded a copy).
          </p>
          <div className="rud-page-data-actions">
            <button type="button" className="rud-btn rud-btn-quiet" onClick={() => setStep('review')} data-autofocus>
              Cancel
            </button>
            <button type="button" className="rud-btn rud-btn-danger" onClick={clear}>
              Yes, clear {data.title} data
            </button>
          </div>
        </>
      )}
    </AppDialog>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function close() {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}
function open(page: DataPage) {
  close();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<PageDataDialog page={page} onClose={close} />);
}

let bound = false;
/** One delegated listener for every page's button (bound once at start-up). */
export function initPageDataControl(): void {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.('[data-page-data]') as HTMLElement | null;
    const page = btn?.dataset.pageData as DataPage | undefined;
    if (page && page in PAGE_DATA) {
      e.preventDefault();
      open(page);
    }
  });
  window.addEventListener('hashchange', close);
}
