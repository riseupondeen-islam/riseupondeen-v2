/* The App Guide: first-run welcome, the feature index and the interactive spotlight tour.
 *
 * - First run: a small, non-blocking card offers the tour (Start / Later / Don't show again).
 *   Nothing is mandatory — the app is fully usable while the card or the tour is open.
 * - App Guide (Explore → App Guide, or the `rud:open-guide` event): an index of every tour plus the
 *   full guided tour and install guidance.
 * - Tour: navigates to each step's route, waits for its control, scrolls it into view, highlights it
 *   and explains it. Missing/hidden controls become a centred explanation (never a dead end).
 *   Back / Next / Skip / Finish, Escape and arrow keys work; progress can be resumed.
 * - Page guides: the first time someone opens a page that has guide steps (Qur’an, Prayer, My Deen,
 *   Tasbih, the libraries, Deen Friends…), that page's short guide opens once by itself. It never
 *   leaves the page, can be skipped, and can be turned off in the App Guide.
 * - Preview (admin): `rud:preview-guide` runs a draft configuration without saving any progress.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { AppDialog } from '../../components/overlay/AppDialog';
import { requestInstallExperience } from '../pwa/installState';
import { DEFAULT_GUIDE, fitsLayout, pageKey, pageTourFor, sanitizeGuide, type GuideConfig, type GuideStep, type GuideTour } from './guideConfig';
import {
  firstRunDue,
  loadPublishedGuide,
  markPageSeen,
  markTourDone,
  pageSeen,
  readCachedGuide,
  readProgress,
  writeProgress,
} from './guideService';

interface Running {
  tour: GuideTour;
  index: number;
  preview: boolean;
  firstRun: boolean;
  /** Opened automatically for a page visited for the first time. */
  page: boolean;
  /** Page key the guide was opened on. */
  key: string;
}

/** Something else is on screen that a guide must not cover. */
function busyElsewhere(): boolean {
  return (
    document.body.classList.contains('rud-first-visit-open') ||
    document.documentElement.dataset.maintenance === 'active' ||
    /^#(riseupondeen\.admin|admin)/i.test(location.hash) ||
    !!document.querySelector('#preloader:not(.hide), #rudWelcomeIntro:not([hidden]), .rud-dialog-backdrop, .rud-ix-card, .df2-fullscreen, .df2-sheet-backdrop, #searchOverlay.open, .modal.open, .rud-explore-drawer.open')
  );
}

function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function visibleElement(selector: string): HTMLElement | null {
  if (!selector) return null;
  let list: HTMLElement[] = [];
  try {
    list = [...document.querySelectorAll<HTMLElement>(selector)];
  } catch {
    return null;
  }
  return (
    list.find((el) => {
      if (!el.isConnected || el.closest('[hidden]')) return false;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }) || null
  );
}

function waitForTarget(selector: string, timeout = 2500): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const found = visibleElement(selector);
    if (found || !selector) return resolve(found);
    const started = performance.now();
    let poll = 0;
    const observer = new MutationObserver(() => check());
    const check = () => {
      const el = visibleElement(selector);
      if (el || performance.now() - started > timeout) {
        observer.disconnect();
        clearInterval(poll);
        resolve(el);
        return true;
      }
      return false;
    };
    observer.observe(document.body, { childList: true, subtree: true });
    poll = window.setInterval(check, 120); // catches visibility changes without watching every attribute
  });
}

/** The highlighted area around a control (8px breathing room, kept on screen). */
function holeFor(rect: Rect): Rect {
  const pad = 8;
  return {
    top: Math.max(4, rect.top - pad),
    left: Math.max(4, rect.left - pad),
    width: Math.min(window.innerWidth - 8, rect.width + pad * 2),
    height: rect.height + pad * 2,
  };
}

function holeStyle(h: Rect): CSSProperties {
  return { transform: `translate3d(${h.left}px, ${h.top}px, 0)`, width: h.width, height: h.height };
}

/** Resolves when smooth scrolling stops (scrollend where supported), or after `max` ms. */
function scrollSettled(max: number): Promise<void> {
  if (max <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('scrollend', finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, max);
    window.addEventListener('scrollend', finish, { once: true });
  });
}

function setExplore(open: boolean): void {
  const drawer = document.getElementById('rudExploreDrawer');
  const isOpen = !!drawer?.classList.contains('open');
  if (open && !isOpen) document.getElementById('rudExploreBtn')?.click();
  if (!open && isOpen) document.querySelector<HTMLElement>('#rudExploreDrawer .rud-explore-close')?.click();
}

/* ------------------------------------------------------------------------------------------ */

export function GuideLayer() {
  const [config, setConfig] = useState<GuideConfig>(() => readCachedGuide());
  const [indexOpen, setIndexOpen] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [running, setRunning] = useState<Running | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;

  useEffect(() => {
    let cancelled = false;
    void loadPublishedGuide().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* First run: wait until the visitor is free (name prompt, maintenance and admin excluded). */
  useEffect(() => {
    if (!firstRunDue(config)) return;
    let timer = 0;
    const attempt = () => {
      if (busyElsewhere() || runningRef.current) {
        timer = window.setTimeout(attempt, 1500);
        return;
      }
      // Someone who arrived on another page gets that page's own guide instead (below).
      if (pageTourFor(config, location.hash) && config.pageTours && !readProgress().pageToursOff) return;
      setWelcome(true);
    };
    timer = window.setTimeout(attempt, 1200);
    return () => clearTimeout(timer);
  }, [config]);

  const start = useCallback(
    (tour: GuideTour | undefined, opts: { preview?: boolean; firstRun?: boolean; page?: boolean; at?: number } = {}) => {
      if (!tour || !tour.steps.length) return;
      setIndexOpen(false);
      setWelcome(false);
      setRunning({
        tour,
        index: Math.max(0, Math.min(opts.at || 0, tour.steps.length - 1)),
        preview: !!opts.preview,
        firstRun: !!opts.firstRun,
        page: !!opts.page,
        key: pageKey(location.hash || '#home'),
      });
    },
    [],
  );

  /* Page guides: the first visit to a page with guide steps opens its short guide once. */
  const welcomeRef = useRef(welcome);
  welcomeRef.current = welcome;
  useEffect(() => {
    if (!config.pageTours) return;
    let timer = 0;
    const check = () => {
      clearTimeout(timer);
      // A page guide belongs to its page: leaving the page ends it.
      if (runningRef.current?.page && pageKey(location.hash || '#home') !== runningRef.current.key) {
        runningRef.current = null;
        setRunning(null);
      }
      if (readProgress().pageToursOff || runningRef.current) return;
      const key = pageKey(location.hash || '#home');
      const tour = pageTourFor(config, key);
      if (!tour || pageSeen(key)) return;
      let tries = 0;
      const attempt = () => {
        if (pageKey(location.hash || '#home') !== key || runningRef.current) return;
        if (busyElsewhere()) {
          if (++tries < 20) timer = window.setTimeout(attempt, 900);
          return;
        }
        // Opening a page replaces the generic welcome card (it is counted as "later").
        if (welcomeRef.current) {
          setWelcome(false);
          writeProgress({ firstRunDone: true, firstRunVersion: config.version });
        }
        markPageSeen(key);
        start(tour, { page: true });
      };
      timer = window.setTimeout(attempt, 650); // let the page render first
    };
    check();
    window.addEventListener('hashchange', check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('hashchange', check);
    };
  }, [config, start]);

  /* Admin preview (Admin → App Guide → Preview opens this page in a new tab). */
  useEffect(() => {
    try {
      const raw = localStorage.getItem('rud_app_guide_preview');
      if (!raw) return;
      localStorage.removeItem('rud_app_guide_preview');
      const data = JSON.parse(raw) as { config?: unknown; tourId?: string; at?: number };
      if (!data.at || Date.now() - data.at > 5 * 60000) return;
      const c = sanitizeGuide(data.config);
      const timer = window.setTimeout(() => start(c.tours.find((t) => t.id === data.tourId) || c.tours[0], { preview: true }), 1200);
      return () => clearTimeout(timer);
    } catch {
      /* ignore a malformed preview */
    }
  }, [start]);

  /* Entry points. */
  useEffect(() => {
    const onOpen = () => {
      if (runningRef.current) return;
      setIndexOpen(true);
    };
    const onPreview = (event: Event) => {
      const detail = (event as CustomEvent<{ config: GuideConfig; tourId?: string }>).detail;
      const c = detail?.config || DEFAULT_GUIDE;
      const tour = c.tours.find((t) => t.id === (detail?.tourId || c.firstRunTourId)) || c.tours[0];
      start(tour, { preview: true });
    };
    window.addEventListener('rud:open-guide', onOpen);
    window.addEventListener('rud:preview-guide', onPreview);
    return () => {
      window.removeEventListener('rud:open-guide', onOpen);
      window.removeEventListener('rud:preview-guide', onPreview);
    };
  }, [start]);

  const tours = config.tours.filter((t) => t.enabled && fitsLayout(t.layout) && t.steps.length);
  const firstTour = config.tours.find((t) => t.id === config.firstRunTourId);
  const progress = readProgress();

  const finishFirstRun = () => writeProgress({ firstRunDone: true, firstRunVersion: config.version });

  return (
    <>
      {welcome && !running ? (
        <div className="rud-v3 rud-gx-welcome" role="dialog" aria-modal="false" aria-labelledby="rudGuideWelcomeTitle">
          <button
            type="button"
            className="rud-dialog-close"
            aria-label="Don’t show the tour again"
            onClick={() => {
              finishFirstRun();
              setWelcome(false);
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          <span className="rud-dialog-kicker">New here?</span>
          <h2 id="rudGuideWelcomeTitle">Take a one-minute tour</h2>
          <p>See where the Qur’an, prayer tools, My Deen and Deen Friends live. You can skip at any point.</p>
          <div className="rud-ix-card-actions">
            <button type="button" className="rud-btn rud-btn-primary" onClick={() => start(firstTour, { firstRun: true })}>
              Start tour
            </button>
            <button
              type="button"
              className="rud-btn rud-btn-quiet"
              onClick={() => {
                setWelcome(false);
                finishFirstRun();
              }}
            >
              Maybe later
            </button>
          </div>
          <small>Replay it any time from Explore → App Guide.</small>
        </div>
      ) : null}

      {indexOpen ? (
        <AppDialog className="rud-gx-dialog" kicker="App Guide" title="What would you like to learn?" onClose={() => setIndexOpen(false)}>
          <button type="button" className="rud-gx-full" data-autofocus onClick={() => start(firstTour || tours[0])}>
            <span>
              <strong>Take the full tour</strong>
              <small>A short walk through navigation and the main features.</small>
            </span>
            <i aria-hidden="true">›</i>
          </button>
          {progress.resume && config.tours.find((t) => t.id === progress.resume?.tourId) ? (
            <button
              type="button"
              className="rud-gx-full rud-gx-resume"
              onClick={() => start(config.tours.find((t) => t.id === progress.resume?.tourId), { at: progress.resume?.step })}
            >
              <span>
                <strong>Resume where you stopped</strong>
                <small>{config.tours.find((t) => t.id === progress.resume?.tourId)?.title}</small>
              </span>
              <i aria-hidden="true">›</i>
            </button>
          ) : null}
          <label className="rud-gx-toggle">
            <input
              type="checkbox"
              defaultChecked={!progress.pageToursOff}
              onChange={(e) => writeProgress({ pageToursOff: !e.target.checked })}
            />
            <span>Show a short guide the first time I open a page</span>
          </label>
          <ul className="rud-gx-list">
            {tours
              .filter((t) => t.id !== config.firstRunTourId)
              .map((tour) => (
                <li key={tour.id}>
                  <button type="button" onClick={() => (tour.steps.every((x) => x.action === 'open-install') ? (setIndexOpen(false), requestInstallExperience('guide')) : start(tour))}>
                    <span>
                      <strong>
                        {tour.title}
                        {progress.tours?.[tour.id] ? <em className="rud-gx-done">Viewed</em> : null}
                      </strong>
                      <small>{tour.summary}</small>
                    </span>
                    <i aria-hidden="true">›</i>
                  </button>
                </li>
              ))}
          </ul>
        </AppDialog>
      ) : null}

      {running ? (
        <TourRunner
          key={`${running.tour.id}-${running.preview}`}
          running={running}
          onIndex={(index) => setRunning((r) => (r ? { ...r, index } : r))}
          onEnd={(completed) => {
            const r = runningRef.current;
            if (r && !r.preview && !r.page) {
              if (completed) markTourDone(r.tour.id);
              else writeProgress({ resume: { tourId: r.tour.id, step: r.index } });
              if (r.firstRun || r.tour.id === config.firstRunTourId) finishFirstRun();
            }
            setRunning(null);
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------------------------ */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function TourRunner({
  running,
  onIndex,
  onEnd,
}: {
  running: Running;
  onIndex: (index: number) => void;
  onEnd: (completed: boolean) => void;
}) {
  const steps = running.tour.steps;
  const onIndexRef = useRef(onIndex);
  const onEndRef = useRef(onEnd);
  onIndexRef.current = onIndex;
  onEndRef.current = onEnd;
  const [state, setState] = useState<{ step: GuideStep; target: HTMLElement | null; ready: boolean }>({
    step: steps[running.index],
    target: null,
    ready: false,
  });
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(running.index);
  indexRef.current = running.index;
  const exploreOpenedByTour = useRef(false);

  /* Body class: lets other overlays (install card, notifications) step aside while touring. */
  useEffect(() => {
    document.body.classList.add('rud-gx-open');
    return () => {
      document.body.classList.remove('rud-gx-open');
      if (exploreOpenedByTour.current) setExplore(false);
    };
  }, []);

  /* Prepare the current step: layout filter, route, actions, target, scrolling. */
  useEffect(() => {
    let cancelled = false;
    const step = steps[running.index];
    // Keep the previous highlight while the next control is found, so the ring glides to it
    // instead of the whole screen flashing.
    setState((prev) => ({ step, target: prev.target, ready: false }));
    (async () => {
      if (!fitsLayout(step.layout)) {
        // Not for this screen size: move on in the same direction.
        const next = running.index + 1;
        if (next < steps.length) onIndexRef.current(next);
        else onEndRef.current(true);
        return;
      }
      if (step.action === 'open-install') {
        onEndRef.current(true);
        requestInstallExperience('guide');
        return;
      }
      const needsExplore = step.action === 'open-explore' || !!step.target.match(/rudExplore|explore-/);
      if (!needsExplore && exploreOpenedByTour.current) {
        setExplore(false);
        exploreOpenedByTour.current = false;
      }
      if (step.route && (location.hash || '#home') !== step.route) {
        location.hash = step.route;
        await new Promise((r) => setTimeout(r, 40));
      }
      if (needsExplore) {
        setExplore(true);
        exploreOpenedByTour.current = true;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (step.action === 'close-explore') setExplore(false);
      const target = step.target ? await waitForTarget(step.target) : null;
      if (cancelled) return;
      if (target) {
        const r = target.getBoundingClientRect();
        const margin = 90;
        const offscreen = r.top < margin || r.bottom > window.innerHeight - 160;
        if (offscreen && !target.closest('.rud-minimal-topbar')) {
          target.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
          await scrollSettled(reducedMotion() ? 0 : 420);
        }
      }
      if (cancelled) return;
      if (!target) setRect(null);
      setState({ step, target, ready: true });
      markPageSeen(pageKey(location.hash || '#home'));
    })();
    return () => {
      cancelled = true;
    };
  }, [running.index, steps]);

  /* Keep the spotlight on the control while the page moves or resizes. Scrolling only moves the
     highlight with a compositor transform written straight to the elements (no React render per
     frame); React re-renders only when the step or the window size changes. */
  const shadeRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = state.target;
    if (!target) return;
    let frame = 0;
    const read = () => {
      const r = target.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    };
    const follow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!target.isConnected) return;
        const h = holeFor(read());
        const t = `translate3d(${h.left}px, ${h.top}px, 0)`;
        for (const el of [shadeRef.current, ringRef.current]) {
          if (!el) continue;
          el.style.transform = t;
          el.style.width = `${h.width}px`;
          el.style.height = `${h.height}px`;
        }
      });
    };
    const relayout = () => {
      if (!target.isConnected) setRect(null);
      else setRect(read());
    };
    relayout();
    window.addEventListener('resize', relayout);
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(follow) : null;
    ro?.observe(target);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', relayout);
      window.removeEventListener('scroll', follow, { capture: true });
      ro?.disconnect();
    };
  }, [state.target]);

  const next = useCallback(() => {
    if (indexRef.current >= steps.length - 1) onEndRef.current(true);
    else onIndexRef.current(indexRef.current + 1);
  }, [steps.length]);
  const back = useCallback(() => {
    if (indexRef.current > 0) onIndexRef.current(indexRef.current - 1);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.rud-dialog-backdrop')) return;
      if (event.key === 'Escape') onEndRef.current(false);
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'ArrowLeft') back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [next, back]);

  useEffect(() => {
    if (state.ready) cardRef.current?.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true });
  }, [state.ready, state.step.id]);

  const index = running.index;
  const last = index === steps.length - 1;
  const hole = rect ? holeFor(rect) : null;

  /* Card placement: below the control if there is room, otherwise above; centred when no control. */
  let cardStyle: CSSProperties | undefined;
  const mobile = window.innerWidth < 640;
  if (hole && !mobile) {
    const width = Math.min(360, window.innerWidth - 24);
    const below = hole.top + hole.height + 14;
    const left = Math.min(Math.max(12, hole.left + hole.width / 2 - width / 2), window.innerWidth - width - 12);
    cardStyle =
      below + 230 < window.innerHeight
        ? { top: below, left, width }
        : { top: Math.max(12, hole.top - 14 - 230), left, width };
  }
  const placementClass = !hole ? 'is-centered' : mobile ? (hole.top > window.innerHeight * 0.55 ? 'is-sheet-top' : 'is-sheet') : 'is-floating';

  return createPortal(
    <div className="rud-v3 rud-tour" aria-live="polite">
      <div ref={shadeRef} className={`rud-tour-shade${hole ? ' has-hole' : ''}`} style={hole ? holeStyle(hole) : undefined} aria-hidden="true" />
      {hole ? <div ref={ringRef} className="rud-tour-ring" style={holeStyle(hole)} aria-hidden="true" /> : null}
      <div
        ref={cardRef}
        className={`rud-tour-card ${placementClass}${state.ready ? '' : ' is-loading'}`}
        style={cardStyle}
        role="dialog"
        aria-modal="false"
        aria-labelledby="rudTourTitle"
        aria-describedby="rudTourBody"
      >
        <div className="rud-tour-meta">
          <span>
            {running.preview ? 'Preview · ' : ''}
            {running.page ? `${running.tour.title} · quick guide` : running.tour.title}
          </span>
          <span>
            {index + 1} / {steps.length}
          </span>
        </div>
        <div className="rud-tour-text" key={state.step.id}>
          <h2 id="rudTourTitle">{state.step.title}</h2>
          <p id="rudTourBody">{state.step.body}</p>
        </div>
        {state.ready && state.step.target && !state.target ? (
          <p className="rud-tour-missing">This control isn’t on screen right now (it may need you to sign in, or appear once content loads). You can continue the tour.</p>
        ) : null}
        <div className="rud-tour-progress" aria-hidden="true">
          <i style={{ transform: `scaleX(${(index + 1) / steps.length})` }} />
        </div>
        <div className="rud-tour-actions">
          <button type="button" className="rud-btn rud-btn-quiet" onClick={() => onEndRef.current(false)}>
            Skip
          </button>
          <span className="rud-tour-spacer" />
          {index > 0 ? (
            <button type="button" className="rud-btn" onClick={back}>
              Back
            </button>
          ) : null}
          <button type="button" className="rud-btn rud-btn-primary" data-primary onClick={next}>
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
