/**
 * Rows-per-page / pagination controller for every admin table.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { legacyDocumentLoading, onLegacyDomContentLoaded } from '../../runtime/lifecycle';

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  (() => {
    /* ONE page-size / pagination controller for every admin table. Replaces the old CSS "first 5 rows" cap
   whose "View all" control no longer existed. Rows are already client-side data; hiding is attribute-based
   and survives live re-renders because the observer re-applies in a microtask (before paint). */
    const KEY = 'rud_admin_page_size_v1',
      SIZES = [10, 25, 50, 100, 250, 500],
      MIN_ROWS = 10,
      SEL = '.table-wrap,.rud-df-admin-table-wrap';
    let size = 25;
    try {
      const n = Number(localStorage.getItem(KEY));
      if (SIZES.includes(n)) size = n;
    } catch {}
    const first = new WeakMap(); /* tbody -> index of first visible row (page = floor(first/size)) */
    let queued = false,
      observer = null;
    const rowsOf = (tb) => [...tb.children].filter((r) => r.tagName === 'TR');
    function control(wrap) {
      let c = wrap.nextElementSibling;
      if (c && c.dataset && c.dataset.rudPager) return c;
      c = document.createElement('div');
      c.className = 'rud-admin-view-control';
      c.dataset.rudPager = '1';
      c.style.cssText += ';gap:10px;flex-wrap:wrap';
      c.innerHTML = `<label style="display:flex;align-items:center;gap:8px;font-size:12px">Show <select data-rud-size aria-label="Rows per page" style="background:transparent;color:inherit;border:1px solid rgba(128,128,128,.45);border-radius:8px;padding:6px 8px;font:inherit">${SIZES.map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label><button type="button" class="rud-admin-view-all" data-rud-prev style="min-width:84px">← Prev</button><span data-rud-info style="font-size:12px;opacity:.85;min-width:120px;text-align:center"></span><button type="button" class="rud-admin-view-all" data-rud-next style="min-width:84px">Next →</button>`;
      wrap.after(c);
      return c;
    }
    function drop(wrap) {
      const c = wrap.nextElementSibling;
      if (c && c.dataset && c.dataset.rudPager) c.remove();
    }
    function apply() {
      const root = document.getElementById('adminApp');
      if (!root) return;
      root.querySelectorAll(SEL).forEach((wrap) => {
        const tb = wrap.querySelector('tbody');
        if (!tb || wrap.hidden) {
          drop(wrap);
          return;
        }
        const rows = rowsOf(tb);
        rows.forEach((r) => r.removeAttribute('data-rud-page-hidden'));
        const vis = rows.filter((r) => !r.hidden),
          total = vis.length;
        if (total <= MIN_ROWS) {
          drop(wrap);
          return;
        }
        let start = Math.max(0, Math.min(first.get(tb) || 0, total - 1));
        start = Math.floor(start / size) * size;
        first.set(tb, start);
        vis.forEach((r, i) => {
          if (i < start || i >= start + size) r.setAttribute('data-rud-page-hidden', '1');
        });
        const c = control(wrap),
          end = Math.min(total, start + size);
        c.querySelector('[data-rud-size]').value = String(size);
        c.querySelector('[data-rud-info]').textContent = `${start + 1}–${end} of ${total}`;
        c.querySelector('[data-rud-prev]').disabled = start === 0;
        c.querySelector('[data-rud-next]').disabled = end >= total;
      });
    }
    function run() {
      queued = false;
      try {
        apply();
      } catch (e) {
        console.warn('[admin pager]', e);
      }
      observer?.takeRecords();
    }
    function schedule() {
      if (queued) return;
      queued = true;
      queueMicrotask(run);
    }
    function start() {
      if (observer) return;
      observer = new MutationObserver(() => {
        if (document.getElementById('adminApp')) schedule();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      schedule();
    }
    document.addEventListener('change', (e) => {
      const sel = e.target.closest?.('[data-rud-size]');
      if (!sel) return;
      const n = Number(sel.value);
      if (!SIZES.includes(n)) return;
      size = n;
      try {
        localStorage.setItem(KEY, String(n));
      } catch {}
      schedule();
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-rud-prev],[data-rud-next]');
      if (!b) return;
      const wrap = b.parentElement?.previousElementSibling,
        tb = wrap?.querySelector?.('tbody');
      if (!tb) return;
      const cur = first.get(tb) || 0;
      first.set(tb, b.hasAttribute('data-rud-prev') ? Math.max(0, cur - size) : cur + size);
      schedule();
    });
    if (legacyDocumentLoading()) onLegacyDomContentLoaded(start);
    else start();
  })();
}
