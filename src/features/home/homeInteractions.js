/**
 * Home page interactions: intro preloader, stars/particles, back-to-top, smooth anchors, reveal-on-scroll and the timeline.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
import { introAlreadySeen, introDuration } from '../../components/layout/Preloader';

export function init() {
  /* =========================================================
       RISE UPON DEEN — VANILLA JAVASCRIPT
       ========================================================= */

  (() => {
    'use strict';

    const $ = (sel, scope = document) => scope.querySelector(sel);
    const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarsePointer = true; /* Performance mode: disables decorative parallax/tilt/custom-cursor loops. */
    const isMobile = window.matchMedia('(max-width: 760px)').matches;

    /* ---------------- PRELOADER ---------------- */
    const preloader = $('#preloader');
    const introStartedAt = window.__rudIntroStartedAt || Date.now();
    const introSessionKey = 'rud_intro_seen_session_v1';
    /* V3.1: same rule as the Preloader component — once per browser session, and at most every
       12 hours (shorter) in the installed Home Screen app. */
    const introSeen = introAlreadySeen();
    try {
      sessionStorage.setItem(introSessionKey, '1');
      if (!introSeen) localStorage.setItem('rud_intro_seen_at', String(Date.now()));
    } catch {}
    const hidePreloader = () => {
      const root = document.documentElement;
      const light = (window.__rudThemeAfterIntro || 'light') !== 'dark';
      root.classList.add('rud-theme-switching');
      root.classList.toggle('light-mode', light);
      root.style.backgroundColor = light ? '#ffffff' : '#050505';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#ffffff' : '#050505');
      document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', light ? 'light' : 'dark');
      preloader?.classList.add('hide');
      requestAnimationFrame(() => root.classList.remove('rud-theme-switching'));
    };
    if (introSeen) {
      if (preloader) preloader.style.transition = 'none';
      hidePreloader();
    } else setTimeout(hidePreloader, Math.max(0, introDuration() - (Date.now() - introStartedAt)));

    /* ---------------- DYNAMIC YEAR ---------------- */
    $('#year').textContent = new Date().getFullYear();

    /* ---------------- STARS ---------------- */
    function createStars(container, count) {
      if (!container) return;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const s = document.createElement('span');
        s.className = 'star';
        s.style.left = Math.random() * 100 + '%';
        s.style.top = Math.random() * 82 + '%';
        const size = Math.random() * 1.6 + 0.55;
        s.style.width = s.style.height = size + 'px';
        s.style.opacity = (Math.random() * 0.6 + 0.2).toFixed(2);
        s.style.setProperty('--twinkle', (Math.random() * 4 + 3).toFixed(1) + 's');
        s.style.animationDelay = (-Math.random() * 5).toFixed(1) + 's';
        frag.appendChild(s);
      }
      container.appendChild(frag);
    }
    createStars($('#heroStars'), isMobile ? 10 : 52);
    createStars($('#reflectionStars'), isMobile ? 6 : 32);

    /* ---------------- LIGHT PARTICLES ---------------- */
    function createParticles(section, count = 16) {
      if (!section || reduceMotion) return;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const p = document.createElement('i');
        p.className = 'particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.top = 35 + Math.random() * 65 + '%';
        p.style.setProperty('--d', (7 + Math.random() * 7).toFixed(1) + 's');
        p.style.setProperty('--drift', ((Math.random() - 0.5) * 50).toFixed(1) + 'px');
        p.style.animationDelay = (-Math.random() * 8).toFixed(1) + 's';
        frag.appendChild(p);
      }
      section.appendChild(frag);
    }
    createParticles($('#reminder'), isMobile ? 4 : 14);
    createParticles($('#dua'), isMobile ? 4 : 14);

    /* ---------------- BACK TO TOP ---------------- */
    const backTop = $('#backTop');
    let lastScroll = -1;
    let backTopShown = false;

    function updateScrollUI() {
      const y = window.scrollY;
      if (Math.abs(y - lastScroll) < 2) return;
      const shouldShow = y > 700;
      if (shouldShow !== backTopShown) {
        backTop.classList.toggle('show', shouldShow);
        backTopShown = shouldShow;
      }
      lastScroll = y;
    }
    backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    /* ---------------- SMOOTH ANCHORS ---------------- */
    $$('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (e) => {
        const id = link.getAttribute('href');
        if (!id || id === '#' || !/^#[A-Za-z][\w:-]*$/.test(id)) return;
        const target = document.getElementById(id.slice(1));
        if (!target || target.closest('main')?.hidden) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    /* ---------------- SCROLL REVEAL ---------------- */
    const revealEls = $$('.reveal');
    if ('IntersectionObserver' in window && !reduceMotion) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('visible');
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -7% 0px' },
      );
      revealEls.forEach((el) => observer.observe(el));
    } else {
      revealEls.forEach((el) => el.classList.add('visible'));
    }

    /* ---------------- ACTIVE NAV ---------------- */
    const navLinks = $$('.nav-link');
    const sections = ['home', 'names', 'knowledge', 'journey', 'reminders', 'dua', 'about']
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if ('IntersectionObserver' in window) {
      const navObserver = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (!visible) return;
          navLinks.forEach((l) => {
            const href = l.getAttribute('href');
            l.classList.toggle('active', href === '#' + visible.target.id);
          });
        },
        { threshold: [0.25, 0.45, 0.65], rootMargin: '-15% 0px -55% 0px' },
      );
      sections.forEach((s) => navObserver.observe(s));
    }

    /* ---------------- BUTTON GLOW / RIPPLE ---------------- */
    /* Pointer ripple tracking disabled for performance. */ /* ---------------- TIMELINE PROGRESS ---------------- */
    const timeline = $('#timeline');
    const progress = $('#timelineProgress');
    const timelineItems = $$('.timeline-item');
    const timelineMain = timeline?.closest('main');

    function updateTimeline() {
      if (!timeline || !progress || timelineMain?.hidden) return;
      const rect = timeline.getBoundingClientRect();
      const viewportPoint = innerHeight * 0.58;
      if (rect.top >= innerHeight) {
        progress.style.height = '0px';
        timelineItems.forEach((item) => item.classList.remove('active'));
        return;
      }
      if (rect.bottom <= 0) {
        progress.style.height = Math.max(0, rect.height - 26) + 'px';
        timelineItems.forEach((item) => item.classList.add('active'));
        return;
      }
      const start = rect.top + 8;
      const end = rect.bottom - 18;
      const traveled = Math.min(Math.max(viewportPoint - start, 0), end - start);
      progress.style.height = traveled + 'px';
      timelineItems.forEach((item) => {
        const ir = item.getBoundingClientRect();
        item.classList.toggle('active', ir.top < viewportPoint);
      });
    }
    let timelineTicking = false;
    function updateHomeScrollFrame() {
      updateScrollUI();
      updateTimeline();
      timelineTicking = false;
    }
    window.addEventListener(
      'scroll',
      () => {
        if (timelineTicking) return;
        timelineTicking = true;
        requestAnimationFrame(updateHomeScrollFrame);
      },
      { passive: true },
    );
    updateScrollUI();
    updateTimeline();

    /* NAME MODAL + focus trap: moved to the React <NameModal/> component (features/names). */

    /* ---------------- FINAL SAFETY ---------------- */
    window.addEventListener(
      'resize',
      () => {
        /* FIX: removed `if (innerWidth > 980) setMenu(false);` — setMenu() no longer exists (the old mobile
           menu was replaced by the Explore drawer), so every wide resize threw a ReferenceError and the
           timeline was never re-measured. */
        clearTimeout(window.__rudTimelineResizeTimer);
        window.__rudTimelineResizeTimer = setTimeout(updateTimeline, 80);
      },
      { passive: true },
    );
  })();
}
