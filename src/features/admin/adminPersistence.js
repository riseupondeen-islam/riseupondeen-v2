/**
 * Local persistence for the admin console: cached content list, editor drafts and bulk-import previews.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { renderEditorPreview } from './views/contentEditor';
import { $ } from '../../runtime/core';

let ADMIN_CACHE_KEY, ADMIN_DRAFT_KEY, BULK_CACHE_KEY;

function cacheAdminContent(items) {
  try {
    const clean = (items || []).map((x) => {
      const o = { ...x };
      // Firestore Timestamp values are not needed for the offline cache.
      if (o.createdAt?.toDate) o.createdAt = o.createdAt.toDate().toISOString();
      if (o.updatedAt?.toDate) o.updatedAt = o.updatedAt.toDate().toISOString();
      return o;
    });
    localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(clean));
  } catch (e) {
    console.warn('Admin cache unavailable', e);
  }
}
function readAdminCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(ADMIN_CACHE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function saveEditorDraft() {
  if (S.editingId) return; // existing records already persist in Firestore
  const form = $('#contentForm');
  if (!form) return;
  try {
    const fields = {};
    form.querySelectorAll('input,textarea,select').forEach((el) => {
      if (!el.id || el.type === 'file') return;
      fields[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    localStorage.setItem(
      ADMIN_DRAFT_KEY,
      JSON.stringify({
        type: $('#fType')?.value || window.__rudType || 'article',
        fields,
        savedAt: Date.now(),
      }),
    );
  } catch (e) {
    console.warn('Draft autosave unavailable', e);
  }
}
function readEditorDraft(type) {
  try {
    const d = JSON.parse(localStorage.getItem(ADMIN_DRAFT_KEY) || 'null');
    if (!d || d.type !== type || !d.fields) return null;
    return d;
  } catch {
    return null;
  }
}
function clearEditorDraft() {
  try {
    localStorage.removeItem(ADMIN_DRAFT_KEY);
  } catch {}
}
function restoreEditorDraft(type) {
  if (S.editingId) return false;
  const draft = readEditorDraft(type);
  if (!draft) return false;
  Object.entries(draft.fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value ?? '';
  });
  $('#publishState').textContent = $('#fPublished')?.checked ? 'Published' : 'Draft';
  renderEditorPreview();
  return true;
}
function cacheBulkRows() {
  try {
    const raw = JSON.stringify({ rows: S.bulkRows, preset: S.bulkPresetType, savedAt: Date.now() });
    // Avoid filling localStorage with an extremely large spreadsheet.
    if (raw.length < 3000000) localStorage.setItem(BULK_CACHE_KEY, raw);
  } catch (e) {
    console.warn('Bulk preview cache unavailable', e);
  }
}
function restoreBulkRows() {
  try {
    const c = JSON.parse(localStorage.getItem(BULK_CACHE_KEY) || 'null');
    if (!c || !Array.isArray(c.rows)) return false;
    S.bulkRows = c.rows;
    if (!S.bulkPresetType && c.preset) S.bulkPresetType = c.preset;
    return !!S.bulkRows.length;
  } catch {
    return false;
  }
}
function clearBulkCache() {
  try {
    localStorage.removeItem(BULK_CACHE_KEY);
  } catch {}
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  /* ==============================
   ADMIN PERSISTENCE
================================ */
  ADMIN_CACHE_KEY = 'rud_admin_content_cache_v1';
  ADMIN_DRAFT_KEY = 'rud_admin_editor_draft_v1';
  BULK_CACHE_KEY = 'rud_admin_bulk_preview_v1';
}

export {
  cacheAdminContent,
  cacheBulkRows,
  clearBulkCache,
  clearEditorDraft,
  readAdminCache,
  restoreBulkRows,
  restoreEditorDraft,
  saveEditorDraft,
};
