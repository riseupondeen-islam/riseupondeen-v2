/**
 * Moves content to the Recycle Bin (trash collection) and binds the delete-confirmation dialog.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { cacheAdminContent } from './adminPersistence';
import { renderAdminView } from './adminViews';
import { $, COLLECTION } from '../../runtime/core';
import { cachePublicContent } from '../../services/content/publicContentCache';
import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp } from '../../services/firebase/sdk';
import { busy, closeLayer, label, toast } from '../../utils/ui';

async function moveContentToTrash(id) {
  if (!S.firebaseReady || !S.auth?.currentUser) {
    const e = new Error('auth-not-ready');
    e.code = 'auth-not-ready';
    throw e;
  }
  const targetId = String(id || '').trim();
  if (!targetId) {
    const e = new Error('invalid-document-id');
    e.code = 'invalid-document-id';
    throw e;
  }

  /* Preserve the original Admin Console delete model, but verify the exact
     Firestore document first so manual and Excel-imported Zikr use the same ID. */
  const activeRef = doc(S.db, COLLECTION, targetId);
  const liveSnap = await getDoc(activeRef);
  if (!liveSnap.exists()) {
    const e = new Error('missing-content');
    e.code = 'not-found';
    throw e;
  }
  const snapshot = liveSnap.data() || {};
  const item = { id: liveSnap.id, ...snapshot };
  const trashRef = await addDoc(collection(S.db, 'trash'), {
    originalId: targetId,
    title: item.title || label(item.type),
    type: item.type || 'content',
    data: snapshot,
    deletedAt: serverTimestamp(),
  });

  try {
    await deleteDoc(activeRef);
  } catch (e) {
    /* If the active delete fails, remove the just-created recycle copy so a
       failed attempt does not leave a misleading duplicate in Recycle Bin. */
    try {
      await deleteDoc(trashRef);
    } catch (rollbackError) {
      console.error('Recycle Bin rollback failed:', rollbackError);
    }
    throw e;
  }

  S.adminContent = S.adminContent.filter((x) => x.id !== targetId);
  cacheAdminContent(S.adminContent);
  if (item.type === 'zikr') {
    S.publicContent = S.publicContent.filter((x) => x.id !== targetId);
    window.RUD_PUBLIC_CONTENT = S.publicContent;
    cachePublicContent(S.publicContent);
    try {
      if (sessionStorage.getItem('rudTasbih:selected') === targetId) sessionStorage.removeItem('rudTasbih:selected');
      if (localStorage.getItem('rudTasbih:selected') === targetId) localStorage.removeItem('rudTasbih:selected');
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('rud:public-content-updated'));
    } catch {}
  }
  return item;
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  $('#cancelDelete').addEventListener('click', () => {
    S.deleteTargetId = null;
    closeLayer('deleteOverlay');
  });
  $('#confirmDelete').addEventListener('click', async () => {
    const targetId = String(S.deleteTargetId || '').trim();
    if (!targetId) return toast('No valid content record was selected for deletion.', 'error');
    const targetType = S.adminContent.find((x) => x.id === targetId)?.type || 'content';
    const b = $('#confirmDelete');
    busy(b, true, 'Moving…');
    try {
      const deletedItem = await moveContentToTrash(targetId);
      S.deleteTargetId = null;
      closeLayer('deleteOverlay');
      if (!['editor', 'upload'].includes(S.currentAdminView)) renderAdminView(S.currentAdminView);
      toast(deletedItem.type === 'zikr' ? 'Zikr moved to Recycle Bin.' : 'Content moved to Recycle Bin.');
    } catch (e) {
      console.error('Content delete / Recycle Bin move failed:', e);
      const message =
        e?.code === 'permission-denied'
          ? 'Permission denied. Your Firestore rules are blocking delete/recycle.'
          : e?.code === 'not-found'
            ? 'The selected record no longer exists in the active database.'
            : e?.code === 'invalid-document-id'
              ? 'The selected record has no valid document ID.'
              : e?.code === 'auth-not-ready'
                ? 'Secure admin session is unavailable.'
                : targetType === 'zikr'
                  ? 'Failed to delete Zikr. Please try again.'
                  : 'Unable to move content to Recycle Bin.';
      toast(message, 'error');
    } finally {
      busy(b, false);
    }
  });
  $('#deleteOverlay').addEventListener('click', (e) => {
    if (e.target === $('#deleteOverlay')) closeLayer('deleteOverlay');
  });
}
