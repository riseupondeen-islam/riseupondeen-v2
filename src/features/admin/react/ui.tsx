/* Shared React building blocks for the Admin Console views: page header, stat tiles, an accessible
 * confirmation dialog, a data table (search, value/date filters, column chooser, sorting, paging)
 * and dependency-free SVG charts. Styling lives in ../styles/admin-console.css (rad-* classes). */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AdminIcon } from '../components/AdminIcon';

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

export function StatTile({
  label,
  value,
  meta,
  icon,
  loading,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  icon?: string;
  loading?: boolean;
}) {
  return (
    <article className="rad-stat" aria-busy={loading ? 'true' : undefined}>
      {icon ? (
        <span className="rad-stat-icon">
          <AdminIcon name={icon} size={16} />
        </span>
      ) : null}
      <small>{label}</small>
      {loading ? <span className="rad-skeleton" style={{ height: 30, width: '60%', display: 'block' }} /> : <strong>{value}</strong>}
      {meta ? <span>{meta}</span> : null}
    </article>
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

/* ---------------------------------------------------------------- charts */

const niceMax = (v: number) => {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/** Line/area chart for daily series. `labels[i]` names point i; up to two series. */
export function LineChart({
  labels,
  series,
  height = 220,
  ariaLabel,
}: {
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
  height?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 10, t: 12, b: 26 };
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const step = Math.max(1, Math.ceil(n / 7));
  return (
    <div className="rad-chart-wrap">
      <svg aria-label={ariaLabel} className="rad-chart" role="img" viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="rad-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text textAnchor="end" x={pad.l - 6} y={y(t) + 3}>
              {Math.round(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={l + i} textAnchor="middle" x={x(i)} y={H - 8}>
              {l}
            </text>
          ) : null,
        )}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          const area = `${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}`;
          return (
            <g key={s.name}>
              <polygon className={si ? 'rad-area-b' : 'rad-area-a'} points={area} />
              <polyline className={`rad-line ${si ? 'rad-series-b' : 'rad-series-a'}`} points={pts} style={{ fill: 'none' }} />
            </g>
          );
        })}
        {hover !== null ? <line className="rad-cursor" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} /> : null}
        {hover !== null
          ? series.map((s, si) => <circle className={si ? 'rad-series-b' : 'rad-series-a'} cx={x(hover)} cy={y(s.values[hover] || 0)} key={s.name} r={3.5} />)
          : null}
        {labels.map((l, i) => (
          <rect
            className="rad-hit"
            height={H - pad.t - pad.b}
            key={`hit${l}${i}`}
            onMouseEnter={() => setHover(i)}
            width={(W - pad.l - pad.r) / Math.max(1, n - 1)}
            x={x(i) - (W - pad.l - pad.r) / Math.max(1, n - 1) / 2}
            y={pad.t}
          />
        ))}
      </svg>
      {hover !== null ? (
        <div className="rad-chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(pad.t / H) * 100}%` }}>
          <div>{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name}>
              {s.name}: <b>{s.values[hover] ?? 0}</b>
            </div>
          ))}
        </div>
      ) : null}
      {series.length > 1 ? (
        <div className="rad-legend">
          {series.map((s, i) => (
            <span key={s.name}>
              <i className={i ? 'b' : 'a'} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Vertical bar chart (e.g. per-day counts). */
export function ColumnChart({
  labels,
  values,
  height = 200,
  ariaLabel,
  name,
}: {
  labels: string[];
  values: number[];
  height?: number;
  ariaLabel: string;
  name: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 8, t: 12, b: 26 };
  const max = niceMax(Math.max(1, ...values));
  const n = Math.max(1, values.length);
  const slot = (W - pad.l - pad.r) / n;
  const bw = Math.max(4, Math.min(26, slot * 0.62));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const step = Math.max(1, Math.ceil(n / 7));
  return (
    <div className="rad-chart-wrap">
      <svg aria-label={ariaLabel} className="rad-chart" role="img" viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHover(null)}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line className="rad-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text textAnchor="end" x={pad.l - 6} y={y(t) + 3}>
              {Math.round(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={labels[i] + i} onMouseEnter={() => setHover(i)}>
              <rect className="rad-hit" height={H - pad.t - pad.b} width={slot} x={pad.l + slot * i} y={pad.t} />
              <rect
                className="rad-bar rad-series-a"
                height={Math.max(v ? 2 : 0, y(0) - y(v))}
                opacity={hover === null || hover === i ? 1 : 0.55}
                rx={3}
                width={bw}
                x={cx - bw / 2}
                y={y(v)}
              />
              {i % step === 0 || i === n - 1 ? (
                <text textAnchor="middle" x={cx} y={H - 8}>
                  {labels[i]}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover !== null ? (
        <div className="rad-chart-tip" style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%`, top: `${(y(values[hover]) / H) * 100}%` }}>
          <div>{labels[hover]}</div>
          <div>
            {name}: <b>{values[hover]}</b>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal ranked bars (top routes, categories, statuses…). */
export function RankBars({ items, empty = 'No data yet.' }: { items: Array<{ label: string; value: number; meta?: string }>; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <div>
      {items.map((i) => (
        <div className="rad-bar-row" key={i.label}>
          <span>{i.label}</span>
          <b>
            {i.value.toLocaleString()}
            {i.meta ? <small className="rad-muted"> {i.meta}</small> : null}
          </b>
          <span className="rad-bar-track" aria-hidden="true">
            <span className="rad-bar-fill" style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
        </div>
      ))}
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
