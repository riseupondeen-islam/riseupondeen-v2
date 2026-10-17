/**
 * Admin › Broadcast Message: compose, schedule, start/stop and delete full-screen broadcasts.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../../runtime/store';
import { adminDateTime, adminHeader } from '../adminRouter';
import { RUD_ANALYTICS_COLLECTION } from '../../analytics/visitorAnalytics';
import { RUD_BROADCAST_COLLECTION } from '../../broadcast/broadcast';
import { rudPushSenderEndpoint } from '../../notifications/pushNotifications';
import { categoryAllowed, readNotificationSettings } from '../services/notificationSettings';
import { $, $$ } from '../../../runtime/core';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from '../../../services/firebase/sdk';
import { busy, esc, millis, toast } from '../../../utils/ui';

function broadcastAdminView() {
  $('#adminTopTitle').textContent = 'Broadcast Message';
  $('#adminMain').innerHTML =
    `${adminHeader('Broadcast Message', 'Send a premium full-screen message to website or installed-app users.', false)}
  <section class="admin-panel">
    <div class="broadcast-compose-grid">
      <div class="field"><label>Title</label><input class="input" id="bTitle" maxlength="120" placeholder="A Reminder for You"></div>
      <div class="field"><label>Button Text</label><input class="input" id="bButton" maxlength="40" value="Continue"></div>
      <div class="field wide"><label>Message</label><textarea class="textarea" id="bMessage" maxlength="1200" placeholder="Write the message users should see..."></textarea></div>
      <div class="field"><label>Audience</label><select class="select" id="bAudience"><option value="all">Everyone</option><option value="app">Installed App Users</option><option value="browser">Browser Visitors</option><option value="single">Single Visitor</option></select></div>
      <div class="field" id="bRecipientField" hidden><label>Select Visitor</label><select class="select" id="bRecipient"><option value="">Choose a visitor</option></select></div>
      <div class="field"><label>Expires At <small class="muted">(optional)</small></label><input class="input" id="bEndsAt" type="datetime-local"></div>
      <div class="field wide"><label class="toggle-line"><span class="switch"><input id="bOnce" type="checkbox" checked><span></span></span><span>Show once per visitor</span></label></div>
    </div>
    <div class="broadcast-preview"><small>RISE UPON DEEN</small><h3 id="bPreviewTitle">A Reminder for You</h3><p id="bPreviewMessage">Your message preview will appear here.</p></div>
    <div class="form-actions"><button class="premium-btn primary" id="bSend" type="button">Send Broadcast</button><button class="premium-btn" id="bRefresh" type="button">Refresh Messages</button></div>
  </section>
  <section class="admin-panel" id="broadcastHistory"><div class="empty-live">Loading messages…</div></section>
  <section class="admin-panel" id="broadcastAnalytics"><div class="empty-live">Broadcast analytics will appear after messages are viewed.</div></section>`;

  const title = $('#bTitle'),
    message = $('#bMessage');
  const syncPreview = () => {
    $('#bPreviewTitle').textContent = title.value.trim() || 'A Reminder for You';
    $('#bPreviewMessage').textContent = message.value.trim() || 'Your message preview will appear here.';
  };
  title.addEventListener('input', syncPreview);
  message.addEventListener('input', syncPreview);

  async function loadRecipients() {
    const select = $('#bRecipient');
    if (!select) return;
    try {
      const snap = await getDocs(collection(S.db, RUD_ANALYTICS_COLLECTION));
      const sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const uniqueVisitors = new Map();
      sessions
        .sort((a, b) => millis(b.lastSeenAt) - millis(a.lastSeenAt))
        .forEach((s) => {
          const id = String(s.visitorId || '');
          if (id && !uniqueVisitors.has(id)) {
            uniqueVisitors.set(id, {
              visitorId: id,
              name: String(s.visitorName || '').trim() || `Visitor ${id.slice(-6)}`,
              device: String(s.device || ''),
              lastSeen: s.lastSeenAt,
            });
          }
        });
      select.innerHTML =
        '<option value="">Choose a visitor</option>' +
        [...uniqueVisitors.values()]
          .map(
            (v) =>
              `<option value="${esc(v.visitorId)}">${esc(v.name)}${v.device ? ` · ${esc(v.device)}` : ''}</option>`,
          )
          .join('');
    } catch (e) {
      console.error(e);
    }
  }

  $('#bAudience').addEventListener('change', () => {
    const single = $('#bAudience').value === 'single';
    $('#bRecipientField').hidden = !single;
    if (single) loadRecipients();
  });
  loadRecipients();

  async function loadHistory() {
    const host = $('#broadcastHistory');
    if (!host) return;
    try {
      const snap = await getDocs(collection(S.db, RUD_BROADCAST_COLLECTION));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
      const receiptSnap = await getDocs(collection(S.db, 'broadcast_receipts'));
      const receipts = receiptSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const statFor = (id) => {
        const r = receipts.filter((x) => x.broadcastId === id);
        const shown = new Set(r.filter((x) => x.eventType === 'shown').map((x) => x.visitorId)).size;
        const dismissed = new Set(r.filter((x) => x.eventType === 'dismissed').map((x) => x.visitorId)).size;
        return { shown, dismissed };
      };
      host.innerHTML = rows.length
        ? `<div class="manager-toolbar"><div><strong>Broadcast History</strong><div class="muted">Active and previous in-app messages</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Message</th><th>Audience</th><th>Seen By</th><th>Dismissed</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${rows
        .map(
          (x) => `<tr>
      <td><strong>${esc(x.title || 'A Reminder for You')}</strong><br><small>${esc(String(x.message || '').slice(0, 90))}</small></td>
      <td>${esc(x.audience === 'single' ? `Single · ${x.targetVisitorName || 'Visitor'}` : x.audience === 'app' ? 'Installed App' : x.audience === 'browser' ? 'Browser' : 'Everyone')}</td>
      <td><strong>${statFor(x.id).shown}</strong></td>
      <td><strong>${statFor(x.id).dismissed}</strong></td>
      <td><span class="status-pill ${x.active ? 'live' : ''}">${x.active ? 'Active' : 'Stopped'}</span></td>
      <td>${esc(adminDateTime(x.createdAt))}</td><td class="table-actions">
      ${x.active ? `<button class="mini-action" data-b-stop="${x.id}">Stop</button>` : `<button class="mini-action" data-b-start="${x.id}">Activate</button>`}
      <button class="mini-action danger" data-b-delete="${x.id}">Delete</button></td></tr>`,
        )
        .join('')}</tbody></table></div>`
        : `<div class="empty-live">No broadcast messages yet.</div>`;

      const analyticsHost = $('#broadcastAnalytics');
      if (analyticsHost) {
        analyticsHost.innerHTML = `<div class="manager-toolbar"><div><strong>Broadcast Delivery Analytics</strong><div class="muted">Unique visitors who saw and dismissed each message</div></div></div>
        ${
          rows.length
            ? `<div class="table-wrap"><table><thead><tr><th>Broadcast</th><th>Audience</th><th>Unique Shown</th><th>Unique Dismissed</th><th>Response Rate</th></tr></thead><tbody>${rows
                .map((x) => {
                  const s = statFor(x.id);
                  const rate = s.shown ? Math.round((s.dismissed / s.shown) * 100) : 0;
                  return `<tr><td><strong>${esc(x.title || 'Broadcast')}</strong></td><td>${esc(x.audience === 'single' ? `Single · ${x.targetVisitorName || 'Visitor'}` : x.audience === 'app' ? 'Installed App' : x.audience === 'browser' ? 'Browser' : 'Everyone')}</td><td>${s.shown}</td><td>${s.dismissed}</td><td>${rate}%</td></tr>`;
                })
                .join('')}</tbody></table></div>`
            : `<div class="empty-live">No broadcast analytics yet.</div>`
        }`;
      }

      $$('[data-b-stop]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            await updateDoc(doc(S.db, RUD_BROADCAST_COLLECTION, b.dataset.bStop), {
              active: false,
              updatedAt: serverTimestamp(),
            });
            toast('Broadcast stopped.');
            loadHistory();
          } catch (e) {
            toast('Unable to stop broadcast.', 'error');
          }
        }),
      );
      $$('[data-b-start]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            await updateDoc(doc(S.db, RUD_BROADCAST_COLLECTION, b.dataset.bStart), {
              active: true,
              updatedAt: serverTimestamp(),
            });
            toast('Broadcast activated.');
            loadHistory();
          } catch (e) {
            toast('Unable to activate broadcast.', 'error');
          }
        }),
      );
      $$('[data-b-delete]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('Delete this broadcast message?')) return;
          try {
            await deleteDoc(doc(S.db, RUD_BROADCAST_COLLECTION, b.dataset.bDelete));
            toast('Broadcast deleted.');
            loadHistory();
          } catch (e) {
            toast('Unable to delete broadcast.', 'error');
          }
        }),
      );
    } catch (e) {
      console.error(e);
      host.innerHTML = '<div class="empty-live">Unable to load broadcasts. Check Firestore broadcast rules.</div>';
    }
  }

  $('#bSend').addEventListener('click', async () => {
    const t = title.value.replace(/\s+/g, ' ').trim(),
      msg = message.value.trim();
    if (!t || !msg) {
      toast('Add a title and message first.', 'error');
      return;
    }
    const btn = $('#bSend');
    busy(btn, true, 'Sending…');
    try {
      const endRaw = $('#bEndsAt').value;
      const audience = $('#bAudience').value;
      const targetVisitorId = audience === 'single' ? $('#bRecipient').value : '';
      if (audience === 'single' && !targetVisitorId) {
        toast('Select a visitor first.', 'error');
        busy(btn, false);
        return;
      }
      let targetVisitorName = '';
      if (audience === 'single') {
        const opt = $('#bRecipient').selectedOptions?.[0];
        targetVisitorName = opt ? opt.textContent.split(' · ')[0].trim() : '';
      }

      const broadcastRef = await addDoc(collection(S.db, RUD_BROADCAST_COLLECTION), {
        title: t,
        message: msg,
        buttonText: ($('#bButton').value.trim() || 'Continue').slice(0, 40),
        audience,
        targetVisitorId,
        targetVisitorName,
        oncePerVisitor: $('#bOnce').checked,
        active: true,
        startsAt: serverTimestamp(),
        endsAt: endRaw ? new Date(endRaw) : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      let pushNote = '';
      const endpoint = rudPushSenderEndpoint();
      /* The optional external sender is outside this project's scheduler, so the console only calls it
         when Admin › Notification Settings allows announcement notifications (fails closed). */
      const pushAllowed = endpoint
        ? await readNotificationSettings()
            .then((s) => categoryAllowed(s, 'other'))
            .catch(() => false)
        : false;
      if (endpoint && !pushAllowed) {
        pushNote = ' In-app broadcast published; push delivery is turned off in Notification Settings.';
      } else if (endpoint && S.firebaseReady && S.auth?.currentUser) {
        try {
          const idToken = await S.auth.currentUser.getIdToken();
          const pushResponse = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
              sourceKind: 'broadcast',
              sourceId: broadcastRef.id,
              audience,
              targetVisitorId,
              category: 'announcement',
              title: t,
              message: msg,
              route: '#home',
              dedupeId: `broadcast:${broadcastRef.id}`,
            }),
          });
          const pushResult = await pushResponse.json().catch(() => ({}));
          if (!pushResponse.ok) throw new Error(pushResult.error || `HTTP ${pushResponse.status}`);
          pushNote = ` Push sent to ${Number(pushResult.sent) || 0} eligible installation${Number(pushResult.sent) === 1 ? '' : 's'}.`;
        } catch (pushError) {
          console.warn('Broadcast push delivery unavailable', pushError);
          pushNote = ' In-app broadcast published; push delivery was not available.';
        }
      } else {
        pushNote = ' In-app broadcast published; configure the secure FCM sender to deliver push notifications.';
      }
      title.value = '';
      message.value = '';
      $('#bEndsAt').value = '';
      syncPreview();
      toast(`Broadcast published.${pushNote}`);
      loadHistory();
    } catch (e) {
      console.error(e);
      toast(
        e.code === 'permission-denied'
          ? 'Broadcast permission denied. Update Firestore rules.'
          : 'Unable to send broadcast.',
        'error',
      );
    } finally {
      busy(btn, false);
    }
  });
  $('#bRefresh').addEventListener('click', loadHistory);
  loadHistory();
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { broadcastAdminView };
