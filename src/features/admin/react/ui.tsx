/* Shared React building blocks for the Admin Console views: page header, cards, an accessible
 * confirmation dialog and a data table (search, value/date filters, column chooser, sorting, paging).
 * Styling lives in ../styles/admin-console.css (rad-* classes). */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

/* ---------------------------------------------------------------- layout */

export function PageHead({
  kicker,
  title,
  description,
  actions,
}: {
  kicker?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="rad-page-head">
      <div>
        {kicker ? <span className="rad-kicker">{kicker}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="rad-head-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rad-card ${className}`}>
      {title || actions ? (
        <div className="rad-card-title">
          <div>
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="rad-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rad-empty">{children}</div>;
}

export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return (
    <p className="rad-loading" role="status">
      {children}
    </p>
  );
}

/* ---------------------------------------------------------------- dialog */

/**
 * Confirmation dialog. With `typed`, the confirm button stays disabled until that exact text is
 * entered (used for destructive or wide-reaching actions). Escape and the backdrop cancel.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel = 'Working…',
  danger,
  typed,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  typed?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const titleId = useId();
  const bodyId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const ok = !typed || text.trim().toLowerCase() === typed.trim().toLowerCase();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, button:not([disabled])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onCancel();
      }
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>('input, button:not([disabled]), textarea, select')];
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, [busy, onCancel]);
  return (
    <div className="rad-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        aria-describedby={bodyId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`rad-dialog${danger ? ' is-danger' : ''}`}
        ref={ref}
        role="alertdialog"
      >
        <h2 id={titleId}>{title}</h2>
        <div id={bodyId} className="rad-dialog-body">
          {children}
        </div>
        {typed ? (
          <label className="rad-field">
            <span>
              Type <b>{typed}</b> to confirm
            </span>
            <input
              autoComplete="off"
              className="rad-input"
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              value={text}
            />
          </label>
        ) : null}
        <div className="rad-dialog-actions">
          <button className="rad-btn" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className={`rad-btn ${danger ? 'rad-btn-danger' : 'rad-btn-primary'}${busy ? ' is-busy' : ''}`}
            disabled={!ok || busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- data table */

export interface Column<T> {
  key: string;
  label: string;
  /** Cell content. */
  render: (row: T) => ReactNode;
  /** Plain value used for search, filters and sorting. */
  value?: (row: T) => string | number;
  /** 'select' → value filter built from the loaded rows; 'date' → from/to range (value must be ms). */
  filter?: 'select' | 'date';
  mandatory?: boolean;
  defaultHidden?: boolean;
  sortable?: boolean;
  align?: 'right';
}

const PREFS = 'rud_admin_table_prefs_v1';
function readHidden(id: string): string[] | null {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS) || '{}');
    return Array.isArray(prefs[`react:${id}`]?.hidden) ? prefs[`react:${id}`].hidden : null;
  } catch {
    return null;
  }
}
function writeHidden(id: string, hidden: string[] | null) {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS) || '{}');
    if (hidden) prefs[`react:${id}`] = { hidden, at: Date.now() };
    else delete prefs[`react:${id}`];
    localStorage.setItem(PREFS, JSON.stringify(prefs));
  } catch {
    /* preferences are optional */
  }
}
const dayStart = (d: string) => (d ? Date.parse(`${d}T00:00:00`) : NaN);
const dayEnd = (d: string) => (d ? Date.parse(`${d}T23:59:59.999`) : NaN);

export function DataTable<T>({
  id,
  columns,
  rows,
  rowKey,
  empty = 'No records yet.',
  searchPlaceholder = 'Search…',
  toolbar,
  pageSize: initialSize = 25,
}: {
  id: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  pageSize?: number;
}) {
  const defaultsHidden = useMemo(() => columns.filter((c) => c.defaultHidden).map((c) => c.key), [columns]);
  const [hidden, setHidden] = useState<string[]>(() => readHidden(id) ?? defaultsHidden);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, { eq?: string; from?: string; to?: string }>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(initialSize);
  const [open, setOpen] = useState<'' | 'filters' | 'columns'>('');
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !barRef.current?.contains(e.target as Node)) setOpen('');
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const valueOf = (c: Column<T>, r: T) => (c.value ? c.value(r) : '');
  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns)
      if (c.filter === 'select') out[c.key] = [...new Set(rows.map((r) => String(valueOf(c, r))).filter(Boolean))].sort();
    return out;
  }, [columns, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (q && !columns.some((c) => String(valueOf(c, r)).toLowerCase().includes(q))) return false;
      for (const [key, f] of Object.entries(filters)) {
        const c = columns.find((x) => x.key === key);
        if (!c) continue;
        const v = valueOf(c, r);
        if (f.eq && String(v) !== f.eq) return false;
        if (f.from && !(Number(v) >= dayStart(f.from))) return false;
        if (f.to && !(Number(v) <= dayEnd(f.to))) return false;
      }
      return true;
    });
    if (sort) {
      const c = columns.find((x) => x.key === sort.key);
      if (c)
        list = [...list].sort((a, b) => {
          const va = valueOf(c, a),
            vb = valueOf(c, b);
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
          return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * sort.dir;
        });
    }
    return list;
  }, [rows, search, filters, sort, columns]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, pages - 1);
  const visibleRows = filtered.slice(current * size, current * size + size);
  const shownColumns = columns.filter((c) => c.mandatory || !hidden.includes(c.key));
  const activeCount = Object.values(filters).filter((f) => f.eq || f.from || f.to).length + (search ? 1 : 0);
  const filterable = columns.filter((c) => c.filter);

  const setHiddenAndSave = (next: string[] | null) => {
    setHidden(next ?? defaultsHidden);
    writeHidden(id, next);
  };
  const setFilter = (key: string, patch: { eq?: string; from?: string; to?: string }) => {
    setPage(0);
    setFilters((prev) => {
      const next = { ...prev, [key]: { ...prev[key], ...patch } };
      if (!next[key].eq && !next[key].from && !next[key].to) delete next[key];
      return next;
    });
  };

  return (
    <div className="rad-datatable">
      <div className="rad-tablebar" ref={barRef}>
        <div className="rad-tablebar-main">
          <label className="rad-tablebar-search">
            <span className="rad-sr">Search</span>
            <input
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder}
              type="search"
              value={search}
            />
          </label>
          {filterable.length ? (
            <div className="rad-pop-wrap">
              <button
                aria-expanded={open === 'filters'}
                className="rad-tool-btn"
                onClick={() => setOpen(open === 'filters' ? '' : 'filters')}
                type="button"
              >
                <span>Filters</span>
                {activeCount ? <b>{activeCount}</b> : null}
              </button>
              {open === 'filters' ? (
                <div className="rad-pop" role="dialog" aria-label="Filters">
                  {filterable.map((c) =>
                    c.filter === 'date' ? (
                      <fieldset className="rad-filter" key={c.key}>
                        <legend>{c.label}</legend>
                        <div className="rad-filter-range">
                          <label>
                            From
                            <input onChange={(e) => setFilter(c.key, { from: e.target.value })} type="date" value={filters[c.key]?.from || ''} />
                          </label>
                          <label>
                            To
                            <input onChange={(e) => setFilter(c.key, { to: e.target.value })} type="date" value={filters[c.key]?.to || ''} />
                          </label>
                        </div>
                      </fieldset>
                    ) : (
                      <label className="rad-filter" key={c.key}>
                        <span>{c.label}</span>
                        <select onChange={(e) => setFilter(c.key, { eq: e.target.value })} value={filters[c.key]?.eq || ''}>
                          <option value="">Any</option>
                          {(options[c.key] || []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </label>
                    ),
                  )}
                  <div className="rad-pop-actions">
                    <button className="rad-tool-btn" onClick={() => (setFilters({}), setSearch(''), setPage(0))} type="button">
                      Clear filters
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="rad-pop-wrap">
            <button
              aria-expanded={open === 'columns'}
              className="rad-tool-btn"
              onClick={() => setOpen(open === 'columns' ? '' : 'columns')}
              type="button"
            >
              Columns
            </button>
            {open === 'columns' ? (
              <div className="rad-pop rad-pop-columns" role="dialog" aria-label="Visible columns">
                <p className="rad-pop-title">Visible columns</p>
                {columns.map((c) => (
                  <label className={`rad-check${c.mandatory ? ' is-locked' : ''}`} key={c.key}>
                    <input
                      checked={c.mandatory || !hidden.includes(c.key)}
                      disabled={c.mandatory}
                      onChange={(e) =>
                        setHiddenAndSave(e.target.checked ? hidden.filter((k) => k !== c.key) : [...hidden, c.key])
                      }
                      type="checkbox"
                    />
                    <span>
                      {c.label}
                      {c.mandatory ? <small> required</small> : null}
                    </span>
                  </label>
                ))}
                <div className="rad-pop-actions">
                  <button className="rad-tool-btn" onClick={() => setHiddenAndSave([])} type="button">
                    Select all
                  </button>
                  <button className="rad-tool-btn" onClick={() => setHiddenAndSave(null)} type="button">
                    Reset to default
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {toolbar}
          <span aria-live="polite" className="rad-tablebar-count">
            {filtered.length === rows.length ? `${rows.length} row${rows.length === 1 ? '' : 's'}` : `${filtered.length} of ${rows.length} rows`}
          </span>
        </div>
        {activeCount ? (
          <div className="rad-chips">
            {search ? (
              <button className="rad-chip" onClick={() => setSearch('')} type="button">
                Search: “{search}” <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {Object.entries(filters).map(([key, f]) => {
              const c = columns.find((x) => x.key === key);
              if (!c) return null;
              const label = f.eq ? `${c.label}: ${f.eq}` : `${c.label}: ${f.from || '…'} → ${f.to || '…'}`;
              return (
                <button className="rad-chip" key={key} onClick={() => setFilter(key, { eq: '', from: '', to: '' })} type="button">
                  {label} <span aria-hidden="true">×</span>
                </button>
              );
            })}
            <button className="rad-link-btn" onClick={() => (setFilters({}), setSearch(''))} type="button">
              Clear all
            </button>
          </div>
        ) : null}
      </div>
      <div className="rad-table-wrap">
        <table>
          <thead>
            <tr>
              {shownColumns.map((c) => {
                const sortable = c.sortable !== false && !!c.value;
                const dir = sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined;
                return (
                  <th
                    aria-sort={dir}
                    className={sortable ? 'rad-sortable' : undefined}
                    key={c.key}
                    onClick={
                      sortable
                        ? () =>
                            setSort((s) => (s?.key !== c.key ? { key: c.key, dir: 1 } : s.dir === 1 ? { key: c.key, dir: -1 } : null))
                        : undefined
                    }
                    onKeyDown={
                      sortable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              (e.currentTarget as HTMLElement).click();
                            }
                          }
                        : undefined
                    }
                    style={c.align === 'right' ? { textAlign: 'right' } : undefined}
                    tabIndex={sortable ? 0 : undefined}
                  >
                    {c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length ? (
              visibleRows.map((r) => (
                <tr key={rowKey(r)}>
                  {shownColumns.map((c) => (
                    <td key={c.key} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={shownColumns.length}>
                  <div className="empty-live">{rows.length ? 'No rows match the current filters.' : empty}</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > 10 ? (
        <div className="rad-pager">
          <label className="rad-pager-size">
            Rows
            <select
              aria-label="Rows per page"
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(0);
              }}
              value={size}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="rad-pager-nav">
            <button className="rad-tool-btn" disabled={current === 0} onClick={() => setPage(current - 1)} type="button">
              ‹ Prev
            </button>
            <span>
              {current * size + 1}–{Math.min(filtered.length, current * size + size)} of {filtered.length}
            </span>
            <button className="rad-tool-btn" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} type="button">
              Next ›
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

export const fmtDateTime = (ms: number) =>
  ms ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '—';
export const fmtDate = (ms: number) => (ms ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(ms)) : '—');

/** A short random id for idempotent requests (generated once per composed action). */
export function requestId(prefix: string): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Date.now().toString(36)}_${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)}`;
}
