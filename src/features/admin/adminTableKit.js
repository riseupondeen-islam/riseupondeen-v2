/**
 * Admin table toolkit — one controller for every HTML-string table in the console (content
 * libraries, Scheduled, Recycle Bin, Analytics, Maintenance access, notification/broadcast history
 * and the Deen Friends console). It replaces the old page-size controller (adminPager.js) and adds,
 * consistently everywhere:
 *   • Columns  — show/hide columns (the first, identifying column and selection/action columns are
 *                mandatory), Select all, Reset to default; remembered per table on this device
 *                (only column names are stored — never row data).
 *   • Filters  — derived from the data actually in the table: a value filter for columns with a small
 *                set of values (status, type, platform…), a date range for date columns, and a text
 *                search when the section has no search box of its own. Filters combine (AND), show as
 *                removable chips, and the result count is always visible.
 *   • Sorting  — click a column heading (numbers, dates and text sort naturally).
 *   • Paging   — rows per page + previous/next, applied after filtering.
 * It works on the rows the view has already loaded (views keep their own bounded Firestore queries);
 * it never changes, reorders or re-fetches data on the server.
 *
 * React-rendered views manage their own tables (DataTable component), so they are skipped here.
 */
const PREFS_KEY = 'rud_admin_table_prefs_v1';
const SIZE_KEY = 'rud_admin_page_size_v1';
const SIZES = [10, 25, 50, 100, 250];
const MIN_ROWS_FOR_PAGER = 10;
const WRAP_SEL = '.table-wrap,.rud-df-admin-table-wrap';
const MANDATORY_HEAD = /^(actions?|delete|select|)$/i;
const DATE_HEAD = /date|time|created|updated|seen|active|scheduled|deleted|joined|sent|when/i;

let pageSize = 25;
let observer = null;
let queued = false;
let applying = false;
const state = new WeakMap(); // table -> { key, sort, filters, search, page }

const readJSON = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function headersOf(table) {
  const row = table.tHead?.rows?.[table.tHead.rows.length - 1];
  return row ? [...row.cells] : [];
}
function isPlaceholder(tr) {
  return tr.cells.length === 1 && Number(tr.cells[0].colSpan || 1) > 1;
}
function dataRows(table) {
  const body = table.tBodies?.[0];
  if (!body) return [];
  return [...body.rows].filter((r) => !isPlaceholder(r) && !r.hidden);
}
function cellText(tr, i) {
  return text(tr.cells[i]);
}
function parseDate(s) {
  if (!s || s === '—' || s.length < 6) return NaN;
  const t = Date.parse(s.replace(/\s·\s/g, ' ').replace(/(\d)(st|nd|rd|th)\b/g, '$1'));
  return Number.isFinite(t) ? t : NaN;
}
function parseNum(s) {
  const m = String(s).replace(/,/g, '').match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

/** Describes the columns of a table from its headings and the loaded rows. */
function describe(table) {
  const heads = headersOf(table);
  const rows = dataRows(table);
  // The identifying column: the first one, or the one after a leading selection column.
  const idCol = heads[0] && (heads[0].querySelector('input') || !text(heads[0])) ? 1 : 0;
  return heads.map((th, i) => {
    const label = text(th) || (th.querySelector('input[type=checkbox]') ? 'Select' : '');
    const mandatory = i <= idCol || MANDATORY_HEAD.test(label) || !!th.querySelector('input,button');
    const values = rows.map((r) => cellText(r, i)).filter(Boolean);
    const distinct = [...new Set(values)];
    const isDate = DATE_HEAD.test(label) && values.length > 0 && values.filter((v) => Number.isFinite(parseDate(v))).length >= values.length * 0.6;
    const categorical =
      !mandatory && !isDate && rows.length >= 3 && distinct.length >= 2 && distinct.length <= 12 && distinct.every((v) => v.length <= 40);
    return { index: i, label: label || `Column ${i + 1}`, mandatory, isDate, categorical, values: distinct.sort((a, b) => a.localeCompare(b)) };
  });
}

function tableKey(table, cols) {
  const view = document.getElementById('adminApp')?.querySelector('#adminTopTitle')?.textContent || '';
  const scope = table.closest('[id]')?.id || '';
  return hash(`${view}|${scope}|${cols.map((c) => c.label).join('|')}`);
}

function hiddenColumns(key) {
  const prefs = readJSON(PREFS_KEY, {});
  return new Set(Array.isArray(prefs[key]?.hidden) ? prefs[key].hidden : []);
}
function saveHidden(key, set) {
  const prefs = readJSON(PREFS_KEY, {});
  if (set.size) prefs[key] = { hidden: [...set], at: Date.now() };
  else delete prefs[key];
  // Keep the preferences small: only the 80 most recent tables.
  const entries = Object.entries(prefs).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 80);
  writeJSON(PREFS_KEY, Object.fromEntries(entries));
}

/** Tables are re-created by their views on every refresh; carry the toolkit state across. */
const carry = new Map(); // wrap scope key -> state
function scopeKey(wrap, key) {
  return `${wrap.closest('[id]')?.id || ''}|${key}`;
}

/* ---------------- toolbar ---------------- */
function hasOwnSearch(wrap) {
  const scope = wrap.closest('section, .admin-panel, .rud-df-admin-grid, .rud-df-admin-body, #adminMain');
  return !!scope?.querySelector('input[type=search], .rud-df-admin-search, #managerSearch, [data-own-search]');
}

function ensureBar(wrap) {
  let bar = wrap.previousElementSibling;
  if (bar && bar.dataset?.radTablebar) return bar;
  bar = document.createElement('div');
  bar.className = 'rad-tablebar';
  bar.dataset.radTablebar = '1';
  bar.innerHTML = `
    <div class="rad-tablebar-main">
      <label class="rad-tablebar-search" hidden><span class="rad-sr">Search rows</span><input type="search" placeholder="Search rows…" data-rad-search></label>
      <div class="rad-pop-wrap"><button type="button" class="rad-tool-btn" data-rad-open="filters" aria-expanded="false"><span>Filters</span><b data-rad-filter-count hidden></b></button><div class="rad-pop" data-rad-pop="filters" hidden></div></div>
      <div class="rad-pop-wrap"><button type="button" class="rad-tool-btn" data-rad-open="columns" aria-expanded="false"><span>Columns</span></button><div class="rad-pop rad-pop-columns" data-rad-pop="columns" hidden></div></div>
      <span class="rad-tablebar-count" data-rad-count aria-live="polite"></span>
    </div>
    <div class="rad-chips" data-rad-chips hidden></div>`;
  wrap.before(bar);
  return bar;
}

function ensurePager(wrap) {
  let c = wrap.nextElementSibling;
  if (c && c.dataset?.rudPager) return c;
  c = document.createElement('div');
  c.className = 'rad-pager rud-admin-view-control';
  c.dataset.rudPager = '1';
  c.innerHTML = `<label class="rad-pager-size">Rows <select data-rud-size aria-label="Rows per page">${SIZES.map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label><div class="rad-pager-nav"><button type="button" class="rad-tool-btn" data-rud-prev aria-label="Previous page">‹ Prev</button><span data-rud-info></span><button type="button" class="rad-tool-btn" data-rud-next aria-label="Next page">Next ›</button></div>`;
  wrap.after(c);
  return c;
}

function renderFilters(bar, cols, s) {
  const pop = bar.querySelector('[data-rad-pop="filters"]');
  const usable = cols.filter((c) => c.categorical || c.isDate);
  const btn = bar.querySelector('[data-rad-open="filters"]');
  btn.hidden = !usable.length;
  if (pop.hidden) {
    pop.innerHTML = usable.length
      ? `${usable
          .map((c) => {
            const f = s.filters[c.label] || {};
            if (c.isDate)
              return `<fieldset class="rad-filter"><legend>${esc(c.label)}</legend><div class="rad-filter-range"><label>From <input type="date" data-rad-filter="${esc(c.label)}" data-kind="from" value="${esc(f.from || '')}"></label><label>To <input type="date" data-rad-filter="${esc(c.label)}" data-kind="to" value="${esc(f.to || '')}"></label></div></fieldset>`;
            return `<label class="rad-filter"><span>${esc(c.label)}</span><select data-rad-filter="${esc(c.label)}" data-kind="eq"><option value="">Any</option>${c.values.map((v) => `<option value="${esc(v)}" ${f.eq === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
          })
          .join('')}<div class="rad-pop-actions"><button type="button" class="rad-tool-btn" data-rad-clear-filters>Clear filters</button></div>`
      : '';
  }
}

function renderColumns(bar, cols, hidden) {
  const pop = bar.querySelector('[data-rad-pop="columns"]');
  if (!pop.hidden) return; // do not rebuild while the admin is using it
  pop.innerHTML = `<p class="rad-pop-title">Visible columns</p>${cols
    .map(
      (c) =>
        `<label class="rad-check${c.mandatory ? ' is-locked' : ''}"><input type="checkbox" data-rad-col="${esc(c.label)}" ${hidden.has(c.label) ? '' : 'checked'} ${c.mandatory ? 'disabled' : ''}><span>${esc(c.label)}${c.mandatory ? ' <small>required</small>' : ''}</span></label>`,
    )
    .join('')}<div class="rad-pop-actions"><button type="button" class="rad-tool-btn" data-rad-cols-all>Select all</button><button type="button" class="rad-tool-btn" data-rad-cols-reset>Reset to default</button></div>`;
}

function renderChips(bar, s) {
  const chips = bar.querySelector('[data-rad-chips]');
  const items = [];
  if (s.search) items.push(['search', `Search: “${s.search}”`]);
  for (const [label, f] of Object.entries(s.filters)) {
    if (f.eq) items.push([label, `${label}: ${f.eq}`]);
    if (f.from || f.to) items.push([label, `${label}: ${f.from || '…'} → ${f.to || '…'}`]);
  }
  chips.hidden = !items.length;
  chips.innerHTML = items.length
    ? `${items.map(([k, t]) => `<button type="button" class="rad-chip" data-rad-chip="${esc(k)}" aria-label="Remove filter ${esc(t)}">${esc(t)} <span aria-hidden="true">×</span></button>`).join('')}<button type="button" class="rad-link-btn" data-rad-clear-all>Clear all</button>`
    : '';
  const count = Object.values(s.filters).filter((f) => f.eq || f.from || f.to).length + (s.search ? 1 : 0);
  const badge = bar.querySelector('[data-rad-filter-count]');
  badge.hidden = !count;
  badge.textContent = String(count);
}

/* ---------------- apply ---------------- */
function rowMatches(tr, cols, s) {
  if (s.search && !text(tr).toLowerCase().includes(s.search.toLowerCase())) return false;
  for (const [label, f] of Object.entries(s.filters)) {
    const col = cols.find((c) => c.label === label);
    if (!col) continue;
    const v = cellText(tr, col.index);
    if (f.eq && v !== f.eq) return false;
    if (f.from || f.to) {
      const t = parseDate(v);
      if (!Number.isFinite(t)) return false;
      if (f.from && t < Date.parse(`${f.from}T00:00:00`)) return false;
      if (f.to && t > Date.parse(`${f.to}T23:59:59.999`)) return false;
    }
  }
  return true;
}

function compare(a, b, col) {
  if (col.isDate) return (parseDate(a) || 0) - (parseDate(b) || 0);
  const na = parseNum(a),
    nb = parseNum(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && /^-?[\d,.]+/.test(a) && /^-?[\d,.]+/.test(b)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function applyTable(wrap) {
  const table = wrap.querySelector('table');
  if (!table || wrap.hidden || !table.tBodies?.[0]) return;
  const cols = describe(table);
  if (!cols.length) return;
  const key = tableKey(table, cols);
  const sk = scopeKey(wrap, key);
  let s = state.get(table);
  if (!s || s.key !== key) {
    s = { ...(carry.get(sk) || { sort: null, filters: {}, search: '', page: 0 }), key };
    state.set(table, s);
  }
  carry.set(sk, s);
  const hidden = hiddenColumns(key);
  const bar = ensureBar(wrap);
  bar.querySelector('.rad-tablebar-search').hidden = hasOwnSearch(wrap);
  const searchInput = bar.querySelector('[data-rad-search]');
  if (document.activeElement !== searchInput && searchInput.value !== s.search) searchInput.value = s.search;
  renderFilters(bar, cols, s);
  renderColumns(bar, cols, hidden);
  renderChips(bar, s);

  // Column visibility: one attribute on the table, CSS hides the matching cells.
  const hideIdx = cols.filter((c) => !c.mandatory && hidden.has(c.label)).map((c) => c.index + 1);
  table.dataset.radHide = hideIdx.join(' ');
  applyColumnCss(table, hideIdx);

  // Sorting (headings become buttons for screen readers via aria-sort; click handled globally).
  headersOf(table).forEach((th, i) => {
    const col = cols[i];
    const sortable = !MANDATORY_HEAD.test(col.label) || i === 0;
    th.classList.toggle('rad-sortable', sortable && !th.querySelector('input,button'));
    if (s.sort?.index === i) th.setAttribute('aria-sort', s.sort.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
    if (sortable && !th.hasAttribute('tabindex') && !th.querySelector('input,button')) th.tabIndex = 0;
  });
  const body = table.tBodies[0];
  const all = [...body.rows].filter((r) => !isPlaceholder(r));
  if (s.sort && cols[s.sort.index]) {
    const col = cols[s.sort.index];
    const sortedRows = [...all].sort((a, b) => compare(cellText(a, col.index), cellText(b, col.index), col) * (s.sort.dir === 'asc' ? 1 : -1));
    const changed = sortedRows.some((r, i) => r !== all[i]);
    if (changed) sortedRows.forEach((r) => body.appendChild(r));
  }

  // Filtering, then paging.
  const candidates = all.filter((r) => !r.hidden);
  const visible = [];
  candidates.forEach((r) => {
    const ok = rowMatches(r, cols, s);
    r.toggleAttribute('data-rad-out', !ok);
    if (ok) visible.push(r);
  });
  const shown = visible.length;
  const total = candidates.length;
  const pager = shown > MIN_ROWS_FOR_PAGER ? ensurePager(wrap) : null;
  if (!pager) {
    const c = wrap.nextElementSibling;
    if (c?.dataset?.rudPager) c.remove();
  }
  if (pager) s.page = Math.min(Math.max(0, s.page), Math.max(0, Math.ceil(shown / pageSize) - 1));
  const start = pager ? s.page * pageSize : 0;
  visible.forEach((r, i) => r.toggleAttribute('data-rud-page-hidden', !!pager && (i < start || i >= start + pageSize)));
  candidates.filter((r) => r.hasAttribute('data-rad-out')).forEach((r) => r.removeAttribute('data-rud-page-hidden'));
  if (pager) {
    const end = Math.min(shown, start + pageSize);
    pager.querySelector('[data-rud-size]').value = String(pageSize);
    pager.querySelector('[data-rud-info]').textContent = `${shown ? start + 1 : 0}–${end} of ${shown}`;
    pager.querySelector('[data-rud-prev]').disabled = start === 0;
    pager.querySelector('[data-rud-next]').disabled = end >= shown;
  }
  // A "no matches" row when filters hide everything.
  let none = body.querySelector('tr[data-rad-none]');
  if (total && !shown) {
    if (!none) {
      none = document.createElement('tr');
      none.dataset.radNone = '1';
      none.innerHTML = `<td colspan="${cols.length}"><div class="empty-live">No rows match the current filters.</div></td>`;
      body.appendChild(none);
    }
  } else none?.remove();
  // No toolbar for a table that has no rows yet (it only holds an empty-state message).
  bar.hidden = !total && !Object.keys(s.filters).length && !s.search;
  const count = bar.querySelector('[data-rad-count]');
  count.textContent = total ? (shown === total ? `${total} row${total === 1 ? '' : 's'}` : `${shown} of ${total} rows`) : '';
}

const columnStyles = new WeakMap();
function applyColumnCss(table, hideIdx) {
  let style = columnStyles.get(table);
  const css = hideIdx.length
    ? hideIdx.map((n) => `[data-rad-tid="${tableId(table)}"] tr > :nth-child(${n}){display:none}`).join('\n')
    : '';
  if (!css) {
    style?.remove();
    columnStyles.delete(table);
    return;
  }
  if (!style || !style.isConnected) {
    style = document.createElement('style');
    style.dataset.radColumns = '1';
    table.before(style);
    columnStyles.set(table, style);
  }
  if (style.textContent !== css) style.textContent = css;
}
let tid = 0;
function tableId(table) {
  if (!table.dataset.radTid) table.dataset.radTid = `t${++tid}`;
  return table.dataset.radTid;
}

function applyAll() {
  queued = false;
  const root = document.getElementById('adminMain');
  if (!root || applying) return;
  applying = true;
  try {
    root.querySelectorAll(WRAP_SEL).forEach((wrap) => {
      if (wrap.closest('.rad-react-view')) return;
      try {
        applyTable(wrap);
      } catch (e) {
        console.warn('[admin tables]', e);
      }
    });
  } finally {
    observer?.takeRecords();
    applying = false;
  }
}
function schedule() {
  if (queued) return;
  queued = true;
  queueMicrotask(applyAll);
}

/* ---------------- events (delegated once) ---------------- */
function tableFromBar(el) {
  const bar = el.closest('[data-rad-tablebar]');
  const wrap = bar?.nextElementSibling;
  const table = wrap?.querySelector?.('table');
  return { bar, wrap, table, s: table ? state.get(table) : null };
}
function closePops(except) {
  document.querySelectorAll('#adminMain [data-rad-pop]:not([hidden])').forEach((p) => {
    if (p === except) return;
    p.hidden = true;
    p.previousElementSibling?.setAttribute('aria-expanded', 'false');
  });
}
function bindEvents() {
  const root = document.getElementById('adminApp');
  if (!root || root.dataset.radTablesBound) return;
  root.dataset.radTablesBound = '1';
  root.addEventListener('click', (e) => {
    const t = e.target;
    const open = t.closest?.('[data-rad-open]');
    if (open) {
      const pop = open.nextElementSibling;
      const willOpen = pop.hidden;
      closePops(pop);
      if (willOpen) {
        pop.hidden = true; // allow a fresh render with current values
        schedule();
        queueMicrotask(() => {
          pop.hidden = false;
          open.setAttribute('aria-expanded', 'true');
          pop.querySelector('input,select,button')?.focus();
        });
      } else {
        pop.hidden = true;
        open.setAttribute('aria-expanded', 'false');
      }
      return;
    }
    if (!t.closest?.('[data-rad-pop]')) closePops();
    const th = t.closest?.('#adminMain th.rad-sortable');
    if (th) return sortBy(th);
    const chip = t.closest?.('[data-rad-chip]');
    if (chip) {
      const { s } = tableFromBar(chip);
      if (!s) return;
      if (chip.dataset.radChip === 'search') s.search = '';
      else delete s.filters[chip.dataset.radChip];
      s.page = 0;
      return schedule();
    }
    if (t.closest?.('[data-rad-clear-all],[data-rad-clear-filters]')) {
      const { s } = tableFromBar(t);
      if (!s) return;
      s.filters = {};
      s.search = '';
      s.page = 0;
      closePops();
      return schedule();
    }
    if (t.closest?.('[data-rad-cols-all],[data-rad-cols-reset]')) {
      const { s } = tableFromBar(t);
      if (!s) return;
      saveHidden(s.key, new Set());
      closePops();
      return schedule();
    }
    const nav = t.closest?.('[data-rud-prev],[data-rud-next]');
    if (nav) {
      const wrap = nav.closest('[data-rud-pager]')?.previousElementSibling;
      const table = wrap?.querySelector?.('table');
      const s = table && state.get(table);
      if (!s) return;
      s.page = Math.max(0, s.page + (nav.hasAttribute('data-rud-prev') ? -1 : 1));
      return schedule();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.querySelector('#adminMain [data-rad-pop]:not([hidden])')) {
      closePops();
      e.stopPropagation();
    }
    const th = e.target.closest?.('#adminMain th.rad-sortable');
    if (th && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      sortBy(th);
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches?.('[data-rud-size]')) {
      const n = Number(t.value);
      if (!SIZES.includes(n)) return;
      pageSize = n;
      try {
        localStorage.setItem(SIZE_KEY, String(n));
      } catch {}
      return schedule();
    }
    if (t.matches?.('[data-rad-col]')) {
      const { s } = tableFromBar(t);
      if (!s) return;
      const hidden = hiddenColumns(s.key);
      if (t.checked) hidden.delete(t.dataset.radCol);
      else hidden.add(t.dataset.radCol);
      saveHidden(s.key, hidden);
      return schedule();
    }
    if (t.matches?.('[data-rad-filter]')) {
      const { s } = tableFromBar(t);
      if (!s) return;
      const label = t.dataset.radFilter;
      const f = { ...(s.filters[label] || {}) };
      if (t.dataset.kind === 'eq') f.eq = t.value;
      else f[t.dataset.kind] = t.value;
      if (!f.eq && !f.from && !f.to) delete s.filters[label];
      else s.filters[label] = f;
      s.page = 0;
      return schedule();
    }
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.matches?.('[data-rad-search]')) return;
    const { s } = tableFromBar(t);
    if (!s) return;
    s.search = t.value.trim();
    s.page = 0;
    schedule();
  });
}
function sortBy(th) {
  const table = th.closest('table');
  const s = table && state.get(table);
  if (!s) return;
  const index = th.cellIndex;
  s.sort = s.sort?.index === index ? (s.sort.dir === 'asc' ? { index, dir: 'desc' } : null) : { index, dir: 'asc' };
  schedule();
}

export function refreshAdminTables() {
  schedule();
}

/** Runs once when the console loads. */
export function init() {
  const n = Number(readJSON(SIZE_KEY, 25));
  if (SIZES.includes(n)) pageSize = n;
  bindEvents();
  const main = document.getElementById('adminMain');
  if (!main || observer) return;
  observer = new MutationObserver((records) => {
    if (applying) return;
    // Ignore the toolkit's own toolbars/pagers/popovers.
    if (records.every((r) => r.target.closest?.('[data-rad-tablebar],[data-rud-pager],style[data-rad-columns]'))) return;
    schedule();
  });
  observer.observe(main, { childList: true, subtree: true });
  schedule();
}
