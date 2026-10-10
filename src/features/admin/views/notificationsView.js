/**
 * Admin › Send Notification: queues FCM web-push jobs for the free scheduler.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../../runtime/store';
import { adminHeader } from '../adminRouter';
import { $ } from '../../../runtime/core';
import { addDoc, collection, serverTimestamp } from '../../../services/firebase/sdk';
import { busy, esc, excerpt, label, route, toast } from '../../../utils/ui';

function rudNotificationAdminSources() {
  const verified = (S.adminContent || []).filter(
    (i) => i?.published === true && ['dua', 'hadith', 'reminder'].includes(i.type),
  );
  return [
    {
      value: 'announcement:test',
      label: 'Test Notification',
      category: 'announcement',
      title: 'Rise Upon Deen Test',
      message: 'Your notification connection is working.',
      route: '#home',
    },
    {
      value: 'journey:quran',
      label: "Qur'an Journey",
      category: 'quran',
      title: "Qur'an Reminder",
      message: "Return to your Qur'an journey.",
      route: '#quran',
    },
    {
      value: 'journey:continue-quran',
      label: "Continue Qur'an",
      category: 'continueQuran',
      title: "Continue Qur'an",
      message: 'Continue from your last-read Ayah.',
      route: '#quran',
    },
    {
      value: 'journey:friday-kahf',
      label: 'Friday · Surah Al-Kahf',
      category: 'friday',
      title: 'Friday Reminder',
      message: 'Open Surah Al-Kahf.',
      route: '#quran/18/1',
    },
    ...verified.map((i) => ({
      value: `content:${i.id}`,
      label: `${label(i.type)} · ${i.title || label(i.type)}`,
      category: i.type === 'dua' ? 'newDua' : i.type === 'hadith' ? 'newHadith' : 'daily',
      title: i.title || label(i.type),
      message: excerpt(i, 180),
      route: route(i),
      sourceId: i.id,
      type: i.type,
    })),
    {
      value: 'announcement:manual',
      label: 'Operational announcement',
      category: 'announcement',
      title: '',
      message: '',
      route: '#home',
      manual: true,
    },
  ];
}
function notificationAdminView() {
  $('#adminTopTitle').textContent = 'Send Notification';
  const sources = rudNotificationAdminSources();
  $('#adminMain').innerHTML =
    `${adminHeader('Send Notification', 'Send lightweight FCM Web Push through the free Firestore queue. No paid notification server is required.', false)}
  <section class="admin-panel">
    <div class="rud-push-admin-grid">
      <div class="field wide"><label>Delivery</label><div class="rud-push-config-state" style="margin:0">Free scheduler queue · GitHub Actions checks every 5 minutes · no paid Firebase Functions. For testing, use the Test Notification source.</div></div>
      <div class="field wide"><label>Verified source / action</label><select class="select" id="pnSource">${sources.map((s) => `<option value="${esc(s.value)}">${esc(s.label)}</option>`).join('')}</select></div>
      <div class="field"><label>Category</label><select class="select" id="pnCategory" disabled><option>General</option></select></div>
      <div class="field"><label>Audience</label><select class="select" id="pnAudience"><option value="all">All eligible subscribers</option><option value="app">Installed PWA users</option><option value="browser">Browser users</option><option value="single">Single visitor</option></select></div>
      <div class="field" id="pnRecipientWrap" hidden><label>Visitor ID</label><input class="input" id="pnRecipient" placeholder="Stable visitor ID"></div>
      <div class="field"><label>Destination / action</label><input class="input" id="pnRoute" readonly></div>
      <div class="field"><label>Schedule (optional)</label><input class="input" id="pnScheduleAt" type="datetime-local"></div>
      <div class="field wide"><label>Title</label><input class="input" id="pnTitle" maxlength="120" readonly></div>
      <div class="field wide"><label>Message</label><textarea class="textarea" id="pnMessage" maxlength="280" readonly></textarea></div>
    </div>
    <div class="rud-push-preview"><small>RISE UPON DEEN V2</small><h3 id="pnPreviewTitle">Notification preview</h3><p id="pnPreviewMessage">Choose a verified source.</p></div>
    <div class="rud-push-config-state" id="pnConfigState">Messages are queued securely in Firestore. The free GitHub Actions scheduler processes the queue on its next run. Delivery also respects each visitor’s enabled notification categories.</div>
    <div class="form-actions"><button class="premium-btn primary" id="pnSend" type="button">Send Notification</button><button class="premium-btn" id="pnSchedule" type="button">Schedule Notification</button></div>
  </section>`;
  const byValue = new Map(sources.map((x) => [x.value, x]));
  const source = $('#pnSource'),
    title = $('#pnTitle'),
    message = $('#pnMessage'),
    routeInput = $('#pnRoute'),
    category = $('#pnCategory'),
    previewTitle = $('#pnPreviewTitle'),
    previewMessage = $('#pnPreviewMessage'),
    audience = $('#pnAudience'),
    recipient = $('#pnRecipient'),
    recipientWrap = $('#pnRecipientWrap'),
    scheduleAt = $('#pnScheduleAt');
  const sync = () => {
    const item = byValue.get(source.value) || sources[0];
    category.innerHTML = `<option value="${esc(item.category)}">${esc(item.category)}</option>`;
    routeInput.value = item.route || '#home';
    title.value = item.title || '';
    message.value = item.message || '';
    title.readOnly = !item.manual;
    message.readOnly = !item.manual;
    routeInput.readOnly = !item.manual;
    previewTitle.textContent = title.value || 'Notification preview';
    previewMessage.textContent = message.value || 'Your message will appear here.';
  };
  source.addEventListener('change', sync);
  title.addEventListener('input', () => (previewTitle.textContent = title.value || 'Notification preview'));
  message.addEventListener(
    'input',
    () => (previewMessage.textContent = message.value || 'Your message will appear here.'),
  );
  audience.addEventListener('change', () => {
    recipientWrap.hidden = audience.value !== 'single';
  });
  sync();
  const queueJob = async (payload) => {
    if (!S.firebaseReady || !S.db || !S.auth?.currentUser || !addDoc || !collection || !serverTimestamp)
      throw new Error('Secure admin session is unavailable.');
    return addDoc(collection(S.db, 'push_jobs'), {
      ...payload,
      status: 'queued',
      createdBy: String(S.auth.currentUser.email || ''),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };
  $('#pnSend')?.addEventListener('click', async (e) => {
    if (!S.firebaseReady || !S.auth?.currentUser) return toast('Secure admin session is unavailable.', 'error');
    const item = byValue.get(source.value);
    if (!item) return toast('Choose a notification source.', 'error');
    const payload = {
      sourceKind: item.value.split(':')[0],
      sourceId: item.sourceId || '',
      journey: item.value.startsWith('journey:') ? item.value.split(':')[1] : '',
      category: item.category,
      title: title.value.trim(),
      message: message.value.trim(),
      route: routeInput.value.trim() || '#home',
      audience: audience.value,
      targetVisitorId: recipient.value.trim(),
      dedupeId: `${item.value}:${audience.value}:${recipient.value.trim()}:${Date.now()}`,
      forceTest: item.value === 'announcement:test',
    };
    if (item.manual && (!payload.title || !payload.message)) return toast('Title and message are required.', 'error');
    if (payload.audience === 'single' && !payload.targetVisitorId)
      return toast('Enter a visitor ID for a single-recipient notification.', 'error');
    busy(e.currentTarget, true, 'Queueing…');
    try {
      await queueJob(payload);
      toast('Notification queued. The free scheduler will send it on its next run (normally within 5 minutes).');
    } catch (err) {
      console.error('FCM free queue failed', err);
      toast(err?.message || 'Unable to queue notification.', 'error');
    } finally {
      busy(e.currentTarget, false);
    }
  });
  $('#pnSchedule')?.addEventListener('click', async (e) => {
    if (!S.firebaseReady || !S.auth?.currentUser) return toast('Secure admin session is unavailable.', 'error');
    const item = byValue.get(source.value);
    if (!item) return toast('Choose a notification source.', 'error');
    if (item.manual && (!title.value.trim() || !message.value.trim()))
      return toast('Title and message are required.', 'error');
    if (!scheduleAt.value) return toast('Choose a future date and time.', 'error');
    const when = new Date(scheduleAt.value);
    if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now())
      return toast('Choose a future date and time.', 'error');
    const payload = {
      sourceKind: item.value.split(':')[0],
      sourceId: item.sourceId || '',
      journey: item.value.startsWith('journey:') ? item.value.split(':')[1] : '',
      category: item.category,
      title: title.value.trim(),
      message: message.value.trim(),
      route: routeInput.value.trim() || '#home',
      audience: audience.value,
      targetVisitorId: recipient.value.trim(),
      scheduledAt: when.toISOString(),
      dedupeId: `schedule:${item.value}:${audience.value}:${recipient.value.trim()}:${when.toISOString()}`,
      forceTest: item.value === 'announcement:test',
    };
    if (payload.audience === 'single' && !payload.targetVisitorId)
      return toast('Enter a visitor ID for a single-recipient notification.', 'error');
    busy(e.currentTarget, true, 'Scheduling…');
    try {
      await queueJob(payload);
      toast('Notification scheduled in the free queue.');
      scheduleAt.value = '';
    } catch (err) {
      console.error('FCM free schedule failed', err);
      toast(err?.message || 'Unable to schedule notification.', 'error');
    } finally {
      busy(e.currentTarget, false);
    }
  });
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { notificationAdminView };
