/**
 * Published-content cache (localStorage + Cache Storage snapshot) and de-duplication.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { millis } from '../../utils/ui';

let PUBLIC_CACHE_KEY, PUBLIC_SHARED_CACHE, PUBLIC_SHARED_CACHE_URL, PUBLIC_REVALIDATE_MS;

function rudSerializablePublicItems(items) {
  return (Array.isArray(items) ? items : []).map((i) => {
    const x = { ...i };
    if (x.createdAt?.toMillis) x.createdAt = { seconds: Math.floor(x.createdAt.toMillis() / 1000) };
    if (x.updatedAt?.toMillis) x.updatedAt = { seconds: Math.floor(x.updatedAt.toMillis() / 1000) };
    if (x.scheduledAt?.toMillis) x.scheduledAt = { seconds: Math.floor(x.scheduledAt.toMillis() / 1000) };
    return x;
  });
}
/* Global content-integrity layer: identical published content is rendered once.
   Arabic diacritics, tatweel, zero-width characters, punctuation and spacing are
   normalized so cosmetic variations cannot create visible duplicates. */
function rudNormalizeContentKey(v) {
  return String(v ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u0640]/g, '')
    .replace(/[\u0610-\u061A\u06D6-\u06ED]/g, '')
    .replace(/[“”‘’`´]/g, "'")
    .replace(/[\s\u2000-\u200A]+/g, ' ')
    .replace(/\s*([،,.;:!?؟])\s*/g, '$1')
    .trim()
    .toLocaleLowerCase();
}
function rudContentIntegrityKey(x) {
  if (!x) return '';
  const type = String(x.type || '').toLowerCase();
  const arabic = rudNormalizeContentKey(x.arabic || x.ar || '');
  const title = rudNormalizeContentKey(x.title || x.transliteration || x.tr || x.name || '');
  const meaning = rudNormalizeContentKey(
    x.meaning || x.translation || x.content || x.reflection || x.description || '',
  );
  const reference = rudNormalizeContentKey(x.reference || x.source || '');
  if (type === 'name') {
    const number = Number(x.number ?? x.displayOrder);
    return `name|${Number.isFinite(number) && number > 0 ? number : ''}|${arabic}|${title}`;
  }
  if (type === 'zikr') return `zikr|${arabic}|${title}|${meaning}`;
  if (type === 'hadith') return `hadith|${reference}|${arabic}|${meaning}|${title}`;
  if (type === 'dua') return `dua|${arabic}|${title}|${meaning}|${reference}`;
  if (type === 'reminder') return `reminder|${title}|${meaning}|${reference}`;
  if (type === 'article') return `article|${title}|${meaning}`;
  return `${type}|${arabic}|${title}|${meaning}|${reference}`;
}
function rudDeduplicateContent(items, { publishedOnly = false } = {}) {
  const out = [],
    seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    if (publishedOnly && item.published !== true) continue;
    const key = rudContentIntegrityKey(item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(item);
  }
  return out;
}
function rudPublicVersion(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (max, item) => Math.max(max, millis(item?.updatedAt), millis(item?.createdAt)),
    0,
  );
}
function cachePublicContent(items) {
  try {
    const clean = rudSerializablePublicItems(rudDeduplicateContent(items, { publishedOnly: true }));
    const payload = { items: clean, savedAt: Date.now(), version: rudPublicVersion(clean), complete: true };
    const json = JSON.stringify(payload);
    localStorage.setItem(PUBLIC_CACHE_KEY, json);

    /* Persist the same complete published snapshot in origin Cache Storage.
       This survives the browser -> installed Home Screen handoff better than
       relying on localStorage alone, especially on the first standalone launch. */
    if ('caches' in window) {
      caches
        .open(PUBLIC_SHARED_CACHE)
        .then((cache) =>
          cache.put(
            PUBLIC_SHARED_CACHE_URL,
            new Response(json, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }),
          ),
        )
        .catch(() => {});
    }
  } catch (e) {
    console.warn('Public cache unavailable', e);
  }
}
function readPublicCache() {
  try {
    const c = JSON.parse(localStorage.getItem(PUBLIC_CACHE_KEY) || 'null');
    if (!c || !Array.isArray(c.items)) return { items: [], complete: false };
    const items = rudDeduplicateContent(c.items, { publishedOnly: true });
    return {
      items,
      complete: c.complete === true,
      savedAt: Number(c.savedAt) || 0,
      version: Number(c.version) || rudPublicVersion(items),
    };
  } catch {
    return { items: [], complete: false, savedAt: 0, version: 0 };
  }
}
async function readSharedPublicCache() {
  try {
    if (!('caches' in window)) return { items: [], complete: false, savedAt: 0, version: 0 };
    const cache = await caches.open(PUBLIC_SHARED_CACHE);
    const response = await cache.match(PUBLIC_SHARED_CACHE_URL);
    if (!response) return { items: [], complete: false, savedAt: 0, version: 0 };
    const c = await response.json();
    if (!c || !Array.isArray(c.items)) return { items: [], complete: false, savedAt: 0, version: 0 };
    const items = rudDeduplicateContent(c.items, { publishedOnly: true });
    return {
      items,
      complete: c.complete === true,
      savedAt: Number(c.savedAt) || 0,
      version: Number(c.version) || rudPublicVersion(items),
    };
  } catch {
    return { items: [], complete: false, savedAt: 0, version: 0 };
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  PUBLIC_CACHE_KEY = 'rud_public_firestore_v2';
  PUBLIC_SHARED_CACHE = 'rud_public_snapshot_v2';
  PUBLIC_SHARED_CACHE_URL = '/__rud_public_snapshot_v2__.json';
  PUBLIC_REVALIDATE_MS = 30 * 60 * 1000;
}

export {
  PUBLIC_CACHE_KEY,
  PUBLIC_REVALIDATE_MS,
  PUBLIC_SHARED_CACHE,
  cachePublicContent,
  readPublicCache,
  readSharedPublicCache,
  rudDeduplicateContent,
};
