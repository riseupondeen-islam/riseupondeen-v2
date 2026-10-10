/**
 * Tasbih counter, Zikr selection and the Deen Friends Zikr-challenge integration.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { stopCompass, stopPrayerClock } from '../prayer/prayerQibla';
import { esc, featureShowPage } from '../tools/featurePageShell';

let TASBIH_SELECTED_KEY, RUD_TASBIH_COUNT_KEY, RUD_TASBIH_ZIKR_KEY, RUD_DF_TASBIH_CTX_KEY;

function getDhikr() {
  try {
    return (window.RUD_getPublishedZikr?.() || []).filter((x) => x && x.id);
  } catch {
    return [];
  }
}
function getSavedTasbihZikrId() {
  try {
    return sessionStorage.getItem(TASBIH_SELECTED_KEY) || localStorage.getItem(TASBIH_SELECTED_KEY) || '';
  } catch {
    return '';
  }
}
function saveTasbihZikrId(id) {
  try {
    if (id) {
      sessionStorage.setItem(TASBIH_SELECTED_KEY, id);
      localStorage.setItem(TASBIH_SELECTED_KEY, id);
    } else {
      sessionStorage.removeItem(TASBIH_SELECTED_KEY);
      localStorage.removeItem(TASBIH_SELECTED_KEY);
    }
  } catch {}
}
function rudDfChallengeCtx() {
  try {
    const c = JSON.parse(sessionStorage.getItem(RUD_DF_TASBIH_CTX_KEY) || 'null');
    /* Friend challenges carry a friendshipId; Daily Deen Challenges (kind 'daily') do not. */
    if (!c || !c.challengeId || (!c.friendshipId && c.kind !== 'daily')) return null;
    const t = Math.floor(Number(c.targetCount));
    if (!(t >= 2) || Date.now() - Number(c.startedAt || 0) > 43200000) return null;
    c.targetCount = t;
    c.count = Math.max(0, Math.min(t, Math.floor(Number(c.count) || 0)));
    return c;
  } catch {
    return null;
  }
}
function rudDfSaveChallengeCtx(c) {
  try {
    sessionStorage.setItem(RUD_DF_TASBIH_CTX_KEY, JSON.stringify(c));
  } catch {}
}
function rudPublishedZikr() {
  return getDhikr()
    .map((z) => ({
      id: z.id,
      title: z.title || z.tr || 'Zikr',
      arabic: z.ar || '',
      transliteration: z.tr || z.title || '',
      meaning: z.meaning || '',
      reference: z.reference || '',
      prescribedCount: z.recommendedCount ?? null,
      number: z.displayOrder ?? null,
    }))
    .sort(
      (a, b) =>
        (Number(a.number) || 999999) - (Number(b.number) || 999999) ||
        String(a.title || '').localeCompare(String(b.title || '')),
    );
}
function rudTasbihCount() {
  try {
    const n = Number(localStorage.getItem(RUD_TASBIH_COUNT_KEY) || 0);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}
function rudSaveTasbihCount(value) {
  try {
    localStorage.setItem(RUD_TASBIH_COUNT_KEY, String(value));
  } catch {}
}
function rudSelectedZikr() {
  let id = '';
  try {
    id = localStorage.getItem(RUD_TASBIH_ZIKR_KEY) || '';
  } catch {}
  return rudPublishedZikr().find((x) => x.id === id) || null;
}
function rudSaveSelectedZikr(id) {
  try {
    if (id) localStorage.setItem(RUD_TASBIH_ZIKR_KEY, id);
    else localStorage.removeItem(RUD_TASBIH_ZIKR_KEY);
  } catch {}
}
function rudSelectedZikrHTML(z) {
  if (!z) {
    return `
      <div class="rud-selected-zikr empty" id="rudSelectedZikr">
        No Zikr selected. The counter works independently.
      </div>
    `;
  }

  const target = Number(z.prescribedCount);

  return `
    <div class="rud-selected-zikr" id="rudSelectedZikr">
      <div class="rud-zikr-title">${esc(z.title || 'Zikr')}</div>
      ${z.arabic ? `<div class="rud-zikr-arabic" lang="ar">${esc(z.arabic)}</div>` : ''}
      ${z.transliteration ? `<div class="rud-zikr-translit">${esc(z.transliteration)}</div>` : ''}
      ${z.meaning ? `<div class="rud-zikr-meaning">${esc(z.meaning)}</div>` : ''}
      ${z.reference ? `<div class="rud-zikr-ref">${esc(z.reference)}</div>` : ''}
      ${Number.isInteger(target) && target > 0 ? `<span class="rud-zikr-count-target">Prescribed count: ${target}</span>` : ''}
    </div>
  `;
}
function rudRenderZikrSelector() {
  const list = document.getElementById('rudZikrList');
  if (!list) return;
  const rows = rudPublishedZikr();

  list.innerHTML = rows.length
    ? rows
        .map(
          (z) => `
        <button class="rud-zikr-option" type="button" data-rud-zikr="${esc(z.id)}">
          <strong>${esc(z.title || 'Zikr')}</strong>
          ${z.arabic ? `<div class="arabic" lang="ar">${esc(z.arabic)}</div>` : ''}
          <small>${esc(z.transliteration || z.meaning || z.reference || '')}</small>
        </button>
      `,
        )
        .join('')
    : `<div class="empty-live">No published Zikr is available yet.</div>`;

  list.querySelectorAll('[data-rud-zikr]').forEach((btn) => {
    btn.addEventListener('click', () => {
      rudSaveSelectedZikr(btn.dataset.rudZikr || '');
      const holder = document.getElementById('rudSelectedZikr');
      if (holder) holder.outerHTML = rudSelectedZikrHTML(rudSelectedZikr());
      const select = document.getElementById('rudSelectZikr');
      if (select) select.textContent = 'Change Zikr';
      document.getElementById('rudZikrSelector')?.classList.remove('open');
      try {
        history.replaceState(history.state || {}, '', location.pathname + location.search + '#tasbih');
      } catch {}
    });
  });
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  TASBIH_SELECTED_KEY = 'rudTasbih:selected';
  RUD_TASBIH_COUNT_KEY = 'rud_tasbih_count_v1';
  RUD_TASBIH_ZIKR_KEY = 'rud_tasbih_zikr_v1';
  RUD_DF_TASBIH_CTX_KEY = 'rud_df_tasbih_challenge_v1';
  window.rudRenderTasbih = function (id) {
    stopCompass();
    stopPrayerClock();

    const requested = id && id !== 'choose' && id !== '__choose__' ? String(id) : '';
    if (requested) {
      const match = rudPublishedZikr().find((x) => x.id === requested);
      if (match) rudSaveSelectedZikr(match.id);
    }

    const available = rudPublishedZikr();
    const selected = rudSelectedZikr();
    if (!selected && available.length) {
      let saved = '';
      try {
        saved = localStorage.getItem(RUD_TASBIH_ZIKR_KEY) || '';
      } catch {}
      if (saved) rudSaveSelectedZikr('');
    }

    const chCtx =
      id === 'df-challenge' ? rudDfChallengeCtx() : null; /* Deen Friends challenge: exact target, local counter */
    const count = chCtx ? chCtx.count : rudTasbihCount();
    const active = chCtx ? null : rudSelectedZikr();
    const targetValue = Number(active?.prescribedCount);
    const activeTarget = chCtx ? chCtx.targetCount : Number.isInteger(targetValue) && targetValue > 0 ? targetValue : 0;

    featureShowPage(
      `
    <main class="rud-tool-page rud-tasbih-page">
      <button type="button" class="rud-detail-close" aria-label="Close Tasbih page">×</button>

      <div class="rud-tasbih-shell">
        <header class="rud-tool-head" style="width:100%;justify-content:center;text-align:center">
          <div>
            <span class="eyebrow">Tasbih</span>
            <h1>Remember Allah.</h1>
            <p class="rud-tool-sub">A quiet space for dhikr—simple, focused and free from distraction.</p>
          </div>
        </header>

        ${chCtx ? `<div class="rud-selected-zikr" id="rudSelectedZikr"><div class="rud-zikr-title">${esc(chCtx.title)}</div><span class="rud-zikr-count-target">Challenge target: ${chCtx.targetCount}</span></div>` : rudSelectedZikrHTML(active)}

        <button class="rud-tasbih-device" id="rudTasbihTap" type="button" aria-label="Tap to increase Tasbih count">
          <span class="rud-tasbih-ripple" aria-hidden="true"></span>
          <span class="rud-tasbih-device-label">TAP TO COUNT</span>
          <strong class="rud-tasbih-screen" id="rudTasbihCount">${count}</strong>
          <span class="rud-tasbih-target" id="rudTasbihTarget"></span>
        </button>

        ${chCtx ? `<div id="rudChallengeStatus" class="rud-tool-sub" role="status" aria-live="polite" style="text-align:center;margin-top:10px"></div>` : ''}<div class="rud-tasbih-actions">
          <button class="rud-compact-btn" id="rudTasbihReset" type="button">Reset</button>
          <button class="rud-compact-btn" id="rudSelectZikr" type="button"${chCtx ? ' hidden' : ''}>${active ? 'Change Zikr' : 'Select Zikr'}</button>
        </div>
      </div>

      <div class="rud-zikr-selector" id="rudZikrSelector" aria-hidden="true">
        <section class="rud-zikr-selector-panel">
          <header class="rud-zikr-selector-head">
            <h2>Select Zikr</h2>
            <button class="rud-compact-btn" id="rudCloseZikr" type="button">Close</button>
          </header>
          <div class="rud-zikr-list" id="rudZikrList"></div>
        </section>
      </div>
    </main>
  `,
      'Tasbih | Rise Upon Deen',
    );

    try {
      const enteringTasbih = !String(location.hash || '').startsWith('#tasbih');
      const target = location.pathname + location.search + '#tasbih' + (chCtx ? '/df-challenge' : '');
      if (enteringTasbih) history.pushState(history.state || {}, '', target);
      else history.replaceState(history.state || {}, '', target);
    } catch {
      location.hash = '#tasbih';
    }

    const tap = document.getElementById('rudTasbihTap');
    const screen = document.getElementById('rudTasbihCount');
    const targetLabel = document.getElementById('rudTasbihTarget');
    const ripple = tap?.querySelector('.rud-tasbih-ripple');
    let ritualTimer = 0;
    const syncTasbihVisual = (n) => {
      const ratio = activeTarget ? Math.max(0, Math.min(1, n / activeTarget)) : 0;
      tap?.style.setProperty('--rud-tasbih-progress', `${ratio * 360}deg`);
      if (targetLabel)
        targetLabel.textContent = activeTarget
          ? `Target ${activeTarget} · ${Math.min(n, activeTarget)} of ${activeTarget}`
          : 'Free count';
    };
    syncTasbihVisual(count);

    const statusEl = document.getElementById('rudChallengeStatus'),
      setStatus = (h) => {
        if (statusEl) statusEl.innerHTML = h;
      };
    const backToCompanion = () => {
      try {
        window.RUD_DEEN_FRIENDS.returnToInteraction(chCtx.friendshipId);
      } catch {
        location.hash = '#deen-friends';
      }
    };
    let finishing = false;
    const finishChallenge = async () => {
      if (!chCtx || finishing) return;
      finishing = true;
      chCtx.done = true;
      rudDfSaveChallengeCtx(chCtx);
      if (targetLabel) targetLabel.textContent = `✓ Completed · ${chCtx.targetCount} / ${chCtx.targetCount}`;
      setStatus('Saving your completion…');
      try {
        /* the ONLY Firestore write of the whole Tasbih session */
        await window.RUD_DEEN_FRIENDS.completeFromTasbih(chCtx);
        try {
          sessionStorage.removeItem(RUD_DF_TASBIH_CTX_KEY);
        } catch {}
        setStatus('✓ Challenge completed. Returning to your friend…');
        setTimeout(backToCompanion, 900);
      } catch (err) {
        finishing = false;
        setStatus(
          `Couldn’t save the completion (${esc(String(err?.message || 'please try again').slice(0, 120))}). <button type="button" class="rud-compact-btn" id="rudChallengeRetry">Retry</button>`,
        );
        document.getElementById('rudChallengeRetry')?.addEventListener('click', finishChallenge);
      }
    };
    if (chCtx) {
      document.querySelector('.rud-tasbih-page')?.addEventListener(
        'click',
        (e) => {
          if (e.target.closest?.('.rud-detail-close')) {
            e.preventDefault();
            e.stopPropagation();
            backToCompanion();
          }
        },
        true,
      );
      if (chCtx.done || chCtx.count >= chCtx.targetCount) finishChallenge(); /* resumed after an unsaved completion */
    }

    const increment = () => {
      if (chCtx && chCtx.done) return;
      const n = (chCtx ? chCtx.count : rudTasbihCount()) + 1;
      if (chCtx) {
        chCtx.count = Math.min(n, chCtx.targetCount);
        rudDfSaveChallengeCtx(chCtx);
      } else rudSaveTasbihCount(n);
      if (screen) {
        screen.textContent = String(n);
        screen.classList.remove('rud-count-pop');
        void screen.offsetWidth;
        screen.classList.add('rud-count-pop');
        setTimeout(() => screen?.classList.remove('rud-count-pop'), 360);
      }
      if (tap) {
        tap.classList.remove('rud-counting');
        void tap.offsetWidth;
        tap.classList.add('rud-counting');
        clearTimeout(ritualTimer);
        ritualTimer = setTimeout(() => tap?.classList.remove('rud-counting'), 520);
      }
      if (ripple) {
        ripple.classList.remove('is-rippling');
        void ripple.offsetWidth;
        ripple.classList.add('is-rippling');
        setTimeout(() => ripple?.classList.remove('is-rippling'), 700);
      }
      syncTasbihVisual(n);
      try {
        if (navigator.vibrate) navigator.vibrate(6);
      } catch {}
      if (chCtx && n >= chCtx.targetCount) finishChallenge();
    };

    tap?.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        increment();
      },
      { passive: false },
    );

    /* Android: a long press must not open the context menu (it shifted the page). */
    tap?.addEventListener('contextmenu', (e) => e.preventDefault());

    tap?.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        increment();
      }
    });

    document.getElementById('rudTasbihReset')?.addEventListener('click', () => {
      if (chCtx) {
        if (chCtx.done) return;
        chCtx.count = 0;
        rudDfSaveChallengeCtx(chCtx);
      } else rudSaveTasbihCount(0);
      if (screen) {
        screen.textContent = '0';
        screen.classList.remove('rud-count-pop');
      }
      tap?.classList.remove('rud-counting');
      ripple?.classList.remove('is-rippling');
      syncTasbihVisual(0);
    });

    document.getElementById('rudSelectZikr')?.addEventListener('click', () => {
      rudRenderZikrSelector();
      const overlay = document.getElementById('rudZikrSelector');
      overlay?.classList.add('open');
      overlay?.setAttribute('aria-hidden', 'false');
    });

    document.getElementById('rudCloseZikr')?.addEventListener('click', () => {
      const overlay = document.getElementById('rudZikrSelector');
      overlay?.classList.remove('open');
      overlay?.setAttribute('aria-hidden', 'true');
    });

    document.getElementById('rudZikrSelector')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('rudZikrSelector')) {
        e.currentTarget.classList.remove('open');
        e.currentTarget.setAttribute('aria-hidden', 'true');
      }
    });

    if (id === '__choose__' || id === 'choose') {
      requestAnimationFrame(() => document.getElementById('rudSelectZikr')?.click());
    }
  };
}
