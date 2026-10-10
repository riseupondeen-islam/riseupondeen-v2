/**
 * Small UI utilities: escaping, URL sanitising, dates, labels, toasts, busy buttons, overlay layers, favourites, sharing.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { handleRoute } from '../app/routing/router';
import { $ } from '../runtime/core';
import { notify } from '../services/ui/notify';

/* ==============================
   UTILITIES
================================ */
function esc(v = '') {
  return String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c],
  );
}
function safeUrl(v = '') {
  try {
    const u = new URL(v, location.href);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}
function millis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : 0;
}
function dateText(v) {
  if (!v) return 'Recently';
  let d;
  if (typeof v.toDate === 'function') d = v.toDate();
  else if (v.seconds) d = new Date(v.seconds * 1000);
  else d = new Date(v);
  return Number.isNaN(d.getTime())
    ? 'Recently'
    : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}
function label(t) {
  return (
    {
      hadith: 'Hadith',
      dua: 'Dua',
      reminder: 'Reminder',
      name: 'Name of Allah',
      zikr: 'Zikr',
      sadaqah: 'Sadaqah Request',
      site: 'Site Content',
    }[t] || 'Reflection'
  );
}
function excerpt(i, n = 96) {
  const x = String(i.description || i.translation || i.meaning || i.reflection || i.content || '')
    .replace(/\s+/g, ' ')
    .trim();
  return x.length > n ? x.slice(0, n).trimEnd() + '…' : x;
}
function route(i) {
  if (i.type === 'name') return '#names';
  if (i.type === 'site') return '#home';
  return i.type === 'article' ? '#home' : `#${i.type}/${i.id}`;
}
/* V3: in-app notifications are premium cards (services/ui/notify.ts). Same signature as before:
   type 'ok' (default) → success, 'error' → error; 'info' and 'warning' are also accepted. */
function toast(msg, type = 'ok', options) {
  return notify(msg, type, options);
}
function busy(btn, on, text = 'Working…') {
  if (!btn) return;
  if (on) {
    btn.dataset.original = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.original || btn.textContent;
    btn.disabled = false;
  }
}
function openLayer(id) {
  const e = document.getElementById(id);
  if (!e) return;
  e.classList.add('open');
  e.setAttribute('aria-hidden', 'false');
  document.body.classList.add('locked');
  setTimeout(() => e.querySelector('input,button,[href]')?.focus(), 50);
}
function closeLayer(id) {
  const e = document.getElementById(id);
  if (!e) return;
  const x = window.scrollX || 0,
    y = window.scrollY || 0;
  e.classList.remove('open');
  e.setAttribute('aria-hidden', 'true');
  if (id === 'searchOverlay') document.body.classList.remove('search-open', 'rud-ask-rise-open');
  if (!$('.search-overlay.open') && !$('.app-overlay.open')) document.body.classList.remove('locked');
  if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
}
function favs() {
  try {
    return JSON.parse(localStorage.getItem('rud_favorites') || '[]');
  } catch {
    return [];
  }
}
function isFav(id) {
  return favs().includes(id);
}
function toggleFav(id) {
  const s = new Set(favs());
  if (s.has(id)) {
    s.delete(id);
    toast('Removed from saved content.');
  } else {
    s.add(id);
    toast('Saved to your collection.');
  }
  localStorage.setItem('rud_favorites', JSON.stringify([...s]));
  handleRoute();
}
async function shareItem(i) {
  const url = `${location.origin}${location.pathname}${route(i)}`;
  try {
    if (navigator.share) await navigator.share({ title: i.title || label(i.type), text: excerpt(i, 100), url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard.');
    }
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Unable to share this content.', 'error');
  }
}
function paragraphs(t = '') {
  return String(t)
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
function sorted(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
}

/* Safe download file name (used by poster export and admin uploads). */
function safeFileName(name = 'file') {
  return (
    String(name)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 120) || 'file'
  );
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export {
  busy,
  closeLayer,
  dateText,
  esc,
  excerpt,
  favs,
  isFav,
  label,
  millis,
  openLayer,
  paragraphs,
  route,
  safeFileName,
  safeUrl,
  shareItem,
  sorted,
  toast,
  toggleFav,
};
