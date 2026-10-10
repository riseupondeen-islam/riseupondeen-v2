/**
 * First-visit name prompt (welcome card) and analytics hand-off.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { rudAnalyticsWrite, rudInitVisitorAnalytics } from '../analytics/visitorAnalytics';
import { onLegacyDomContentLoaded } from '../../runtime/lifecycle';

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  (function () {
    const KEY = 'rud_visitor_name';
    function getName() {
      try {
        return (localStorage.getItem(KEY) || '').trim();
      } catch {
        return '';
      }
    }
    function saveName(v) {
      try {
        localStorage.setItem(KEY, v);
      } catch {}
    }
    function show() {
      const el = document.getElementById('rudWelcomeIntro');
      if (
        !el ||
        getName() ||
        window.RUD_MAINTENANCE_ACTIVE === true ||
        document.documentElement.dataset.maintenance === 'active'
      )
        return;
      el.hidden = false;
      el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('rud-first-visit-open');
      requestAnimationFrame(() => document.getElementById('rudVisitorName')?.focus());
    }
    function close() {
      const el = document.getElementById('rudWelcomeIntro');
      document.body.classList.remove('rud-first-visit-open');
      if (!el) return;
      el.classList.add('rud-welcome-leave');
      el.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        el.hidden = true;
      }, 520);
    }
    onLegacyDomContentLoaded(async () => {
      let alreadyRegistered = false;
      try {
        if (typeof window.RUD_hasRegisteredDeenProfile === 'function')
          alreadyRegistered = await window.RUD_hasRegisteredDeenProfile();
      } catch {}
      if (!getName() && !alreadyRegistered) show();
      else if (alreadyRegistered && !getName()) {
        try {
          const cached = await window.RUD_getRegisteredDeenProfile?.();
          const recoveredName = String(cached?.name || cached?.displayName || '').trim();
          if (recoveredName) saveName(recoveredName);
        } catch {}
      }
      const form = document.getElementById('rudWelcomeForm');
      const input = document.getElementById('rudVisitorName');
      if (!form || !input) return;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (form.dataset.submitting === '1') return;

        const name =
          window.RUD_normalizeVisitorName?.(input.value) || input.value.replace(/\s+/g, ' ').trim().slice(0, 50);
        if (name.length < 2) {
          input.setCustomValidity('Please enter your name.');
          input.reportValidity();
          setTimeout(() => input.setCustomValidity(''), 0);
          return;
        }

        form.dataset.submitting = '1';
        input.blur();
        try {
          await window.RUD_reserveVisitorName(name);
        } catch (err) {
          form.dataset.submitting = '';
          if (err?.code === 'name-taken' || err?.message === 'name-taken') {
            input.focus();
            input.setCustomValidity(
              'This name is already taken by another user. Please choose a different name, in sha Allah.',
            );
            input.reportValidity();
            setTimeout(() => input.setCustomValidity(''), 4500);
            return;
          }
          // Never trap a visitor behind the welcome screen when Firebase is temporarily
          // unavailable, the app is opened locally, or the device is offline. Keep the
          // name locally and let the normal app continue; analytics can sync later.
          try {
            input.setCustomValidity('');
          } catch {}
        }
        saveName(name);
        close();

        const rudResetHomeTop = () => {
          try {
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          } catch {
            window.scrollTo(0, 0);
          }
        };
        rudResetHomeTop();
        requestAnimationFrame(() => {
          rudResetHomeTop();
          requestAnimationFrame(rudResetHomeTop);
        });
        setTimeout(rudResetHomeTop, 80);
        setTimeout(rudResetHomeTop, 560);

        try {
          rudInitVisitorAnalytics();
          rudAnalyticsWrite(true);
        } catch {}

        try {
          window.RUD_startPublic?.();
        } catch {}
      });
    });
  })();
}
