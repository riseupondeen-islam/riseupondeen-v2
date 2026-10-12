/**
 * Admin › Manage content tables: search, filters, publish/feature toggles, bulk delete.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../../runtime/store';
import { clearBulkCache } from '../adminPersistence';
import { renderAdminView } from '../adminViews';
import { bulkUploadView, readBulkFile } from './bulkUpload';
import { openEditor } from './contentEditor';
import { preview } from './contentPreview';
import { $, $$, COLLECTION } from '../../../runtime/core';
import { collection, doc, serverTimestamp, updateDoc, writeBatch } from '../../../services/firebase/sdk';
import { busy, closeLayer, dateText, esc, label, openLayer, toast } from '../../../utils/ui';

/* Search, filters and bulk-selection survive live refreshes (a publish/feature toggle or any other
   content change re-renders the table): previously every refresh reset them. */
const managerMemory = new Map();
const pendingToggles = new Set();

function manager(opts = {}) {
  const memoryKey = opts.type || (opts.featured ? 'featured' : 'all');
  const remembered = opts.live ? managerMemory.get(memoryKey) : null;
  const isSadaqah = opts.type === 'sadaqah';
  const headerTitle = opts.title || 'Manage Content';
  const headerCopy = isSadaqah
    ? 'Manage direct Sadaqah requests. Active requests appear publicly; fulfilled or inactive requests do not.'
    : opts.type
      ? `Manage your ${label(opts.type)} library. Saved content remains securely stored in Firestore.`
      : 'Create, edit, publish and organize your verified Islamic content.';
  let selectionMode = !!remembered?.selectionMode;
  const selected = new Set(remembered?.selected || []);
  let type = remembered?.type || opts.type || 'all',
    status = remembered?.status || 'all',
    search = remembered?.search || '';
  const remember = () => managerMemory.set(memoryKey, { selectionMode, selected: [...selected], type, status, search });

  $('#adminMain').innerHTML = `
    <div class="admin-head"><div><h1>${esc(headerTitle)}</h1><p>${esc(headerCopy)}</p></div><div class="manager-page-actions"><button class="premium-btn primary" id="newContent">${isSadaqah ? '+ Add Request' : '+ Create Content'}</button>${isSadaqah ? '' : '<button class="premium-btn admin-upload-page-btn" id="pageUploadFile">Upload File</button>'}<button class="premium-btn admin-delete-page-btn" id="pageDeleteEntries">Delete Entries</button></div></div><div class="admin-persist-note">${isSadaqah ? 'Only the display name, short need, UPI ID and verification date are intended for public display.' : 'Published items and saved drafts are stored in Firebase and return when you sign in again.'}</div>${opts.type && !isSadaqah ? `<section class="admin-panel admin-inline-upload"><div class="admin-inline-upload-copy"><span class="eyebrow">FILE IMPORT</span><h3>Upload ${esc(label(opts.type))} File</h3><p>Choose Excel/CSV here. If you select the complete workbook, only ${esc(label(opts.type))} rows will be loaded.</p></div><label class="admin-inline-upload-field" for="managerQuickUpload"><input id="managerQuickUpload" type="file" accept=".xlsx,.xls,.csv" hidden><span class="upload-icon">↑</span><span><strong>Choose ${esc(label(opts.type))} Excel / CSV</strong><small>Preview before importing to Firebase</small></span></label></section>` : ''}<div class="bulk-delete-toolbar" id="bulkDeleteToolbar" hidden><div class="bulk-delete-status"><span id="bulkDeleteCount">0 entries selected</span></div><div class="bulk-delete-actions"><button type="button" id="selectVisibleEntries">Select visible</button><button type="button" id="clearSelectedEntries">Clear</button><button type="button" class="danger" id="deleteSelectedEntries">Delete selected</button><button type="button" id="cancelBulkDelete">Cancel</button></div></div><section class="admin-panel"><div class="manager-toolbar"><input class="input" style="flex:1;min-width:220px" id="managerSearch" type="search" placeholder="Search content…"><div class="filter-row">
          ${!opts.type && !opts.featured ? `<button class="filter-chip active" data-mtype="all">All</button><button class="filter-chip" data-mtype="hadith">Hadith</button><button class="filter-chip" data-mtype="dua">Duas</button><button class="filter-chip" data-mtype="reminder">Reminders</button><button class="filter-chip" data-mtype="name">Names</button><button class="filter-chip" data-mtype="zikr">Zikr</button>` : ''}
          <button class="filter-chip active" data-mstatus="all">All Status</button><button class="filter-chip" data-mstatus="published">${isSadaqah ? 'Active' : 'Published'}</button><button class="filter-chip" data-mstatus="draft">${isSadaqah ? 'Inactive' : 'Draft'}</button></div></div><div class="table-wrap"><table><thead id="managerHead"></thead><tbody id="managerBody"></tbody></table></div></section>`;

  const currentList = () => {
    let list = S.adminContent.filter((x) => x.type !== 'site' && x.type !== 'article');
    if (opts.featured) list = list.filter((x) => x.featured);
    if (type !== 'all') list = list.filter((x) => x.type === type);
    if (status === 'published') list = list.filter((x) => x.published);
    if (status === 'draft') list = list.filter((x) => !x.published);
    if (search)
      list = list.filter((x) =>
        [x.title, x.category, x.type, x.keywords].filter(Boolean).join(' ').toLowerCase().includes(search),
      );
    return list;
  };

  const updateSelection = () => {
    const n = selected.size;
    $('#bulkDeleteCount').textContent = `${n} ${n === 1 ? 'entry' : 'entries'} selected`;
    const del = $('#deleteSelectedEntries');
    if (del) del.disabled = !n;
  };

  const draw = () => {
    remember();
    const list = currentList();
    if (isSadaqah) {
      $('#managerHead').innerHTML =
        `<tr>${selectionMode ? '<th class="bulk-select-cell"><input id="bulkSelectAll" type="checkbox" aria-label="Select all visible entries"></th>' : ''}<th>Display Name</th><th>UPI ID</th><th>Status</th><th>Verified / Updated</th><th>Actions</th></tr>`;
      $('#managerBody').innerHTML = list.length
        ? list
            .map(
              (i) =>
                `<tr>${selectionMode ? `<td class="bulk-select-cell"><input class="bulk-entry-check" type="checkbox" data-select-entry="${i.id}" ${selected.has(i.id) ? 'checked' : ''} aria-label="Select ${esc(i.title || 'Sadaqah request')}"></td>` : ''}<td><strong>${esc(i.title || 'Sadaqah Request')}</strong><div class="muted" style="font-size:11px;margin-top:4px">${esc((i.description || '').slice(0, 90))}</div></td><td>${esc(i.upiId || '—')}</td><td><span class="status-pill ${i.published && !i.fulfilled ? 'live' : ''}">${i.fulfilled ? 'Fulfilled' : i.published ? 'Active' : 'Inactive'}</span></td><td>${esc(i.verifiedDate || '—')}</td><td><div class="table-actions"><button class="mini-action" data-edit="${i.id}">Edit</button><button class="mini-action" data-publish="${i.id}">${i.published && !i.fulfilled ? 'Deactivate' : 'Activate'}</button><button class="mini-action" data-fulfill="${i.id}">${i.fulfilled ? 'Reopen' : 'Mark Fulfilled'}</button><button class="mini-action" data-delete="${i.id}">Delete</button></div></td></tr>`,
            )
            .join('')
        : `<tr><td colspan="${selectionMode ? 6 : 5}"><div class="empty-live">No Sadaqah requests found.</div></td></tr>`;
    } else {
      $('#managerHead').innerHTML =
        `<tr>${selectionMode ? '<th class="bulk-select-cell"><input id="bulkSelectAll" type="checkbox" aria-label="Select all visible entries"></th>' : ''}<th>Title</th><th>Type</th><th>Category</th><th>Status</th><th>Featured</th><th>Published Date</th><th>Actions</th></tr>`;
      $('#managerBody').innerHTML = list.length
        ? list
            .map(
              (i) =>
                `<tr>${selectionMode ? `<td class="bulk-select-cell"><input class="bulk-entry-check" type="checkbox" data-select-entry="${i.id}" ${selected.has(i.id) ? 'checked' : ''} aria-label="Select ${esc(i.title || label(i.type))}"></td>` : ''}<td><strong>${esc(i.title || label(i.type))}</strong></td><td>${esc(label(i.type))}</td><td>${esc(i.category || 'General')}</td><td><span class="status-pill ${i.published ? 'live' : ''}">${i.published ? 'Published' : 'Draft'}</span></td><td>${i.featured ? 'Yes' : 'No'}</td><td>${esc(dateText(i.createdAt))}</td><td><div class="table-actions"><button class="mini-action" data-view="${i.id}">View</button><button class="mini-action" data-edit="${i.id}">Edit</button><button class="mini-action" data-feature="${i.id}">${i.featured ? 'Unfeature' : 'Feature'}</button><button class="mini-action" data-publish="${i.id}">${i.published ? 'Unpublish' : 'Publish'}</button><button class="mini-action" data-delete="${i.id}">Delete</button></div></td></tr>`,
            )
            .join('')
        : `<tr><td colspan="${selectionMode ? 8 : 7}"><div class="empty-live">No entries found.</div></td></tr>`;
    }

    bindManagerActions();

    $$('[data-select-entry]').forEach((box) =>
      box.addEventListener('change', () => {
        box.checked ? selected.add(box.dataset.selectEntry) : selected.delete(box.dataset.selectEntry);
        updateSelection();
      }),
    );

    $('#bulkSelectAll')?.addEventListener('change', (e) => {
      list.forEach((i) => (e.target.checked ? selected.add(i.id) : selected.delete(i.id)));
      draw();
      updateSelection();
    });
    updateSelection();
  };

  const setSelectionMode = (on) => {
    selectionMode = on;
    if (!on) selected.clear();
    $('#bulkDeleteToolbar').hidden = !on;
    $('#pageDeleteEntries').textContent = on ? 'Cancel Delete' : 'Delete Entries';
    draw();
  };

  $('#newContent')?.addEventListener('click', () => openEditor(null, opts.type || 'hadith'));
  $('#pageUploadFile')?.addEventListener('click', () => {
    S.bulkPresetType = opts.type || '';
    S.currentAdminView = 'upload';
    if (opts.type) bulkUploadView(opts.type);
    else renderAdminView('upload');
  });
  $('#managerQuickUpload')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    S.bulkRows = [];
    clearBulkCache();
    S.bulkPresetType = opts.type || '';
    const ok = await readBulkFile(file);
    if (ok) bulkUploadView(S.bulkPresetType);
  });

  $('#pageDeleteEntries')?.addEventListener('click', () => setSelectionMode(!selectionMode));
  $('#cancelBulkDelete')?.addEventListener('click', () => setSelectionMode(false));
  $('#clearSelectedEntries')?.addEventListener('click', () => {
    selected.clear();
    draw();
  });
  $('#selectVisibleEntries')?.addEventListener('click', () => {
    currentList().forEach((i) => selected.add(i.id));
    draw();
  });
  $('#deleteSelectedEntries')?.addEventListener('click', () => {
    if (!selected.size) return;
    openBulkDeleteConfirm([...selected], () => {
      selected.clear();
      selectionMode = false;
      $('#bulkDeleteToolbar').hidden = true;
      $('#pageDeleteEntries').textContent = 'Delete Entries';
      draw();
    });
  });

  $('#managerSearch').addEventListener('input', (e) => {
    search = e.target.value.trim().toLowerCase();
    draw();
  });
  $$('[data-mtype]').forEach((b) =>
    b.addEventListener('click', () => {
      $$('[data-mtype]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      type = b.dataset.mtype;
      draw();
    }),
  );
  $$('[data-mstatus]').forEach((b) =>
    b.addEventListener('click', () => {
      $$('[data-mstatus]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      status = b.dataset.mstatus;
      draw();
    }),
  );
  // Restore the remembered view state on a live refresh.
  if (remembered) {
    const input = $('#managerSearch');
    if (input) input.value = search;
    $$('[data-mtype]').forEach((x) => x.classList.toggle('active', x.dataset.mtype === type));
    $$('[data-mstatus]').forEach((x) => x.classList.toggle('active', x.dataset.mstatus === status));
    $('#bulkDeleteToolbar').hidden = !selectionMode;
    $('#pageDeleteEntries').textContent = selectionMode ? 'Cancel Delete' : 'Delete Entries';
  }
  draw();
}
function bindManagerActions() {
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditor(b.dataset.edit)));
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => preview(b.dataset.view)));
  $$('[data-feature]').forEach((b) => b.addEventListener('click', () => toggleField(b.dataset.feature, 'featured')));
  $$('[data-publish]').forEach((b) => b.addEventListener('click', () => toggleField(b.dataset.publish, 'published')));
  $$('[data-fulfill]').forEach((b) => b.addEventListener('click', () => toggleSadaqahFulfilled(b.dataset.fulfill)));
  $$('[data-delete]').forEach((b) =>
    b.addEventListener('click', () => {
      S.deleteTargetId = b.dataset.delete;
      openLayer('deleteOverlay');
    }),
  );
}
function ensureBulkDeleteOverlay() {
  let modal = document.getElementById('bulkDeleteOverlay');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'bulkDeleteOverlay';
  modal.className = 'modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="bulk-delete-confirm-card" role="dialog" aria-modal="true" aria-labelledby="bulkDeleteTitle"><div class="delete-symbol">×</div><h3 id="bulkDeleteTitle">Delete selected entries?</h3><p id="bulkDeleteMessage">This permanently removes the selected content from Firebase. This action cannot be undone.</p><div class="bulk-delete-confirm-actions"><button class="premium-btn" id="bulkDeleteCancel" type="button">Cancel</button><button class="premium-btn admin-delete-page-btn" id="bulkDeleteConfirm" type="button">Delete Entries</button></div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLayer('bulkDeleteOverlay');
  });
  return modal;
}
function openBulkDeleteConfirm(ids, onDone) {
  const clean = [...new Set(ids)].filter(Boolean);
  if (!clean.length) return;
  const modal = ensureBulkDeleteOverlay();
  const message = modal.querySelector('#bulkDeleteMessage');
  message.textContent = `You are about to permanently delete ${clean.length} ${clean.length === 1 ? 'entry' : 'entries'} from Firebase. This cannot be undone.`;
  const cancel = modal.querySelector('#bulkDeleteCancel');
  const confirm = modal.querySelector('#bulkDeleteConfirm');

  const newCancel = cancel.cloneNode(true);
  cancel.replaceWith(newCancel);
  const newConfirm = confirm.cloneNode(true);
  confirm.replaceWith(newConfirm);

  newCancel.addEventListener('click', () => closeLayer('bulkDeleteOverlay'));
  newConfirm.addEventListener('click', async () => {
    busy(newConfirm, true, 'Deleting…');
    try {
      const CHUNK = 400;
      for (let start = 0; start < clean.length; start += CHUNK) {
        const batch = writeBatch(S.db);
        clean.slice(start, start + CHUNK).forEach((id) => {
          const item = S.adminContent.find((x) => x.id === id);
          if (!item) return;
          const data = { ...item };
          delete data.id;
          const trashRef = doc(collection(S.db, 'trash'));
          batch.set(trashRef, {
            originalId: id,
            title: item.title || label(item.type),
            type: item.type || 'content',
            data,
            deletedAt: serverTimestamp(),
          });
          batch.delete(doc(S.db, COLLECTION, id));
        });
        await batch.commit();
      }
      toast(`${clean.length} ${clean.length === 1 ? 'entry' : 'entries'} moved to Recycle Bin.`);
      closeLayer('bulkDeleteOverlay');
      onDone?.();
    } catch (e) {
      console.error(e);
      toast(e.code === 'permission-denied' ? 'Permission denied.' : 'Unable to delete selected entries.', 'error');
    } finally {
      busy(newConfirm, false);
    }
  });
  openLayer('bulkDeleteOverlay');
}
async function toggleField(id, field) {
  const i = S.adminContent.find((x) => x.id === id);
  if (!i) return;
  // A second click while the first write is in flight used to toggle the value straight back.
  const key = `${id}:${field}`;
  if (pendingToggles.has(key)) return;
  pendingToggles.add(key);
  try {
    if (i.type === 'sadaqah' && field === 'published') {
      const active = !i.published;
      await updateDoc(doc(S.db, COLLECTION, id), {
        published: active,
        fulfilled: active ? false : !!i.fulfilled,
        updatedAt: serverTimestamp(),
      });
      toast(active ? 'Sadaqah request activated.' : 'Sadaqah request deactivated.');
      return;
    }
    await updateDoc(doc(S.db, COLLECTION, id), { [field]: !i[field], updatedAt: serverTimestamp() });
    toast(
      field === 'featured'
        ? !i[field]
          ? 'Content featured.'
          : 'Content unfeatured.'
        : !i[field]
          ? 'Content published.'
          : 'Content unpublished.',
    );
  } catch (e) {
    toast(e.code === 'permission-denied' ? 'Permission denied.' : 'Unable to update content.', 'error');
  } finally {
    pendingToggles.delete(key);
  }
}
async function toggleSadaqahFulfilled(id) {
  const i = S.adminContent.find((x) => x.id === id && x.type === 'sadaqah');
  if (!i) return;
  const fulfilled = !i.fulfilled;
  const key = `${id}:fulfilled`;
  if (pendingToggles.has(key)) return;
  pendingToggles.add(key);
  try {
    await updateDoc(doc(S.db, COLLECTION, id), {
      fulfilled,
      published: fulfilled ? false : !!i.published,
      updatedAt: serverTimestamp(),
    });
    toast(fulfilled ? 'Sadaqah request marked fulfilled and deactivated.' : 'Sadaqah request reopened.');
  } catch (e) {
    toast(e.code === 'permission-denied' ? 'Permission denied.' : 'Unable to update Sadaqah request.', 'error');
  } finally {
    pendingToggles.delete(key);
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { manager };
