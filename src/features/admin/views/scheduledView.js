/**
 * Admin › Scheduled publishing list.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../../runtime/store';
import { adminDateTime, adminHeader } from '../adminRouter';
import { isFutureSchedule, openEditor } from './contentEditor';
import { $, $$, COLLECTION } from '../../../runtime/core';
import { doc, serverTimestamp, updateDoc } from '../../../services/firebase/sdk';
import { esc, label, millis, toast } from '../../../utils/ui';

async function scheduledAdminView() {
  $('#adminTopTitle').textContent = 'Scheduled';
  const list = S.adminContent
    .filter((i) => !i.published && isFutureSchedule(i.scheduledAt))
    .sort((a, b) => millis(a.scheduledAt) - millis(b.scheduledAt));
  $('#adminMain').innerHTML = `${adminHeader('Scheduled Publishing', 'Content waiting for its publishing time.', false)}
  <section class="admin-panel">${list.length ? `<div class="table-wrap"><table><thead><tr><th>Content</th><th>Type</th><th>Publish At</th><th>Actions</th></tr></thead><tbody>${list.map((i) => `<tr><td><strong>${esc(i.title || label(i.type))}</strong></td><td>${esc(label(i.type))}</td><td>${esc(adminDateTime(i.scheduledAt))}</td><td><button class="mini-action" data-scheduled-edit="${i.id}">Edit</button><button class="mini-action" data-publish-now="${i.id}">Publish Now</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-live">No scheduled content.</div>`}</section>`;
  $$('[data-scheduled-edit]').forEach((b) => b.addEventListener('click', () => openEditor(b.dataset.scheduledEdit)));
  $$('[data-publish-now]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await updateDoc(doc(S.db, COLLECTION, b.dataset.publishNow), {
          published: true,
          scheduledAt: null,
          scheduleStatus: null,
          updatedAt: serverTimestamp(),
        });
        toast('Published now.');
      } catch (e) {
        console.error(e);
        toast('Unable to publish.', 'error');
      }
    }),
  );
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { scheduledAdminView };
