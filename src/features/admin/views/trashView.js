/**
 * Admin › Recycle Bin: restore or permanently delete.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../../runtime/store';
import { cacheAdminContent } from '../adminPersistence';
import { adminDateTime, adminHeader } from '../adminRouter';
import { $, $$, COLLECTION } from '../../../runtime/core';
import { cachePublicContent } from '../../../services/content/publicContentCache';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from '../../../services/firebase/sdk';
import { busy, esc, label, millis, toast } from '../../../utils/ui';

async function trashAdminView() {
  $('#adminTopTitle').textContent = 'Recycle Bin';
  $('#adminMain').innerHTML =
    `${adminHeader('Recycle Bin', 'Deleted content can be restored safely.', false)}<section class="admin-panel"><div class="empty-live">Loading Recycle Bin…</div></section>`;
  try {
    const snap = await getDocs(collection(S.db, 'trash'));
    const rows = snap.docs
      .map((d) => {
        const raw = d.data() || {};
        const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
        return {
          id: d.id,
          ...raw,
          originalId: String(raw.originalId || '').trim(),
          type: raw.type || data.type || 'content',
          title: raw.title || data.title || label(raw.type || data.type || 'content'),
        };
      })
      .sort((a, b) => millis(b.deletedAt) - millis(a.deletedAt));

    $('#adminMain').innerHTML = `${adminHeader('Recycle Bin', 'Restore content or permanently remove it.', false)}
    <section class="admin-panel">
      ${
        rows.length
          ? `
        <div class="manager-toolbar">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button class="mini-action" id="trashSelectAll" type="button">Select All</button>
            <button class="mini-action danger" id="trashDeleteSelected" type="button" disabled>Delete Selected</button>
            <span id="trashSelectedCount" style="color:#85868c;font-size:12px">0 selected</span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width:46px;text-align:center"><input type="checkbox" id="trashSelectAllCheckbox" aria-label="Select all recycle bin entries"></th>
                <th>Content</th><th>Type</th><th>Deleted</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (i) => `<tr>
                <td style="text-align:center"><input type="checkbox" data-trash-select="${i.id}" aria-label="Select ${esc(i.title || 'Content')}"></td>
                <td><strong>${esc(i.title || 'Content')}</strong></td>
                <td>${esc(label(i.type))}</td>
                <td>${esc(adminDateTime(i.deletedAt))}</td>
                <td><button class="mini-action" data-trash-restore="${i.id}">Restore</button><button class="mini-action" data-trash-delete="${i.id}">Delete Forever</button></td>
              </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
          : `<div class="empty-live">Recycle Bin is empty.</div>`
      }
    </section>`;

    const trashChecks = () => $$('[data-trash-select]');
    const selectedTrashIds = () =>
      trashChecks()
        .filter((c) => c.checked)
        .map((c) => c.dataset.trashSelect);

    const syncTrashSelection = () => {
      if (!rows.length) return;
      const checks = trashChecks();
      const selected = checks.filter((c) => c.checked).length;
      const master = $('#trashSelectAllCheckbox');
      const button = $('#trashSelectAll');
      const del = $('#trashDeleteSelected');
      const count = $('#trashSelectedCount');
      if (master) {
        master.checked = selected === checks.length && checks.length > 0;
        master.indeterminate = selected > 0 && selected < checks.length;
      }
      if (button)
        button.textContent = selected === checks.length && checks.length > 0 ? 'Clear Selection' : 'Select All';
      if (del) {
        del.disabled = selected === 0;
        del.textContent =
          selected === checks.length && checks.length > 0
            ? `Delete All (${selected})`
            : `Delete Selected (${selected})`;
      }
      if (count) count.textContent = `${selected} selected`;
    };

    $('#trashSelectAll')?.addEventListener('click', () => {
      const checks = trashChecks();
      const allSelected = checks.length > 0 && checks.every((c) => c.checked);
      checks.forEach((c) => (c.checked = !allSelected));
      syncTrashSelection();
    });

    $('#trashSelectAllCheckbox')?.addEventListener('change', (e) => {
      trashChecks().forEach((c) => (c.checked = e.target.checked));
      syncTrashSelection();
    });

    trashChecks().forEach((c) => c.addEventListener('change', syncTrashSelection));

    $('#trashDeleteSelected')?.addEventListener('click', async () => {
      const ids = selectedTrashIds();
      if (!ids.length) return;
      const message =
        ids.length === rows.length
          ? `Permanently delete ALL ${ids.length} entries from the Recycle Bin? This cannot be undone.`
          : `Permanently delete ${ids.length} selected ${ids.length === 1 ? 'entry' : 'entries'}? This cannot be undone.`;
      if (!confirm(message)) return;

      const btn = $('#trashDeleteSelected');
      busy(btn, true, 'Deleting…');
      try {
        const CHUNK = 450;
        for (let start = 0; start < ids.length; start += CHUNK) {
          const batch = writeBatch(S.db);
          ids.slice(start, start + CHUNK).forEach((id) => batch.delete(doc(S.db, 'trash', id)));
          await batch.commit();
        }
        toast(`${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} permanently deleted.`);
        trashAdminView();
      } catch (e) {
        console.error(e);
        toast(
          e.code === 'permission-denied' ? 'Permission denied.' : 'Unable to permanently delete selected entries.',
          'error',
        );
        busy(btn, false);
      }
    });

    $$('[data-trash-restore]').forEach((b) =>
      b.addEventListener('click', async () => {
        const recycleId = String(b.dataset.trashRestore || '').trim();
        const row = rows.find((x) => x.id === recycleId);
        if (!row) return toast('Recycle Bin item could not be found.', 'error');
        if (!S.firebaseReady || !S.auth?.currentUser) return toast('Secure admin session is unavailable.', 'error');
        const originalId = String(row.originalId || '').trim();
        if (!originalId)
          return toast(
            'This Recycle Bin item has no valid original document ID and cannot be restored safely.',
            'error',
          );
        if (!row.data || typeof row.data !== 'object')
          return toast('This Recycle Bin item has no restorable content data.', 'error');
        busy(b, true, 'Restoring…');
        try {
          const activeRef = doc(S.db, COLLECTION, originalId);
          const activeSnap = await getDoc(activeRef);
          if (activeSnap.exists()) {
            toast(
              'This content already exists in the active library. Restore was stopped to prevent a duplicate.',
              'error',
            );
            return;
          }

          /* Match the old working Recycle Bin sequence: restore the active
           record first, wait for it to succeed, then remove the trash copy. */
          const restored = { ...row.data };
          if (!restored.type && row.type && row.type !== 'content') restored.type = row.type;
          restored.updatedAt = serverTimestamp();
          await setDoc(activeRef, restored);
          await deleteDoc(doc(S.db, 'trash', recycleId));

          const localRestored = { id: originalId, ...row.data, type: row.data.type || row.type };
          S.adminContent = [localRestored, ...S.adminContent.filter((x) => x.id !== originalId)];
          cacheAdminContent(S.adminContent);
          S.publicContent = S.publicContent.filter((x) => x.id !== originalId);
          if (localRestored.published === true) S.publicContent = [localRestored, ...S.publicContent];
          window.RUD_PUBLIC_CONTENT = S.publicContent;
          cachePublicContent(S.publicContent);
          if (localRestored.type === 'zikr') {
            try {
              window.dispatchEvent(new CustomEvent('rud:public-content-updated'));
            } catch {}
          }
          toast(row.type === 'zikr' ? 'Zikr restored.' : 'Content restored.');
          trashAdminView();
        } catch (e) {
          console.error('Recycle Bin restore failed:', e);
          toast(
            e?.code === 'permission-denied'
              ? 'Permission denied. Unable to restore content.'
              : row.type === 'zikr'
                ? 'Failed to restore Zikr. Please try again.'
                : 'Unable to restore content.',
            'error',
          );
        } finally {
          busy(b, false);
        }
      }),
    );

    $$('[data-trash-delete]').forEach((b) =>
      b.addEventListener('click', async () => {
        const recycleId = String(b.dataset.trashDelete || '').trim();
        const row = rows.find((x) => x.id === recycleId);
        if (!recycleId || !row) return toast('Recycle Bin item could not be found.', 'error');
        if (!confirm('Permanently delete this item? This cannot be undone.')) return;
        busy(b, true, 'Deleting…');
        try {
          await deleteDoc(doc(S.db, 'trash', recycleId));
          toast('Permanently deleted.');
          trashAdminView();
        } catch (e) {
          console.error('Recycle Bin permanent delete failed:', e);
          toast(
            e?.code === 'permission-denied'
              ? 'Permission denied. Unable to permanently delete.'
              : 'Unable to permanently delete.',
            'error',
          );
        } finally {
          busy(b, false);
        }
      }),
    );

    syncTrashSelection();
  } catch (e) {
    console.error(e);
    toast('Unable to load Recycle Bin.', 'error');
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { trashAdminView };
