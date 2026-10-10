/**
 * Admin › Content editor: create/edit Hadith, Duas, Reminders, Names, Zikr and Sadaqah requests, media upload, drafts and scheduling.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../../runtime/store';
import { clearEditorDraft, restoreEditorDraft, saveEditorDraft } from '../adminPersistence';
import { adminHeader } from '../adminRouter';
import { renderAdminView } from '../adminViews';
import { $, COLLECTION } from '../../../runtime/core';
import { ADMIN_EMAIL } from '../../../services/firebase/config';
import {
  addDoc,
  collection,
  doc,
  getDownloadURL,
  serverTimestamp,
  storageRef,
  updateDoc,
  uploadBytesResumable,
} from '../../../services/firebase/sdk';
import { busy, esc, label, safeFileName, toast } from '../../../utils/ui';

function openEditor(id = null, type = 'hadith') {
  S.editingId = id;
  S.currentAdminView = 'editor';
  window.__rudType = type;
  editor();
}
function editor() {
  const item = S.editingId ? S.adminContent.find((x) => x.id === S.editingId) : null,
    type = item?.type || window.__rudType || 'hadith',
    isSadaqah = type === 'sadaqah';
  const genericTop = `<div class="admin-form-grid"><div class="field"><label>Content Type</label><select class="select" id="fType"><option value="hadith">Hadith</option><option value="dua">Dua</option><option value="reminder">Reminder</option><option value="name">Name of Allah</option><option value="zikr">Zikr</option></select></div><div class="field"><label>Category</label><input class="input" id="fCategory" placeholder="Faith, Salah, Qur'an, Akhirah, Character…"></div><div class="field wide"><label>Search Keywords / moods</label><input class="input" id="fKeywords" placeholder="anger, patience, forgiveness, anxiety, peace"><small class="muted">Optional. Helps visitors find this content by what they are feeling. Use simple comma-separated terms.</small></div></div>`;
  const sadaqahTop = `<input id="fType" type="hidden" value="sadaqah"><input id="fCategory" type="hidden" value="Sadaqah"><input id="fKeywords" type="hidden" value="">`;
  const genericUpload = `<div class="admin-upload-box"><div class="admin-upload-copy"><strong>Media / File</strong><small>Upload an image, PDF, audio file or document. The file is stored securely in Firebase Storage.</small></div><label class="admin-upload-drop" for="fUpload"><input id="fUpload" type="file" accept="image/*,application/pdf,audio/*,.doc,.docx,.txt" hidden><span class="upload-icon">↑</span><span><b>Choose file</b><small id="uploadFileName">No file selected</small></span></label><div class="upload-progress" id="uploadProgress" hidden><i></i><span>0%</span></div><input id="fMediaUrl" type="hidden"><input id="fMediaName" type="hidden"><input id="fMediaType" type="hidden"></div>`;
  const genericState = `<div class="admin-form-grid"><div class="field"><label>Featured</label><div class="toggle-line"><label class="switch"><input id="fFeatured" type="checkbox"><span></span></label><small class="muted">Show prominently on the homepage.</small></div></div><div class="field"><label>Publish Status</label><div class="toggle-line"><label class="switch"><input id="fPublished" type="checkbox"><span></span></label><small class="muted" id="publishState">Draft</small><small class="muted">Only Published content appears on the public website after refresh.</small></div></div></div><div class="field wide"><label>Schedule Publishing <small class="muted">(optional)</small></label><input class="input" id="fScheduleAt" type="datetime-local"><small class="muted">Choose a future date/time. Scheduled content remains unpublished until its time.</small></div>`;
  const sadaqahState = `<input id="fFeatured" type="checkbox" hidden><input id="fScheduleAt" type="hidden"><div class="field wide"><label>Public Request</label><div class="toggle-line"><label class="switch"><input id="fPublished" type="checkbox"><span></span></label><small class="muted" id="publishState">Active</small><small class="muted">Active requests appear on the Sadaqah page. Fulfilled requests are hidden automatically.</small></div></div>`;
  const actions = isSadaqah
    ? `<button class="premium-btn primary" type="submit" id="publishContent">${item ? 'Save Request' : 'Add Request'}</button><button class="premium-btn" type="button" id="cancelEditor">Cancel</button>`
    : `<button class="premium-btn" type="button" id="saveDraft">Save Draft</button><button class="premium-btn primary" type="submit" id="publishContent">${item?.published ? 'Update Published Content' : 'Publish'}</button><button class="premium-btn" type="button" id="cancelEditor">Cancel</button>`;
  $('#adminMain').innerHTML =
    `${adminHeader(item ? (isSadaqah ? 'Edit Sadaqah Request' : 'Edit Content') : isSadaqah ? 'Add Sadaqah Request' : 'Create Content', isSadaqah ? 'Keep only the details visitors need to give voluntary Sadaqah directly.' : item ? 'Update, publish or save changes securely.' : 'Create verified content for the public Rise Upon Deen website.', false)}${!item && !isSadaqah ? `<div class="draft-restore-bar" id="draftRestoreBar" hidden><span>Your unfinished content was restored automatically.</span><button type="button" id="discardRestoredDraft">Discard restored draft</button></div>` : ''}<form class="admin-panel" id="contentForm">${isSadaqah ? sadaqahTop : genericTop}<div id="dynamicFields"></div>${isSadaqah ? '' : genericUpload}${isSadaqah ? sadaqahState : genericState}<div class="preview-panel" id="contentLivePreview"><span class="eyebrow">LIVE PREVIEW</span><h3>Start writing to preview this content.</h3><p>Your public card preview will appear here before publishing.</p></div><div class="form-actions">${actions}</div></form>`;
  $('#fType').value = type;
  $('#fCategory').value = item?.category || (isSadaqah ? 'Sadaqah' : '');
  $('#fKeywords').value = item?.keywords || '';
  $('#fFeatured').checked = !!item?.featured;
  $('#fPublished').checked = item ? !!item.published : isSadaqah;
  $('#publishState').textContent = isSadaqah
    ? $('#fPublished').checked
      ? 'Active'
      : 'Inactive'
    : item?.published
      ? 'Published'
      : 'Draft';
  dynamicFields(type, item);
  const scheduleInput = $('#fScheduleAt');
  if (scheduleInput && item?.scheduledAt) {
    const d = item.scheduledAt?.toDate ? item.scheduledAt.toDate() : new Date(item.scheduledAt);
    if (!Number.isNaN(d.getTime())) {
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      scheduleInput.value = local.toISOString().slice(0, 16);
    }
  }
  if (!item && !isSadaqah) {
    const restored = restoreEditorDraft(type);
    if (restored) {
      $('#draftRestoreBar').hidden = false;
      $('#discardRestoredDraft')?.addEventListener('click', () => {
        clearEditorDraft();
        window.__rudType = type;
        editor();
      });
    }
  }
  $('#fType')?.addEventListener('change', (e) => {
    dynamicFields(e.target.value, null);
    renderEditorPreview();
  });
  $('#fUpload')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0],
      n = $('#uploadFileName');
    if (n) n.textContent = f ? `${f.name} · ${(f.size / 1024 / 1024).toFixed(2)} MB` : 'No file selected';
  });
  $('#fPublished')?.addEventListener(
    'change',
    (e) =>
      ($('#publishState').textContent =
        $('#fType').value === 'sadaqah'
          ? e.target.checked
            ? 'Active'
            : 'Inactive'
          : e.target.checked
            ? 'Published'
            : 'Draft'),
  );
  $('#cancelEditor')?.addEventListener('click', () => {
    if (!isSadaqah) saveEditorDraft();
    S.editingId = null;
    S.currentAdminView = isSadaqah ? 'sadaqah' : 'manage';
    renderAdminView(S.currentAdminView);
    if (!isSadaqah) toast('Unfinished content saved locally.');
  });
  $('#saveDraft')?.addEventListener('click', () => saveContent(false));
  $('#contentForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveContent(true);
  });
  $('#contentForm')?.addEventListener('input', () => {
    renderEditorPreview();
    if (!isSadaqah) saveEditorDraft();
  });
  if (!isSadaqah) $('#contentForm')?.addEventListener('change', saveEditorDraft);
  renderEditorPreview();
}
function renderEditorPreview() {
  const root = $('#contentLivePreview');
  if (!root) return;
  const type = $('#fType')?.value || 'article';
  const title = document.getElementById('xTitle')?.value?.trim() || `Untitled ${label(type)}`;
  const raw =
    document.getElementById('xDescription')?.value?.trim() ||
    document.getElementById('xTranslation')?.value?.trim() ||
    document.getElementById('xMeaning')?.value?.trim() ||
    document.getElementById('xContent')?.value?.trim() ||
    'Your public card preview will appear here before publishing.';
  const arabic = document.getElementById('xArabic')?.value?.trim() || '';
  root.innerHTML = `<span class="eyebrow">${esc(label(type))} · PREVIEW</span>${arabic && ['dua', 'hadith', 'name', 'zikr'].includes(type) ? `<div class="arabic-big" lang="ar" style="margin:18px 0">${esc(arabic)}</div>` : ''}<h3>${esc(title)}</h3><p>${esc(raw.length > 220 ? raw.slice(0, 220) + '…' : raw)}</p>`;
}
function dynamicFields(type, item) {
  const html = {
    article: `<div class="admin-form-grid"><div class="field wide"><label>Article Title</label><input class="input" id="xTitle" required></div><div class="field wide"><label>Short Description</label><textarea class="textarea" id="xDescription" required></textarea></div><div class="field wide"><label>Full Article Content</label><textarea class="textarea tall" id="xContent" required></textarea><small class="muted">Use plain text. Separate paragraphs with a blank line.</small></div><div class="field"><label>Author</label><input class="input" id="xAuthor" value="Rise Upon Deen"></div><div class="field"><label>Featured Image URL</label><input class="input" id="xImage" type="url" placeholder="https://…"></div></div>`,
    hadith: `<div class="admin-form-grid"><div class="field wide"><label>Hadith Title</label><input class="input" id="xTitle" required></div><div class="field wide"><label>Arabic Text</label><textarea class="textarea arabic" id="xArabic" dir="rtl"></textarea></div><div class="field wide"><label>English Translation</label><textarea class="textarea" id="xTranslation" required></textarea></div><div class="field"><label>Source</label><input class="input" id="xSource" placeholder="Example: Sahih al-Bukhari"></div><div class="field"><label>Hadith Number / Reference</label><input class="input" id="xReference" placeholder="Enter verified reference manually"></div><div class="field wide"><label>Short Reflection</label><textarea class="textarea" id="xReflection"></textarea></div></div>`,
    dua: `<div class="admin-form-grid"><div class="field wide"><label>Dua Title</label><input class="input" id="xTitle" required></div><div class="field wide"><label>Arabic</label><textarea class="textarea arabic" id="xArabic" dir="rtl" required></textarea></div><div class="field wide"><label>Transliteration</label><textarea class="textarea" id="xTransliteration"></textarea></div><div class="field wide"><label>Meaning</label><textarea class="textarea" id="xMeaning" required></textarea></div><div class="field"><label>Source</label><input class="input" id="xSource"></div><div class="field"><label>Reference</label><input class="input" id="xReference"></div><div class="field wide"><label>When to Recite</label><textarea class="textarea" id="xWhen"></textarea></div><div class="field wide"><label>Short Reflection</label><textarea class="textarea" id="xReflection"></textarea></div></div>`,
    reminder: `<div class="admin-form-grid"><div class="field wide"><label>Reminder Title</label><input class="input" id="xTitle" required></div><div class="field wide"><label>Reminder Text</label><textarea class="textarea tall" id="xContent" required></textarea></div><div class="field wide"><label>Optional Qur'an / Hadith Reference</label><input class="input" id="xReference" placeholder="Enter only a verified reference"></div></div>`,
    zikr: `<div class="admin-form-grid"><div class="field wide"><label>Zikr Title</label><input class="input" id="xTitle" required></div><div class="field wide"><label>Arabic</label><textarea class="textarea arabic" id="xArabic" dir="rtl" required></textarea></div><div class="field wide"><label>Transliteration</label><input class="input" id="xTransliteration" required></div><div class="field wide"><label>English Meaning</label><textarea class="textarea" id="xMeaning" required></textarea></div><div class="field wide"><label>Authentic Reference <small class="muted">(optional)</small></label><input class="input" id="xReference" placeholder="Add only a verified Qur'an/Hadith reference"></div><div class="field"><label>Recommended Count <small class="muted">(optional)</small></label><input class="input" id="xRecommendedCount" type="number" min="1" step="1" placeholder="Leave empty if no fixed count"></div><div class="field"><label>Display Order</label><input class="input" id="xDisplayOrder" type="number" min="1" step="1" placeholder="1"></div></div>`,
    sadaqah: `<div class="admin-form-grid"><div class="field wide"><label>Person / Family Display Name</label><input class="input" id="xTitle" required maxlength="80"></div><div class="field wide"><label>Short Need Description</label><textarea class="textarea" id="xDescription" required maxlength="420"></textarea><small class="muted">Keep this brief and do not include unnecessary personal information.</small></div><div class="field wide"><label>UPI ID</label><input class="input" id="xUpiId" required placeholder="name@upi" autocomplete="off"></div><div class="field"><label>Verification / Updated Date</label><input class="input" id="xVerifiedDate" type="date" required></div><div class="field"><label>Request Status</label><div class="toggle-line"><label class="switch"><input id="xFulfilled" type="checkbox"><span></span></label><small class="muted">Fulfilled / completed. Fulfilled requests are automatically inactive publicly.</small></div></div></div>`,
    name: `<div class="admin-form-grid"><div class="field"><label>Name Number</label><input class="input" id="xNumber" type="number" min="1" max="99" placeholder="1"></div><div class="field wide"><label>Arabic Name</label><input class="input arabic" id="xArabic" dir="rtl" required></div><div class="field wide"><label>Transliteration</label><input class="input" id="xTitle" placeholder="Ar-Rahman" required></div><div class="field wide"><label>Meaning</label><input class="input" id="xMeaning" placeholder="The Most Merciful" required></div><div class="field wide"><label>Description / Reflection <small class="muted">(optional)</small></label><textarea class="textarea" id="xReflection"></textarea></div><div class="field wide"><label>When to remember this Name <small class="muted">(optional)</small></label><textarea class="textarea" id="xWhen"></textarea></div></div>`,
  }[type];
  $('#dynamicFields').innerHTML = html;
  if (!item || item.type !== type) return;
  const map = {
    xTitle: 'title',
    xDescription: 'description',
    xContent: 'content',
    xAuthor: 'author',
    xImage: 'image',
    xArabic: 'arabic',
    xTranslation: 'translation',
    xSource: 'source',
    xReference: 'reference',
    xReflection: 'reflection',
    xTransliteration: 'transliteration',
    xMeaning: 'meaning',
    xWhen: 'whenToRecite',
    xNumber: 'number',
    xRecommendedCount: 'recommendedCount',
    xDisplayOrder: 'displayOrder',
    xUpiId: 'upiId',
    xVerifiedDate: 'verifiedDate',
  };
  Object.entries(map).forEach(([id, key]) => {
    const e = document.getElementById(id);
    if (e) e.value = item[key] || '';
  });
  const fulfilled = document.getElementById('xFulfilled');
  if (fulfilled) fulfilled.checked = !!item.fulfilled;
  const mu = document.getElementById('fMediaUrl'),
    mn = document.getElementById('fMediaName'),
    mt = document.getElementById('fMediaType'),
    fn = document.getElementById('uploadFileName');
  if (mu) mu.value = item.mediaUrl || item.image || '';
  if (mn) mn.value = item.mediaName || '';
  if (mt) mt.value = item.mediaType || '';
  if (fn && item.mediaName) fn.textContent = item.mediaName;
}
function uploadAdminFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!S.storage) return reject(new Error('storage-not-ready'));
    const user = S.auth?.currentUser;
    if (!user || (user.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase())
      return reject(new Error('unauthorized'));
    const type = $('#fType')?.value || 'content';
    const path = `content/${type}/${Date.now()}-${safeFileName(file.name)}`;
    const task = uploadBytesResumable(storageRef(S.storage, path), file, {
      contentType: file.type || 'application/octet-stream',
    });
    const progress = $('#uploadProgress');
    if (progress) {
      progress.hidden = false;
      progress.querySelector('i').style.width = '0%';
      progress.querySelector('span').textContent = '0%';
    }
    task.on(
      'state_changed',
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        if (progress) {
          progress.querySelector('i').style.width = pct + '%';
          progress.querySelector('span').textContent = pct + '%';
        }
      },
      reject,
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({ url, name: file.name, type: file.type || '', path });
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}
function formData(published) {
  const g = (id) => document.getElementById(id)?.value?.trim() || '';
  const type = $('#fType').value;
  return {
    type,
    title: g('xTitle'),
    number: Number(g('xNumber')) || null,
    description: g('xDescription'),
    content: g('xContent'),
    author: g('xAuthor') || 'Rise Upon Deen',
    image: g('xImage'),
    mediaUrl: g('fMediaUrl'),
    mediaName: g('fMediaName'),
    mediaType: g('fMediaType'),
    arabic: g('xArabic'),
    translation: g('xTranslation'),
    source: g('xSource'),
    reference: g('xReference'),
    reflection: g('xReflection'),
    transliteration: g('xTransliteration'),
    meaning: g('xMeaning'),
    whenToRecite: g('xWhen'),
    recommendedCount: Number(g('xRecommendedCount')) || null,
    displayOrder: Number(g('xDisplayOrder')) || null,
    upiId: g('xUpiId'),
    verifiedDate: g('xVerifiedDate'),
    fulfilled: !!document.getElementById('xFulfilled')?.checked,
    category: $('#fCategory').value.trim() || 'General',
    keywords: $('#fKeywords')?.value.trim() || '',
    featured: $('#fFeatured').checked,
    published,
    scheduledAt: $('#fScheduleAt')?.value ? new Date($('#fScheduleAt').value) : null,
    scheduleStatus: $('#fScheduleAt')?.value ? 'scheduled' : null,
    updatedAt: serverTimestamp(),
  };
}
function isFutureSchedule(v) {
  if (!v) return false;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) && d.getTime() > Date.now() + 30000;
}
async function saveContent(published) {
  if (!S.firebaseReady || !S.auth?.currentUser) return toast('Secure admin session is unavailable.', 'error');
  const btn = published ? $('#publishContent') : $('#saveDraft');
  busy(btn, true, published ? 'Publishing…' : 'Saving…');
  try {
    const file = $('#fUpload')?.files?.[0] || null;
    if (file) {
      busy(btn, true, 'Uploading file…');
      const uploaded = await uploadAdminFile(file);
      if (uploaded) {
        $('#fMediaUrl').value = uploaded.url;
        $('#fMediaName').value = uploaded.name;
        $('#fMediaType').value = uploaded.type;
      }
    }
    const d = formData(published);
    const scheduled = d.type !== 'sadaqah' && published && isFutureSchedule(d.scheduledAt);
    if (d.type === 'sadaqah') {
      d.scheduledAt = null;
      d.scheduleStatus = null;
      d.published = published && $('#fPublished')?.checked === true && !d.fulfilled;
      if (d.fulfilled) d.published = false;
    } else if (scheduled) {
      d.published = false;
      d.scheduleStatus = 'scheduled';
    } else if (d.scheduledAt) {
      d.scheduledAt = null;
      d.scheduleStatus = null;
    }
    if (!d.title) throw new Error('title');
    if (
      (d.type === 'hadith' && !d.translation) ||
      (d.type === 'dua' && (!d.arabic || !d.meaning)) ||
      (d.type === 'reminder' && !d.content) ||
      (d.type === 'zikr' && (!d.arabic || !d.transliteration || !d.meaning)) ||
      (d.type === 'name' && (!d.arabic || !d.meaning || !d.reflection || !d.whenToRecite)) ||
      (d.type === 'sadaqah' && (!d.description || !d.upiId || !d.verifiedDate))
    )
      throw new Error('required');
    if (d.mediaUrl && d.mediaType?.startsWith('image/') && !d.image) d.image = d.mediaUrl;

    if (S.editingId) {
      await updateDoc(doc(S.db, COLLECTION, S.editingId), d);
      toast(
        scheduled
          ? 'Content scheduled successfully.'
          : published
            ? 'Content updated successfully.'
            : 'Draft updated successfully.',
      );
    } else {
      const refNew = await addDoc(collection(S.db, COLLECTION), { ...d, createdAt: serverTimestamp() });
      toast(
        scheduled
          ? `${label(d.type)} scheduled successfully.`
          : published
            ? `${label(d.type)} published successfully.`
            : 'Draft saved successfully.',
      );
    }
    clearEditorDraft();
    S.editingId = null;
    S.currentAdminView = d.type === 'sadaqah' ? 'sadaqah' : 'manage';
    renderAdminView(S.currentAdminView);
  } catch (e) {
    console.error(e);
    const message =
      e.message === 'title'
        ? 'A title is required.'
        : e.message === 'required'
          ? 'Please complete the required content fields.'
          : e.message === 'storage-not-ready'
            ? 'Firebase Storage is not available yet. Enable Storage in Firebase Console.'
            : e.code === 'storage/unauthorized'
              ? 'File upload permission denied. Check Firebase Storage rules.'
              : e.code === 'permission-denied'
                ? 'Permission denied. Check Firestore security rules.'
                : 'Unable to complete request.';
    toast(message, 'error');
  } finally {
    busy(btn, false);
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { editor, isFutureSchedule, openEditor, renderEditorPreview };
