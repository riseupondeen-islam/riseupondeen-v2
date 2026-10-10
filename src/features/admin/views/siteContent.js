/**
 * Admin › Site Content (homepage copy) editor and the Settings panel.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../../runtime/store';
import { adminHeader } from '../adminRouter';
import { $, COLLECTION } from '../../../runtime/core';
import { ADMIN_EMAIL } from '../../../services/firebase/config';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from '../../../services/firebase/sdk';
import { esc, toast } from '../../../utils/ui';

async function saveSiteContent() {
  if (!S.firebaseReady || !S.auth?.currentUser) return toast('Secure admin session is unavailable.', 'error');
  const existing = S.adminContent.find((x) => x.type === 'site' && x.key === 'main');
  const g = (id) => document.getElementById(id)?.value?.trim() || '';
  const data = {
    type: 'site',
    key: 'main',
    title: 'Site Content',
    published: true,
    heroTagline: g('sHeroTagline'),
    heroSupport: g('sHeroSupport'),
    dailyHeading: g('sDailyHeading'),
    namesHeading: g('sNamesHeading'),
    namesCopy: g('sNamesCopy'),
    guidanceHeading: g('sGuidanceHeading'),
    reflectionTitle: g('sReflectionTitle'),
    reflectionSupport: g('sReflectionSupport'),
    instagramQuote: g('sInstagramQuote'),
    updatedAt: serverTimestamp(),
  };
  try {
    if (existing) await updateDoc(doc(S.db, COLLECTION, existing.id), data);
    else await addDoc(collection(S.db, COLLECTION), { ...data, createdAt: serverTimestamp() });
    toast('Site content updated.');
  } catch (e) {
    console.error(e);
    toast('Unable to update site content.', 'error');
  }
}
function siteContentEditor() {
  const item = S.adminContent.find((x) => x.type === 'site' && x.key === 'main') || {};
  $('#adminMain').innerHTML =
    `${adminHeader('Site Content', 'Edit the main public website wording without changing index.html.', false)}
  <section class="admin-panel"><div class="admin-form-grid"><div class="field wide"><label>Hero Tagline</label><input class="input" id="sHeroTagline" value="${esc(item.heroTagline || 'Return your heart to what truly matters.')}"></div><div class="field wide"><label>Hero Supporting Line</label><input class="input" id="sHeroSupport" value="${esc(item.heroSupport || 'Reminders. Knowledge. Reflection.')}"></div><div class="field"><label>Daily Reflection Heading</label><input class="input" id="sDailyHeading" value="${esc(item.dailyHeading || 'For Your Heart')}"></div><div class="field"><label>Names Heading</label><input class="input" id="sNamesHeading" value="${esc(item.namesHeading || 'The Beautiful Names')}"></div><div class="field"><label>Names Supporting Line</label><input class="input" id="sNamesCopy" value="${esc(item.namesCopy || 'Know Allah through His Beautiful Names.')}"></div><div class="field"><label>Guidance Heading</label><input class="input" id="sGuidanceHeading" value="${esc(item.guidanceHeading || 'Guidance for the Heart')}"></div><div class="field wide"><label>Reflection Title</label><input class="input" id="sReflectionTitle" value="${esc(item.reflectionTitle || 'This dunya is not your final home.')}"></div><div class="field wide"><label>Reflection Supporting Line</label><input class="input" id="sReflectionSupport" value="${esc(item.reflectionSupport || 'Return to Allah.')}"></div><div class="field wide"><label>Instagram Closing Quote</label><input class="input" id="sInstagramQuote" value="${esc(item.instagramQuote || 'Come back whenever your heart needs a reminder.')}"></div></div><div class="form-actions"><button class="premium-btn primary" id="saveSiteContentBtn" type="button">Save Website Content</button></div></section>`;
  $('#saveSiteContentBtn').addEventListener('click', saveSiteContent);
}
function settings() {
  $('#adminMain').innerHTML =
    `${adminHeader('Settings', 'Security and integration status for this single-file deployment.', false)}<section class="admin-panel"><div class="config-note"><strong>Firebase status: ${S.firebaseReady ? 'Connected configuration detected' : 'Configuration required'}</strong><p>Authorized admin email: <code>${esc(ADMIN_EMAIL)}</code></p><p>Content collection: <code>${COLLECTION}</code></p><p>Firebase Storage: <strong>${S.storage ? 'Connected' : 'Not available'}</strong></p><p>Authentication is enforced with Firebase Auth. Firestore and Firebase Storage authorization must also be enforced with Firebase Security Rules. Use Site Content to edit homepage copy, and the content editor to manage Hadith, Duas, Reminders and Names.</p></div></section>`;
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}
