/**
 * My Deen: private local journey (history, adhkar, khatam planner, Qur'an goals, daily plan, Ramadan, notes, backup/restore, reading settings, smart home).
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { showPage } from '../../app/routing/surfaces';
import { combinedPublicContent } from '../ask-rise/askRise';
import {
  RUD_PRAYER_KEYS,
  RUD_PUSH_PREF_KEY,
  rudBindReminderCenter,
  rudMirrorPushPrefsToIdb,
  rudPrayerClockText,
  rudPushPrefs,
  rudQueuePushProfileSync,
  rudReminderCenterHtml,
  rudResolvedPrayerSchedule,
  rudSavePushPrefs,
  rudSyncPrayerReminderClock,
} from '../notifications/pushNotifications';
import { rudQuranBookmarks, rudQuranLast, rudQuranSurahs } from '../quran/quran';
import { PUBLIC_CACHE_KEY, PUBLIC_SHARED_CACHE, readPublicCache } from '../../services/content/publicContentCache';
import { esc, favs, label, route, toast } from '../../utils/ui';

let RUD_DEEN_HISTORY_KEY,
  RUD_ADHKAR_PROGRESS_KEY,
  RUD_KHATAM_PLAN_KEY,
  RUD_READING_PREF_KEY,
  RUD_OFFLINE_ITEMS_KEY,
  RUD_QURAN_OFFLINE_KEY,
  RUD_QURAN_MEM_KEY,
  RUD_QURAN_SLEEP_KEY,
  RUD_QURAN_GOAL_KEY,
  RUD_QURAN_ACTIVITY_KEY,
  RUD_DAILY_PLAN_KEY,
  RUD_FASTING_KEY,
  RUD_AYAH_NOTES_KEY,
  RUD_BACKUP_SCHEMA,
  RUD_BACKUP_KEYS,
  RUD_DEEN_TODAY_KEY;

function rudLocalGet(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function rudLocalSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function rudPrayerMap(v = {}) {
  if (v.prayers && typeof v.prayers === 'object')
    return Object.fromEntries(RUD_PRAYER_KEYS.map((k) => [k, !!v.prayers[k]]));
  const old = Math.max(0, Math.min(5, Number(v.prayer) || 0));
  return Object.fromEntries(RUD_PRAYER_KEYS.map((k, i) => [k, i < old]));
}
function rudPrayerCount(v) {
  const map = rudPrayerMap(v);
  return RUD_PRAYER_KEYS.reduce((n, k) => n + (map[k] ? 1 : 0), 0);
}
function rudDeenHistory() {
  const h = rudLocalGet(RUD_DEEN_HISTORY_KEY, {});
  return h && typeof h === 'object' && !Array.isArray(h) ? h : {};
}
function rudTrimHistory(history, limit = 120) {
  const keys = Object.keys(history).sort().reverse();
  keys.slice(limit).forEach((k) => delete history[k]);
  return history;
}
function rudDeenHistoryCommit(day) {
  const h = rudDeenHistory(),
    date = String(day.date || rudDeenDateKey());
  h[date] = {
    date,
    morning: !!day.morning,
    evening: !!day.evening,
    quran: !!day.quran,
    prayers: rudPrayerMap(day),
    prayer: rudPrayerCount(day),
  };
  rudLocalSet(RUD_DEEN_HISTORY_KEY, rudTrimHistory(h));
}
function rudRecordDeenActivity(kind, value = true) {
  const day = rudDeenToday();
  if (kind === 'quran') day.quran = !!value;
  if (kind === 'morning') day.morning = !!value;
  if (kind === 'evening') day.evening = !!value;
  rudSaveDeenToday(day);
}
function rudDayKeyOffset(offset) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rudDeenStreak(kind) {
  const h = rudDeenHistory(),
    today = rudDeenToday();
  h[today.date] = { ...today, prayers: rudPrayerMap(today), prayer: rudPrayerCount(today) };
  const qualifies = (d) =>
    kind === 'quran'
      ? !!d?.quran
      : kind === 'adhkar'
        ? !!d?.morning && !!d?.evening
        : kind === 'prayer'
          ? rudPrayerCount(d) >= 5
          : false;
  let start = 0;
  if (!qualifies(h[rudDayKeyOffset(0)]) && qualifies(h[rudDayKeyOffset(-1)])) start = -1;
  else if (!qualifies(h[rudDayKeyOffset(0)])) return 0;
  let streak = 0;
  for (let i = start; i > -370; i--) {
    if (!qualifies(h[rudDayKeyOffset(i)])) break;
    streak++;
  }
  return streak;
}
function rudReadingPrefs() {
  return {
    ...{
      arabicSize: 'normal',
      translationSize: 'normal',
      lineSpacing: 'normal',
      urduVisible: false,
      reducedMotion: false,
      highContrast: false,
      largeText: false,
      focusReading: false,
      studyMode: false,
      dataSaver: false,
    },
    ...rudLocalGet(RUD_READING_PREF_KEY, {}),
  };
}
function rudApplyReadingPrefs() {
  const p = rudReadingPrefs(),
    root = document.documentElement;
  root.classList.toggle('rud-reduced-motion', !!p.reducedMotion);
  root.classList.toggle('rud-high-contrast', !!p.highContrast);
  root.classList.toggle('rud-large-text', !!p.largeText);
  root.classList.toggle('rud-focus-reading', !!p.focusReading);
  const ar = { small: '1.8rem', normal: '2.15rem', large: '2.55rem', xl: '3rem' }[p.arabicSize] || '2.15rem',
    tr = { small: '13px', normal: '14px', large: '16px', xl: '18px' }[p.translationSize] || '14px',
    lh = { compact: '1.65', normal: '2.05', relaxed: '2.35' }[p.lineSpacing] || '2.05';
  root.style.setProperty('--rud-reader-arabic-size', ar);
  root.style.setProperty('--rud-reader-translation-size', tr);
  root.style.setProperty('--rud-reader-line-height', lh);
}
function rudSaveReadingPrefs(p) {
  rudLocalSet(RUD_READING_PREF_KEY, p);
  rudApplyReadingPrefs();
}
function rudDataSaverEnabled() {
  return rudReadingPrefs().dataSaver === true;
}
function rudOfflineItems() {
  const a = rudLocalGet(RUD_OFFLINE_ITEMS_KEY, []);
  return Array.isArray(a) ? a : [];
}
function rudOfflineHas(id) {
  return rudOfflineItems().some((x) => x && x.id === id);
}
function rudOfflineSaveItem(item) {
  if (!item?.id) return false;
  const allowed = [
    'id',
    'type',
    'title',
    'name',
    'arabic',
    'transliteration',
    'meaning',
    'translation',
    'content',
    'description',
    'reflection',
    'reference',
    'source',
    'category',
    'number',
    'whenToRecite',
    'author',
    'createdAt',
    'published',
  ];
  const clean = {};
  allowed.forEach((k) => {
    if (item[k] !== undefined && typeof item[k] !== 'function') clean[k] = item[k];
  });
  clean.published = true;
  let list = rudOfflineItems().filter((x) => x.id !== clean.id);
  list.unshift(clean);
  list = list.slice(0, 100);
  return rudLocalSet(RUD_OFFLINE_ITEMS_KEY, list);
}
function rudOfflineRemoveItem(id) {
  return rudLocalSet(
    RUD_OFFLINE_ITEMS_KEY,
    rudOfflineItems().filter((x) => x.id !== id),
  );
}
function rudOfflineAction(id) {
  return `<button type="button" class="premium-btn" data-offline="${esc(id)}">${rudOfflineHas(id) ? 'Available Offline' : 'Make Available Offline'}</button>`;
}
function rudOfflineCount() {
  return rudOfflineItems().length + Object.keys(rudLocalGet(RUD_QURAN_OFFLINE_KEY, {})).length;
}
function rudContentHay(i) {
  return [i?.title, i?.name, i?.category, i?.description, i?.content, i?.meaning, i?.reflection, i?.whenToRecite]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
function rudFindExistingContent(type, words) {
  const set = Array.isArray(words) ? words : [words];
  return combinedPublicContent().find(
    (i) => (!type || i.type === type) && set.some((w) => rudContentHay(i).includes(String(w).toLowerCase())),
  );
}
function rudAdhkarItems(period) {
  const morning = ['morning', 'fajr', 'sabah', ' الصباح', 'صباح'],
    evening = ['evening', 'maghrib', 'masa', 'المساء', 'مساء'],
    words = period === 'morning' ? morning : evening;
  return combinedPublicContent()
    .filter((i) => i.type === 'zikr' && words.some((w) => rudContentHay(i).includes(w)))
    .sort((a, b) => (Number(a.displayOrder) || 999) - (Number(b.displayOrder) || 999));
}
function rudAdhkarProgressAll() {
  const p = rudLocalGet(RUD_ADHKAR_PROGRESS_KEY, {});
  return p && typeof p === 'object' ? p : {};
}
function rudAdhkarState(period, total) {
  const all = rudAdhkarProgressAll(),
    key = `${rudDeenDateKey()}:${period}`,
    v = all[key] || {};
  return {
    key,
    index: Math.max(0, Math.min(Math.max(0, total - 1), Number(v.index) || 0)),
    repeat: Math.max(0, Number(v.repeat) || 0),
    complete: !!v.complete,
  };
}
function rudSaveAdhkarState(state) {
  const all = rudAdhkarProgressAll();
  all[state.key] = { index: state.index, repeat: state.repeat, complete: !!state.complete, updatedAt: Date.now() };
  const keys = Object.keys(all).sort().reverse();
  keys.slice(45).forEach((k) => delete all[k]);
  rudLocalSet(RUD_ADHKAR_PROGRESS_KEY, all);
}
function rudAdhkarTarget(item) {
  const n = Number(item?.recommendedCount);
  return Number.isFinite(n) && n > 0 ? Math.min(100, n) : 1;
}
function rudGuidedAdhkarHtml(period) {
  const items = rudAdhkarItems(period),
    title = period === 'morning' ? 'Morning Adhkar' : 'Evening Adhkar';
  if (!items.length)
    return `<article class="rud-utility-card"><span class="rud-deen-label">${title}</span><h3>No verified ${period} Adhkar are currently published.</h3><p>This flow only uses existing verified Zikr records and will appear automatically when matching content is available.</p></article>`;
  const st = rudAdhkarState(period, items.length);
  if (st.complete)
    return `<article class="rud-utility-card"><span class="rud-deen-label">${title}</span><h3>Alhamdulillah</h3><p>${title} Completed</p><button class="premium-btn" type="button" data-rud-adhkar-restart="${period}">Review again</button></article>`;
  const i = items[st.index],
    target = rudAdhkarTarget(i),
    count = Math.min(st.repeat, target);
  return `<article class="rud-utility-card rud-guided-adhkar" data-rud-adhkar-period="${period}"><span class="rud-deen-label">${title}</span><h3>${String(st.index + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')} · ${esc(i.title || 'Adhkar')}</h3>${i.arabic ? `<div class="rud-guided-arabic" lang="ar" dir="rtl">${esc(i.arabic)}</div>` : ''}${i.transliteration ? `<p><strong>Transliteration</strong><br>${esc(i.transliteration)}</p>` : ''}${i.meaning ? `<p><strong>Meaning</strong><br>${esc(i.meaning)}</p>` : ''}${i.reference || i.source ? `<p><strong>Reference</strong><br>${esc([i.reference, i.source].filter(Boolean).join(' · '))}</p>` : ''}<div class="rud-guided-progress"><strong>Repeat · ${count} of ${target}</strong></div><div class="rud-inline-actions"><button class="rud-mini-btn" type="button" data-rud-adhkar-prev="${period}" ${st.index <= 0 ? 'disabled' : ''}>← Previous</button><button class="rud-mini-btn" type="button" data-rud-adhkar-repeat="${period}" ${count >= target ? 'disabled' : ''}>${count >= target ? 'Completed ✓' : 'Repeat'}</button><button class="rud-mini-btn" type="button" data-rud-adhkar-next="${period}" ${count < target ? 'disabled' : ''}>${st.index === items.length - 1 ? 'Finish' : 'Next →'}</button></div></article>`;
}
function rudOpenGuidedAdhkar(period) {
  const mount = document.getElementById('rudDeenFlowMount');
  if (!mount) return;
  mount.innerHTML = rudGuidedAdhkarHtml(period);
  requestAnimationFrame(() => mount.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}
function rudMoveAdhkar(period, action) {
  const items = rudAdhkarItems(period);
  if (!items.length) return rudOpenGuidedAdhkar(period);
  const st = rudAdhkarState(period, items.length),
    target = rudAdhkarTarget(items[st.index]);
  if (action === 'repeat') st.repeat = Math.min(target, st.repeat + 1);
  if (action === 'prev') {
    st.index = Math.max(0, st.index - 1);
    st.repeat = 0;
  }
  if (action === 'next') {
    if (st.index === items.length - 1) {
      st.complete = true;
      rudRecordDeenActivity(period, true);
    } else {
      st.index++;
      st.repeat = 0;
    }
  }
  if (action === 'restart') {
    st.index = 0;
    st.repeat = 0;
    st.complete = false;
  }
  rudSaveAdhkarState(st);
  rudOpenGuidedAdhkar(period);
}
function rudModeCard(title, body, actions) {
  return `<article class="rud-utility-card"><span class="rud-deen-label">DEEN MODE</span><h3>${title}</h3><p>${body}</p><div class="rud-inline-actions">${actions}</div></article>`;
}
function rudRenderDeenMode(mode) {
  const mount = document.getElementById('rudDeenFlowMount');
  if (!mount) return;
  const last = typeof rudQuranLast === 'function' ? rudQuranLast() : null,
    continueRoute = last?.surah ? `#quran/${last.surah}/${last.ayah || 1}` : '#quran';
  if (mode === 'morning') {
    const reminder = rudFindExistingContent('reminder', ['morning', 'today', 'daily']);
    mount.innerHTML = rudModeCard(
      'Morning Mode',
      `Begin with the verified content already available in Rise Upon Deen. Prayer tracker: ${rudPrayerCount(rudDeenToday())}/5 today.`,
      `<button class="rud-mini-btn" type="button" data-rud-adhkar-open="morning">Morning Adhkar</button>${reminder ? `<a class="rud-mini-btn" href="${route(reminder)}">Daily Reminder</a>` : ''}<a class="rud-mini-btn" href="${continueRoute}">Continue Qur'an</a><a class="rud-mini-btn" href="#prayer">Prayer</a>`,
    );
  } else if (mode === 'night') {
    const dua = rudFindExistingContent('dua', ['sleep', 'bed', 'night']);
    mount.innerHTML = rudModeCard(
      'Night Mode',
      "A quiet path using your existing evening, sleep and Qur'an tools.",
      `<button class="rud-mini-btn" type="button" data-rud-adhkar-open="evening">Evening Adhkar</button>${dua ? `<a class="rud-mini-btn" href="${route(dua)}">Sleep Dua</a>` : ''}<a class="rud-mini-btn" href="${continueRoute}" data-rud-open-sleep>Qur'an Sleep Timer</a><a class="rud-mini-btn" href="${continueRoute}">Continue Qur'an</a>`,
    );
  } else if (mode === 'after-salah') {
    const items = combinedPublicContent()
      .filter(
        (i) =>
          i.type === 'zikr' &&
          ['after salah', 'after prayer', 'post prayer', 'after fard', 'after fardh'].some((w) =>
            rudContentHay(i).includes(w),
          ),
      )
      .slice(0, 5);
    mount.innerHTML = rudModeCard(
      'After Salah Mode',
      items.length
        ? 'Only existing verified post-prayer content is shown here.'
        : 'No verified post-prayer Adhkar are currently published in the managed content.',
      items.length
        ? items.map((i) => `<a class="rud-mini-btn" href="#tasbih/choose">${esc(i.title || 'Adhkar')}</a>`).join('')
        : `<a class="rud-mini-btn" href="#tasbih/choose">Open Adhkar</a>`,
    );
  } else {
    const dua = rudFindExistingContent('dua', ['travel', 'journey', 'travelling']);
    mount.innerHTML = rudModeCard(
      'Travel Mode',
      'Use your existing travel Dua, Qibla, prayer and offline collection together.',
      `${dua ? `<a class="rud-mini-btn" href="${route(dua)}">Travel Dua</a>` : ''}<a class="rud-mini-btn" href="#prayer">Qibla & Prayer</a><a class="rud-mini-btn" href="#saved">Saved & Offline</a>`,
    );
  }
  requestAnimationFrame(() => mount.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}
function rudKhatamPlan() {
  const v = rudLocalGet(RUD_KHATAM_PLAN_KEY, null);
  return v && typeof v === 'object' ? v : { days: 30, customDays: 30, startDate: rudDeenDateKey(), completedDays: [] };
}
function rudKhatamPlanDays(p = rudKhatamPlan()) {
  const n = p.days === 'custom' ? Number(p.customDays) : Number(p.days);
  return Math.max(1, Math.min(365, Number.isFinite(n) ? n : 30));
}
function rudKhatamPlannerStats(snapshot) {
  const p = rudKhatamPlan(),
    days = rudKhatamPlanDays(p),
    meta = rudQuranMetaLocal(),
    total = meta.reduce((n, x) => n + (Number(x.numberOfAyahs) || 0), 0),
    read = total ? Math.round(total * (snapshot.percent / 100)) : 0,
    remaining = Math.max(0, total - read),
    target = total ? Math.ceil(total / days) : 0;
  return { p, days, total, read, remaining, target };
}
function rudSaveKhatamChoice(days, customDays) {
  const current = rudKhatamPlan(),
    value = days === 'custom' ? 'custom' : Math.max(1, Number(days) || 30);
  rudLocalSet(RUD_KHATAM_PLAN_KEY, {
    ...current,
    days: value,
    customDays: Math.max(1, Math.min(365, Number(customDays) || 30)),
    startDate: current.startDate || rudDeenDateKey(),
    completedDays: Array.isArray(current.completedDays) ? current.completedDays : [],
  });
}
function rudMarkKhatamDay() {
  const p = rudKhatamPlan(),
    days = new Set(Array.isArray(p.completedDays) ? p.completedDays : []);
  days.add(rudDeenDateKey());
  p.completedDays = [...days].sort().slice(-365);
  p.currentProgress = typeof rudQuranLast === 'function' ? rudQuranLast() : p.currentProgress || null;
  rudLocalSet(RUD_KHATAM_PLAN_KEY, p);
}
function rudQuranGoal() {
  const v = rudLocalGet(RUD_QURAN_GOAL_KEY, null),
    type = ['ayahs', 'minutes'].includes(v?.type) ? v.type : 'ayahs',
    target = Math.max(1, Math.min(type === 'minutes' ? 180 : 300, Number(v?.target) || 5));
  return { type, target };
}
function rudSaveQuranGoal(next) {
  const type = ['ayahs', 'minutes'].includes(next?.type) ? next.type : 'ayahs',
    target = Math.max(1, Math.min(type === 'minutes' ? 180 : 300, Number(next?.target) || 5));
  rudLocalSet(RUD_QURAN_GOAL_KEY, { type, target });
}
function rudQuranDailyActivity() {
  const fallback = { date: rudDeenDateKey(), ayahs: [], seconds: 0, lastAt: 0 },
    v = rudLocalGet(RUD_QURAN_ACTIVITY_KEY, null);
  if (!v || v.date !== fallback.date) return fallback;
  return { ...fallback, ...v, ayahs: Array.isArray(v.ayahs) ? v.ayahs : [] };
}
function rudTrackQuranLocalActivity(ref) {
  const now = Date.now(),
    v = rudQuranDailyActivity(),
    key = String(ref || '');
  if (key && !v.ayahs.includes(key)) v.ayahs.push(key);
  const gap = v.lastAt ? Math.max(0, Math.min(120000, now - Number(v.lastAt) || 0)) : 0;
  if (gap > 0) v.seconds = Math.min(24 * 3600, Math.max(0, Number(v.seconds) || 0) + gap / 1000);
  v.lastAt = now;
  v.ayahs = v.ayahs.slice(-500);
  rudLocalSet(RUD_QURAN_ACTIVITY_KEY, v);
  return v;
}
function rudQuranGoalStats() {
  const goal = rudQuranGoal(),
    activity = rudQuranDailyActivity(),
    value = goal.type === 'minutes' ? Math.floor((Number(activity.seconds) || 0) / 60) : activity.ayahs.length,
    percent = Math.max(0, Math.min(100, (value / goal.target) * 100));
  return { goal, activity, value, percent, complete: value >= goal.target };
}
function rudQuranGoalEditorHtml() {
  const g = rudQuranGoal();
  return `<article class="rud-utility-card rud-personal-editor"><span class="rud-deen-label">QUR'AN READING GOAL</span><h3>Private daily goal</h3><div class="rud-setting-grid"><label>Measure<select data-rud-goal="type"><option value="ayahs" ${g.type === 'ayahs' ? 'selected' : ''}>Ayahs</option><option value="minutes" ${g.type === 'minutes' ? 'selected' : ''}>Minutes</option></select></label><label>Daily target<input class="rud-quran-select" data-rud-goal="target" type="number" min="1" max="${g.type === 'minutes' ? 180 : 300}" value="${g.target}"></label></div><p>Progress stays on this device. There are no points, rankings or public streaks.</p></article>`;
}
function rudQuranGoalCardHtml() {
  const st = rudQuranGoalStats(),
    unit = st.goal.type === 'minutes' ? 'min' : 'Ayahs';
  return `<article class="rud-utility-card"><span class="rud-deen-label">TODAY'S QUR'AN</span><h3>${st.value} / ${st.goal.target} ${unit}</h3><div class="rud-progress-track" aria-label="Qur'an goal progress"><div class="rud-progress-fill" style="width:${st.percent.toFixed(2)}%"></div></div><p>${st.complete ? 'Today’s reading goal is complete.' : 'A gentle private target for today.'}</p><button class="premium-btn" id="rudOpenGoalSettings" type="button">Reading goal</button></article>`;
}
function rudDailyPlan() {
  const v = rudLocalGet(RUD_DAILY_PLAN_KEY, null);
  return {
    enabled: !!v?.enabled,
    items: {
      quran: v?.items?.quran !== false,
      morning: v?.items?.morning !== false,
      evening: v?.items?.evening !== false,
      prayer: v?.items?.prayer !== false,
      readingGoal: v?.items?.readingGoal !== false,
    },
  };
}
function rudSaveDailyPlan(v) {
  rudLocalSet(RUD_DAILY_PLAN_KEY, { enabled: !!v?.enabled, items: { ...rudDailyPlan().items, ...(v?.items || {}) } });
}
function rudDailyPlanProgress(today = rudDeenToday()) {
  const p = rudDailyPlan(),
    goal = rudQuranGoalStats(),
    rows = [];
  if (p.items.morning) rows.push(['Morning Adhkar', !!today.morning]);
  if (p.items.quran) rows.push(["Qur'an", !!today.quran]);
  if (p.items.prayer) rows.push(['Prayer', rudPrayerCount(today) >= 5]);
  if (p.items.readingGoal) rows.push(['Reading Goal', goal.complete]);
  if (p.items.evening) rows.push(['Evening Adhkar', !!today.evening]);
  return { p, rows, done: rows.filter((x) => x[1]).length };
}
function rudDailyPlanCardHtml(today) {
  const st = rudDailyPlanProgress(today);
  return `<article class="rud-utility-card"><span class="rud-deen-label">MY DAILY DEEN</span><h3>${st.p.enabled ? `${st.done} / ${st.rows.length} today` : 'Private daily plan'}</h3>${st.p.enabled ? `<div class="rud-personal-checklist">${st.rows.map(([label, done]) => `<div><span>${esc(label)}</span><b>${done ? '✓' : '○'}</b></div>`).join('')}</div>` : `<p>Choose a small set of existing Deen tools to keep together each day.</p>`}<button class="premium-btn" id="rudOpenDailyPlanSettings" type="button">${st.p.enabled ? 'Manage plan' : 'Create plan'}</button></article>`;
}
function rudDailyPlanEditorHtml() {
  const p = rudDailyPlan(),
    defs = [
      ['quran', "Qur'an"],
      ['morning', 'Morning Adhkar'],
      ['evening', 'Evening Adhkar'],
      ['prayer', 'Prayer Tracker'],
      ['readingGoal', 'Reading Goal'],
    ];
  return `<article class="rud-utility-card rud-personal-editor"><span class="rud-deen-label">MY DAILY DEEN</span><h3>Daily plan</h3><label class="rud-setting-toggle"><span>Use Daily Deen Plan</span><input type="checkbox" data-rud-plan-enabled ${p.enabled ? 'checked' : ''}></label><div class="rud-setting-grid">${defs.map(([k, l]) => `<label class="rud-setting-toggle"><span>${l}</span><input type="checkbox" data-rud-plan-item="${k}" ${p.items[k] ? 'checked' : ''}></label>`).join('')}</div><p>Only existing features are grouped here. Your plan stays on this device.</p></article>`;
}
function rudHijriInfo(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).formatToParts(date),
      numParts = new Intl.DateTimeFormat('en-u-ca-islamic', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
      }).formatToParts(date),
      get = (list, t) => list.find((x) => x.type === t)?.value || '';
    return {
      day: Number(get(numParts, 'day')) || 0,
      month: Number(get(numParts, 'month')) || 0,
      year: Number(get(numParts, 'year')) || 0,
      label: `${get(parts, 'day')} ${get(parts, 'month')} ${get(parts, 'year')} AH`,
      gregorian: new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(date),
    };
  } catch {
    return {
      day: 0,
      month: 0,
      year: 0,
      label: 'Hijri date unavailable',
      gregorian: new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(date),
    };
  }
}
function rudRamadanFasting() {
  const v = rudLocalGet(RUD_FASTING_KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
function rudRamadanFastedToday() {
  return rudRamadanFasting()[rudDeenDateKey()] === true;
}
function rudToggleRamadanFast() {
  const all = rudRamadanFasting(),
    key = rudDeenDateKey();
  all[key] = !all[key];
  const keys = Object.keys(all).sort().reverse();
  keys.slice(60).forEach((k) => delete all[k]);
  rudLocalSet(RUD_FASTING_KEY, all);
  return all[key];
}
function rudStartRamadanKhatam() {
  const h = rudHijriInfo(),
    remaining = Math.max(1, 30 - (Number(h.day) || 1) + 1),
    current = rudKhatamPlan();
  rudLocalSet(RUD_KHATAM_PLAN_KEY, {
    ...current,
    days: 'custom',
    customDays: remaining,
    startDate: current.startDate || rudDeenDateKey(),
    completedDays: Array.isArray(current.completedDays) ? current.completedDays : [],
  });
  return remaining;
}
function rudHijriRamadanCardHtml() {
  const h = rudHijriInfo(),
    ramadan = h.month === 9;
  return `<article class="rud-utility-card"><span class="rud-deen-label">HIJRI DATE</span><h3>${esc(h.label)}</h3><p>${esc(h.gregorian)}<br><small>Dates may vary by local moon sighting.</small></p>${ramadan ? `<div class="rud-ramadan-actions"><button type="button" class="rud-mini-btn ${rudRamadanFastedToday() ? 'active' : ''}" data-rud-fast-toggle>${rudRamadanFastedToday() ? 'Fast recorded ✓' : "Record today's fast"}</button><button type="button" class="rud-mini-btn" data-rud-ramadan-khatam>Ramadan Qur'an plan</button></div>` : ''}</article>`;
}
function rudAyahNotes() {
  const v = rudLocalGet(RUD_AYAH_NOTES_KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
function rudAyahNote(ref) {
  return String(rudAyahNotes()[String(ref || '')] || '');
}
function rudSaveAyahNote(ref, text) {
  const all = rudAyahNotes(),
    key = String(ref || ''),
    clean = String(text || '')
      .trim()
      .slice(0, 5000);
  if (clean) all[key] = clean;
  else delete all[key];
  rudLocalSet(RUD_AYAH_NOTES_KEY, all);
  return clean;
}
function rudBackupSanitize(key, value) {
  if (key !== 'rud_push_preferences_v2') return value;
  return value && typeof value === 'object'
    ? {
        enabled: !!value.enabled,
        categories: value.categories && typeof value.categories === 'object' ? value.categories : {},
        reminderTime: String(value.reminderTime || '08:00'),
      }
    : null;
}
function rudExportMyDeen() {
  const data = {};
  for (const key of RUD_BACKUP_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) data[key] = rudBackupSanitize(key, JSON.parse(raw));
    } catch {}
  }
  const payload = { app: 'Rise Upon Deen', schema: RUD_BACKUP_SCHEMA, exportedAt: new Date().toISOString(), data },
    blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rise-upon-deen-backup-${rudDeenDateKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
  toast('My Deen backup created.');
}
async function rudRestoreMyDeenFile(file) {
  if (!file || file.size > 2 * 1024 * 1024) throw new Error('Backup file is too large.');
  const parsed = JSON.parse(await file.text());
  if (
    parsed?.app !== 'Rise Upon Deen' ||
    Number(parsed?.schema) !== RUD_BACKUP_SCHEMA ||
    !parsed.data ||
    typeof parsed.data !== 'object' ||
    Array.isArray(parsed.data)
  )
    throw new Error('This is not a compatible Rise Upon Deen backup.');
  const entries = Object.entries(parsed.data).filter(([k]) => RUD_BACKUP_KEYS.includes(k));
  if (!entries.length) throw new Error('No supported personal data was found in this backup.');
  if (!confirm('Restore this My Deen backup? Current supported local personal data will be replaced.')) return false;
  for (const key of RUD_BACKUP_KEYS) localStorage.removeItem(key);
  let restoredPush = null;
  for (const [key, value] of entries) {
    const clean = rudBackupSanitize(key, value);
    if (clean === undefined || clean === null) continue;
    if (key === RUD_PUSH_PREF_KEY && typeof rudSavePushPrefs === 'function') restoredPush = rudSavePushPrefs(clean);
    else localStorage.setItem(key, JSON.stringify(clean));
  }
  if (restoredPush) {
    await rudMirrorPushPrefsToIdb(restoredPush);
    rudSyncPrayerReminderClock();
    if (restoredPush.enabled && 'Notification' in window && Notification.permission === 'granted')
      rudQueuePushProfileSync();
  }
  rudApplyReadingPrefs();
  toast('My Deen backup restored.');
  return true;
}
function rudChooseRestoreFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener('cancel', () => input.remove(), { once: true });
  input.addEventListener(
    'change',
    async () => {
      try {
        if (input.files?.[0] && (await rudRestoreMyDeenFile(input.files[0]))) rudRenderMyDeen(true);
      } catch (e) {
        toast(e?.message || 'Unable to restore this backup.', 'error');
      } finally {
        input.remove();
      }
    },
    { once: true },
  );
  input.click();
}
async function rudClearOfflineSource(kind) {
  if (kind === 'quran') {
    localStorage.removeItem(RUD_QURAN_OFFLINE_KEY);
    toast("Offline Qur'an text removed. Bookmarks and progress were kept.");
  } else if (kind === 'guidance') {
    localStorage.removeItem(RUD_OFFLINE_ITEMS_KEY);
    toast('Selected offline guidance removed. Saved items were kept.');
  } else if (kind === 'cache') {
    try {
      localStorage.removeItem(PUBLIC_CACHE_KEY);
      await caches.delete(PUBLIC_SHARED_CACHE);
    } catch {}
    toast('Refreshable public cache cleared. Personal data was kept.');
  }
  rudRenderMyDeen(true);
}
function rudBackupStorageCardHtml() {
  return `<article class="rud-utility-card"><span class="rud-deen-label">LOCAL BACKUP</span><h3>Backup My Deen</h3><p>Export or restore supported private progress and preferences. Cached source content and notification tokens are excluded.</p><div class="rud-inline-actions"><button class="rud-mini-btn" type="button" data-rud-backup-export>Backup</button><button class="rud-mini-btn" type="button" data-rud-backup-restore>Restore</button></div></article><article class="rud-utility-card"><span class="rud-deen-label">OFFLINE STORAGE</span><h3>Storage management</h3><p>Clear downloaded/cache content separately without deleting personal bookmarks, notes or progress.</p><div class="rud-inline-actions"><button class="rud-mini-btn" type="button" data-rud-storage-clear="quran">Qur'an text</button><button class="rud-mini-btn" type="button" data-rud-storage-clear="guidance">Guidance</button><button class="rud-mini-btn" type="button" data-rud-storage-clear="cache">Public cache</button></div></article>`;
}
function rudPersonalSettingsOpen(kind) {
  const mount = document.getElementById('rudPersonalSettingsMount');
  if (!mount) return;
  const html = kind === 'goal' ? rudQuranGoalEditorHtml() : rudDailyPlanEditorHtml();
  if (mount.dataset.kind === kind && mount.innerHTML.trim()) {
    mount.innerHTML = '';
    mount.dataset.kind = '';
    return;
  }
  mount.dataset.kind = kind;
  mount.innerHTML = html;
  requestAnimationFrame(() =>
    mount.scrollIntoView({ behavior: rudReadingPrefs().reducedMotion ? 'auto' : 'smooth', block: 'nearest' }),
  );
}
function rudReadingSettingsHtml() {
  const p = rudReadingPrefs(),
    opt = (value, label, current) =>
      `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
  return `<article class="rud-utility-card rud-reading-settings"><span class="rud-deen-label">READING & ACCESSIBILITY</span><h3>Reading controls</h3><div class="rud-setting-grid"><label>Arabic font size<select data-rud-reading="arabicSize">${opt('small', 'Small', p.arabicSize)}${opt('normal', 'Normal', p.arabicSize)}${opt('large', 'Large', p.arabicSize)}${opt('xl', 'Extra large', p.arabicSize)}</select></label><label>Translation font size<select data-rud-reading="translationSize">${opt('small', 'Small', p.translationSize)}${opt('normal', 'Normal', p.translationSize)}${opt('large', 'Large', p.translationSize)}${opt('xl', 'Extra large', p.translationSize)}</select></label><label>Line spacing<select data-rud-reading="lineSpacing">${opt('compact', 'Compact', p.lineSpacing)}${opt('normal', 'Normal', p.lineSpacing)}${opt('relaxed', 'Relaxed', p.lineSpacing)}</select></label>${[
    ['urduVisible', 'Urdu visibility'],
    ['reducedMotion', 'Reduced motion'],
    ['highContrast', 'High contrast'],
    ['largeText', 'Large text'],
    ['focusReading', 'Focus Reading Mode'],
    ['studyMode', 'Qur’an Study Mode'],
    ['dataSaver', 'Data Saver'],
  ]
    .map(
      ([key, label]) =>
        `<label class="rud-setting-toggle"><span>${label}</span><input type="checkbox" data-rud-reading="${key}" ${p[key] ? 'checked' : ''}></label>`,
    )
    .join(
      '',
    )}</div><p>Data Saver disables audio preloading, avoids automatic offline downloads, and prefers content already cached on this device.</p></article>`;
}
function rudOpenReadingSettings() {
  const mount = document.getElementById('rudReadingSettingsMount');
  if (!mount) return;
  if (mount.innerHTML.trim()) {
    mount.innerHTML = '';
    return;
  }
  mount.innerHTML = rudReadingSettingsHtml();
  requestAnimationFrame(() => mount.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}
function rudSmartHomeLastRoute() {
  try {
    const last = JSON.parse(localStorage.getItem('rud_quran_last_read_v1') || 'null');
    return last?.surah ? `#quran/${Number(last.surah)}/${Number(last.ayah) || 1}` : '#quran';
  } catch {
    return '#quran';
  }
}
function rudSmartHomeRamadan() {
  try {
    return Number(new Intl.DateTimeFormat('en-u-ca-islamic', { month: 'numeric' }).format(new Date())) === 9;
  } catch {
    return false;
  }
}
function rudSyncSmartHome() {
  const host = document.getElementById('rudSmartHome');
  if (!host) return;
  const hour = new Date().getHours(),
    quran = rudSmartHomeLastRoute(),
    prayer = '<a href="#prayer">Next Prayer</a>',
    continueQuran = `<a href="${quran}">Continue Qur'an</a>`;
  let label = 'Today',
    actions = '';
  if (hour < 11) {
    label = 'Morning';
    actions = `<a href="#my-deen/morning">Morning Adhkar</a>${prayer}${continueQuran}`;
  } else if (hour >= 17) {
    label = 'Evening';
    actions = `<a href="#my-deen/evening">Evening Adhkar</a>${prayer}${continueQuran}`;
  } else {
    const reminder =
      typeof rudFindExistingContent === 'function' ? rudFindExistingContent('reminder', ['today', 'daily']) : null;
    label = 'Today';
    actions = `${prayer}${continueQuran}${reminder ? `<a href="${route(reminder)}">Daily Reminder</a>` : ''}`;
  }
  if (rudSmartHomeRamadan()) {
    label = 'Ramadan';
    actions = `<a href="#my-deen">Ramadan</a>${prayer}${continueQuran}`;
  }
  const html = `<span>${label}</span><div>${actions}</div>`;
  if (host.dataset.rudSig !== html) {
    host.dataset.rudSig = html;
    host.innerHTML = html;
  }
}
function rudFridayReminder() {
  return combinedPublicContent().find(
    (i) =>
      i.type !== 'site' && ['friday', 'jumuah', "jumu'ah", 'jummah', 'kahf'].some((w) => rudContentHay(i).includes(w)),
  );
}
/* V3.1: Friday and Ramadan modes share one occasion card (their own layout — the Friday card used to
   reuse the two-column Dua/Hadith ribbon grid, which squeezed its actions into the 74px divider). */
const RUD_OCCASION_ICONS = {
  friday:
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V12.5c1.6-3.8 4.6-5.9 8-5.9s6.4 2.1 8 5.9V20Z"/><path d="M12 2.6v2.2M2.5 20h19M9.6 20v-4a2.4 2.4 0 0 1 4.8 0v4"/></svg>',
  ramadan:
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 3.2A8.6 8.6 0 1 0 20.8 15 6.9 6.9 0 1 1 14.5 3.2Z"/><path d="M18.4 4.3l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6Z"/></svg>',
};
function rudOccasionSectionHtml(kind, kicker, title, subtitle, links) {
  return `<div class="shell"><div class="rud-occasion-card is-${kind}"><span class="rud-occasion-glow" aria-hidden="true"></span><span class="rud-occasion-icon">${RUD_OCCASION_ICONS[kind]}</span><div class="rud-occasion-copy"><span class="rud-occasion-kicker">${kicker}</span><strong>${title}</strong><span>${subtitle}</span></div><div class="rud-occasion-actions">${links}</div></div></div>`;
}
function rudPlaceOccasion(id, html) {
  const old = document.getElementById(id);
  if (!html) {
    old?.remove();
    return;
  }
  if (old && old.dataset.rudSig === html) return;
  const hero = document.getElementById('home');
  if (!hero) return;
  const section = old || document.createElement('section');
  section.id = id;
  section.className = 'section rud-occasion-section';
  section.dataset.rudSig = html;
  section.innerHTML = html;
  if (!old) {
    const after = document.getElementById('rudRamadanMode') && id === 'rudFridayMode' ? document.getElementById('rudRamadanMode') : hero;
    after.insertAdjacentElement('afterend', section);
  }
}
function rudSyncFridayMode() {
  const ramadan = rudSmartHomeRamadan();
  rudPlaceOccasion(
    'rudRamadanMode',
    ramadan
      ? rudOccasionSectionHtml(
          'ramadan',
          'RAMADAN MODE',
          'Ramadan Mubarak',
          'Fasting, Qur’an and prayer — one day at a time.',
          `<a class="rud-occasion-link is-primary" href="#my-deen">${rudRamadanFastedToday() ? 'Fast recorded ✓' : 'Record today’s fast'}</a><a class="rud-occasion-link" href="${rudSmartHomeLastRoute()}">Continue Qur’an</a><a class="rud-occasion-link" href="#prayer">Prayer times</a>`,
        )
      : '',
  );
  if (new Date().getDay() !== 5) {
    rudPlaceOccasion('rudFridayMode', '');
    return;
  }
  const reminder = rudFridayReminder();
  rudPlaceOccasion(
    'rudFridayMode',
    rudOccasionSectionHtml(
      'friday',
      'FRIDAY MODE',
      'Jumu’ah Mubarak',
      'Read Surah Al-Kahf and send salawat upon the Prophet <span class="rud-saw" lang="ar">ﷺ</span>.',
      `<a class="rud-occasion-link is-primary" href="#quran/18/1">Read Al-Kahf</a><a class="rud-occasion-link" href="#quran/18/1" data-rud-friday-listen>Listen</a>${reminder ? `<a class="rud-occasion-link" href="${route(reminder)}">Friday reminder</a>` : ''}`,
    ),
  );
}
function rudMyDeenGreeting() {
  let name = '';
  try {
    name = String(localStorage.getItem('rud_visitor_name') || '').trim();
  } catch {}
  const displayName = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase())
    .join(' ');
  return displayName ? `Assalamu Alaikum, ${esc(displayName)}` : 'Assalamu Alaikum';
}
function rudDeenDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rudDeenToday() {
  const fallback = {
    date: rudDeenDateKey(),
    morning: false,
    quran: false,
    prayer: 0,
    prayers: Object.fromEntries(RUD_PRAYER_KEYS.map((k) => [k, false])),
    evening: false,
  };
  try {
    const v = JSON.parse(localStorage.getItem(RUD_DEEN_TODAY_KEY) || 'null'),
      day = v && v.date === fallback.date ? { ...fallback, ...v } : fallback;
    day.prayers = rudPrayerMap(day);
    day.prayer = rudPrayerCount(day);
    return day;
  } catch {
    return fallback;
  }
}
function rudSaveDeenToday(v) {
  const day = { ...v, date: rudDeenDateKey(), prayers: rudPrayerMap(v) };
  day.prayer = rudPrayerCount(day);
  try {
    localStorage.setItem(RUD_DEEN_TODAY_KEY, JSON.stringify(day));
  } catch {}
  rudDeenHistoryCommit(day);
}
function rudQuranMetaLocal() {
  try {
    const live =
      typeof rudQuranSurahs !== 'undefined' && Array.isArray(rudQuranSurahs) && rudQuranSurahs.length === 114
        ? rudQuranSurahs
        : JSON.parse(localStorage.getItem('rud_quran_surahs_v1') || '[]');
    return Array.isArray(live) ? live : [];
  } catch {
    return [];
  }
}
function rudKhatamSnapshot(last) {
  const meta = rudQuranMetaLocal();
  if (!last || meta.length !== 114) return { percent: 0, label: "Start your Qur'an journey", surahName: "Qur'an" };
  const surahNo = Math.max(1, Math.min(114, Number(last.surah) || 1)),
    current = meta.find((x) => Number(x.number) === surahNo),
    total = meta.reduce((n, x) => n + (Number(x.numberOfAyahs) || 0), 0),
    before = meta.filter((x) => Number(x.number) < surahNo).reduce((n, x) => n + (Number(x.numberOfAyahs) || 0), 0),
    ayah = Math.max(1, Math.min(Number(last.ayah) || 1, Number(current?.numberOfAyahs) || Number(last.ayah) || 1)),
    read = before + ayah,
    percent = total ? Math.max(0, Math.min(100, (read / total) * 100)) : 0;
  return {
    percent,
    label: `${read.toLocaleString()} of ${total.toLocaleString()} ayahs`,
    surahName: String(current?.englishName || `Surah ${surahNo}`),
  };
}
function rudSavedPreview() {
  const ids = typeof favs === 'function' ? favs() : [];
  return ids
    .slice(0, 3)
    .map((id) => combinedPublicContent().find((x) => x.id === id))
    .filter(Boolean);
}
function rudCollectionCount() {
  return (
    (typeof favs === 'function' ? favs().length : 0) +
    (typeof rudQuranBookmarks === 'function' ? rudQuranBookmarks().length : 0)
  );
}
function rudOpenReminderSettings() {
  const mount = document.getElementById('rudReminderSettingsMount');
  if (!mount) return;
  if (mount.innerHTML.trim()) {
    mount.innerHTML = '';
    return;
  }
  mount.innerHTML = rudReminderCenterHtml();
  rudBindReminderCenter();
  requestAnimationFrame(() => mount.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}
function rudBindMyDeen() {
  const root = document.querySelector('.rud-my-deen-page');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  const greeting = root.querySelector('.rud-my-deen-hero-title h1');
  if (greeting) {
    const minSize = 20;
    let size = parseFloat(getComputedStyle(greeting).fontSize) || 28;
    const fitsTwoLines = () => {
      const lineHeight = parseFloat(getComputedStyle(greeting).lineHeight) || size * 1.08;
      return greeting.scrollHeight <= lineHeight * 2 + 1;
    };
    while (size > minSize && !fitsTwoLines()) {
      size = Math.max(minSize, size - 0.5);
      greeting.style.setProperty('--rud-deen-greeting-size', `${size}px`);
    }
  }
  root.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-rud-today-toggle]');
    if (toggle) {
      const key = toggle.dataset.rudTodayToggle,
        state = rudDeenToday();
      state[key] = !state[key];
      rudSaveDeenToday(state);
      return rudRenderMyDeen(true);
    }
    const prayer = e.target.closest('[data-rud-prayer]');
    if (prayer) {
      const state = rudDeenToday(),
        key = prayer.dataset.rudPrayer;
      state.prayers = rudPrayerMap(state);
      state.prayers[key] = !state.prayers[key];
      rudSaveDeenToday(state);
      return rudRenderMyDeen(true);
    }
    const adhkar = e.target.closest('[data-rud-adhkar-open]');
    if (adhkar) {
      e.preventDefault();
      return rudOpenGuidedAdhkar(adhkar.dataset.rudAdhkarOpen);
    }
    const repeat = e.target.closest('[data-rud-adhkar-repeat]');
    if (repeat) {
      e.preventDefault();
      return rudMoveAdhkar(repeat.dataset.rudAdhkarRepeat, 'repeat');
    }
    const prev = e.target.closest('[data-rud-adhkar-prev]');
    if (prev) {
      e.preventDefault();
      return rudMoveAdhkar(prev.dataset.rudAdhkarPrev, 'prev');
    }
    const next = e.target.closest('[data-rud-adhkar-next]');
    if (next) {
      e.preventDefault();
      return rudMoveAdhkar(next.dataset.rudAdhkarNext, 'next');
    }
    const restart = e.target.closest('[data-rud-adhkar-restart]');
    if (restart) {
      e.preventDefault();
      return rudMoveAdhkar(restart.dataset.rudAdhkarRestart, 'restart');
    }
    const mode = e.target.closest('[data-rud-deen-mode]');
    if (mode) {
      e.preventDefault();
      return rudRenderDeenMode(mode.dataset.rudDeenMode);
    }
    if (e.target.closest('#rudOpenReminderSettings')) return rudOpenReminderSettings();
    if (e.target.closest('#rudOpenReadingSettings')) return rudOpenReadingSettings();
    if (e.target.closest('#rudOpenGoalSettings')) return rudPersonalSettingsOpen('goal');
    if (e.target.closest('#rudOpenDailyPlanSettings')) return rudPersonalSettingsOpen('plan');
    if (e.target.closest('[data-rud-fast-toggle]')) {
      rudToggleRamadanFast();
      return rudRenderMyDeen(true);
    }
    if (e.target.closest('[data-rud-ramadan-khatam]')) {
      const days = rudStartRamadanKhatam();
      toast(`Ramadan Qur'an plan uses the existing Khatam Planner · ${days} day${days === 1 ? '' : 's'}.`);
      return rudRenderMyDeen(true);
    }
    if (e.target.closest('[data-rud-backup-export]')) return rudExportMyDeen();
    if (e.target.closest('[data-rud-backup-restore]')) return rudChooseRestoreFile();
    const clear = e.target.closest('[data-rud-storage-clear]');
    if (clear) return rudClearOfflineSource(clear.dataset.rudStorageClear);
  });
  root.addEventListener('change', (e) => {
    const plan = e.target.closest('[data-rud-khatam-plan]');
    if (plan) {
      const custom = document.getElementById('rudKhatamCustomDays');
      rudSaveKhatamChoice(plan.value, custom?.value);
      return rudRenderMyDeen(true);
    }
    const custom = e.target.closest('#rudKhatamCustomDays');
    if (custom) {
      rudSaveKhatamChoice('custom', custom.value);
      return rudRenderMyDeen(true);
    }
    const setting = e.target.closest('[data-rud-reading]');
    if (setting) {
      const prefs = rudReadingPrefs(),
        key = setting.dataset.rudReading;
      prefs[key] = setting.type === 'checkbox' ? setting.checked : setting.value;
      rudSaveReadingPrefs(prefs);
    }
    const goal = e.target.closest('[data-rud-goal]');
    if (goal) {
      const current = rudQuranGoal();
      current[goal.dataset.rudGoal] = goal.value;
      rudSaveQuranGoal(current);
      const saved = rudQuranGoal(),
        target = root.querySelector('[data-rud-goal="target"]');
      if (target) {
        target.max = saved.type === 'minutes' ? '180' : '300';
        target.value = String(saved.target);
      }
      const card = document.getElementById('rudOpenGoalSettings')?.closest('.rud-utility-card');
      if (card) card.outerHTML = rudQuranGoalCardHtml();
      return;
    }
    const planEnabled = e.target.closest('[data-rud-plan-enabled]');
    if (planEnabled) {
      const p = rudDailyPlan();
      p.enabled = planEnabled.checked;
      rudSaveDailyPlan(p);
      const card = document.getElementById('rudOpenDailyPlanSettings')?.closest('.rud-utility-card');
      if (card) card.outerHTML = rudDailyPlanCardHtml(rudDeenToday());
      return;
    }
    const planItem = e.target.closest('[data-rud-plan-item]');
    if (planItem) {
      const p = rudDailyPlan();
      p.items[planItem.dataset.rudPlanItem] = planItem.checked;
      rudSaveDailyPlan(p);
      const card = document.getElementById('rudOpenDailyPlanSettings')?.closest('.rud-utility-card');
      if (card) card.outerHTML = rudDailyPlanCardHtml(rudDeenToday());
      return;
    }
  });
}
function rudRenderMyDeen(preserveScroll = false) {
  const preservedScrollY = preserveScroll ? window.scrollY : null;
  const last = typeof rudQuranLast === 'function' ? rudQuranLast() : null,
    saved = rudSavedPreview(),
    today = rudDeenToday();
  if (
    last?.updatedAt &&
    new Date(Number(last.updatedAt)).toDateString() === new Date().toDateString() &&
    !today.quran
  ) {
    today.quran = true;
    rudSaveDeenToday(today);
  }
  const khatam = rudKhatamSnapshot(last),
    planner = rudKhatamPlannerStats(khatam),
    continueRoute = last?.surah ? `#quran/${Number(last.surah)}/${Number(last.ayah) || 1}` : '#quran',
    continueCopy = last?.surah ? `${khatam.surahName} · Ayah ${Number(last.ayah) || 1}` : "Begin your Qur'an journey.",
    qStreak = rudDeenStreak('quran'),
    aStreak = rudDeenStreak('adhkar'),
    pStreak = rudDeenStreak('prayer'),
    prayerCount = rudPrayerCount(today),
    consistency = Math.round(
      (((today.morning ? 1 : 0) + (today.quran ? 1 : 0) + prayerCount / 5 + (today.evening ? 1 : 0)) / 4) * 100,
    ),
    cached = readPublicCache(),
    notifyEnabled = typeof rudPushPrefs === 'function' ? rudPushPrefs().enabled === true : false,
    collectionCount = rudCollectionCount(),
    offlineCount = rudOfflineCount(),
    planValue = String(planner.p.days || 30),
    prayerSchedule = rudResolvedPrayerSchedule();
  const savedHtml = saved.length
    ? saved
        .map(
          (i) =>
            `<a class="rud-saved-preview" href="${route(i)}"><strong>${esc(i.title || label(i.type))}</strong><span>${esc(label(i.type))}</span></a>`,
        )
        .join('')
    : `<div class="rud-saved-preview"><strong>${collectionCount ? `${collectionCount} saved item${collectionCount === 1 ? '' : 's'}` : 'Nothing saved yet'}</strong><span>${collectionCount ? 'Available locally' : 'Collection'}</span></div>`;
  const prayerRows = RUD_PRAYER_KEYS.map((k) => {
    const time = prayerSchedule?.timings?.[k],
      detail = time ? `${rudPrayerClockText(time)} · Private daily tracker` : 'Open Prayer to refresh today’s time';
    return `<div class="rud-today-row"><div><strong>${k[0].toUpperCase() + k.slice(1)}</strong><small>${esc(detail)}</small></div><button class="rud-today-action ${today.prayers[k] ? 'done' : ''}" type="button" data-rud-prayer="${k}" aria-pressed="${today.prayers[k]}">${today.prayers[k] ? '✓ Done' : '○'}</button></div>`;
  }).join('');
  const html = `<section class="rud-my-deen-page"><header class="rud-my-deen-hero"><div class="rud-my-deen-hero-head"><button type="button" class="rud-mini-btn rud-my-deen-back" data-history-back aria-label="Go back from My Deen"><span aria-hidden="true">←</span><span>Back</span></button><div class="rud-my-deen-hero-title"><small>MY DEEN</small><h1>${rudMyDeenGreeting()}</h1><p>Your private journey with Rise Upon Deen.</p></div></div></header>
    <section class="rud-deen-section rud-personal-journey"><div class="rud-deen-section-head"><div><h2>Your Journey</h2><p>Gentle consistency, stored only on this device.</p></div></div><div class="rud-journey-grid"><a class="rud-journey-item" href="${continueRoute}"><span>Qur'an</span><strong>${qStreak} day${qStreak === 1 ? '' : 's'}</strong><small>${last ? esc(khatam.surahName) : 'Start reading'}</small></a><div class="rud-journey-item"><span>Adhkar</span><strong>${aStreak} day${aStreak === 1 ? '' : 's'}</strong><small>Morning + evening</small></div><a class="rud-journey-item" href="#prayer"><span>Prayer</span><strong>${pStreak} day${pStreak === 1 ? '' : 's'}</strong><small>${prayerCount}/5 today</small></a><div class="rud-journey-item"><span>Consistency</span><strong>${consistency}%</strong><small>Today · no points</small></div></div></section>
    <div class="rud-deen-primary-grid"><article class="rud-quran-continue"><div class="rud-quran-copy"><span class="rud-deen-label">Continue Qur'an</span><h2>${esc(continueCopy)}</h2><p>${last ? 'Return to your last-read position and continue from the saved ayah.' : "Open the existing Qur'an reader and begin."}</p><div class="rud-quran-reading-progress"><div class="rud-quran-reading-meta"><span>Reading progress</span><strong>${khatam.percent.toFixed(khatam.percent < 10 ? 1 : 0)}%</strong></div><div class="rud-progress-track" aria-label="Qur'an reading progress"><div class="rud-progress-fill" style="width:${khatam.percent.toFixed(2)}%"></div></div></div><a class="premium-btn primary" href="${continueRoute}" aria-label="${last ? `Continue ${esc(khatam.surahName)} from Ayah ${Number(last.ayah) || 1}` : "Open Qur'an"}">Continue <span aria-hidden="true">→</span></a></div></article><article class="rud-khatam-card"><span class="rud-deen-label">Khatam Planner</span><h3>Qur'an journey</h3><div class="rud-khatam-percent">${khatam.percent.toFixed(khatam.percent < 10 ? 1 : 0)}%</div><div class="rud-progress-track"><div class="rud-progress-fill" style="width:${khatam.percent.toFixed(2)}%"></div></div><p>${esc(khatam.label)}</p><div class="rud-khatam-controls"><select class="rud-quran-select" data-rud-khatam-plan><option value="7" ${planValue === '7' ? 'selected' : ''}>7 Days</option><option value="30" ${planValue === '30' ? 'selected' : ''}>30 Days</option><option value="60" ${planValue === '60' ? 'selected' : ''}>60 Days</option><option value="90" ${planValue === '90' ? 'selected' : ''}>90 Days</option><option value="custom" ${planValue === 'custom' ? 'selected' : ''}>Custom</option></select>${planValue === 'custom' ? `<input id="rudKhatamCustomDays" class="rud-quran-select" type="number" min="1" max="365" value="${planner.days}" aria-label="Custom Khatam days">` : ''}<small>${planner.target ? `Target ≈ ${planner.target} ayahs/day · ${planner.p.completedDays?.length || 0} active reading days` : "Load the Qur'an once to calculate your local daily target."}</small></div></article></div>
    <section class="rud-deen-section"><div class="rud-deen-section-head"><div><h2>Deen Modes</h2><p>Existing verified features grouped into smoother flows.</p></div></div><div class="rud-inline-actions"><button class="rud-mini-btn" type="button" data-rud-deen-mode="morning">Morning Mode</button><button class="rud-mini-btn" type="button" data-rud-deen-mode="night">Night Mode</button><button class="rud-mini-btn" type="button" data-rud-deen-mode="after-salah">After Salah</button><button class="rud-mini-btn" type="button" data-rud-deen-mode="travel">Travel Mode</button></div><div class="rud-reminder-settings-mount" id="rudDeenFlowMount"></div></section>
    <section class="rud-deen-section"><div class="rud-deen-section-head"><div><h2>Today</h2><p>Small local check-ins. These check-ins stay on this device.</p></div></div><div class="rud-today-list"><div class="rud-today-row"><div><strong>Morning Adhkar</strong><small>${today.morning ? 'Completed today' : 'Guided from verified existing Adhkar'}</small></div><button class="rud-today-action ${today.morning ? 'done' : ''}" type="button" data-rud-adhkar-open="morning">${today.morning ? '✓ Done' : 'Open'}</button></div><div class="rud-today-row"><div><strong>Qur'an</strong><small>${today.quran ? 'Read today' : "Open Qur'an when ready"}</small></div><button class="rud-today-action ${today.quran ? 'done' : ''}" type="button" data-rud-today-toggle="quran" aria-pressed="${today.quran}">${today.quran ? '✓' : '○'}</button></div>${prayerRows}<div class="rud-today-row"><div><strong>Evening Adhkar</strong><small>${today.evening ? 'Completed today' : 'Guided from verified existing Adhkar'}</small></div><button class="rud-today-action ${today.evening ? 'done' : ''}" type="button" data-rud-adhkar-open="evening">${today.evening ? '✓ Done' : 'Open'}</button></div></div></section>
    <section class="rud-deen-section"><div class="rud-deen-section-head"><div><h2>Personal Deen</h2><p>Private local tools that stay on this device.</p></div></div><div class="rud-deen-utility-grid">${rudQuranGoalCardHtml()}${rudDailyPlanCardHtml(today)}${rudHijriRamadanCardHtml()}</div><div class="rud-reminder-settings-mount" id="rudPersonalSettingsMount"></div></section>
    <section class="rud-deen-section"><div class="rud-deen-section-head"><div><h2>Saved Collection</h2><p>${collectionCount} item${collectionCount === 1 ? '' : 's'} saved on this device, including Qur'an bookmarks.</p></div><a class="premium-btn small" href="#saved">View all</a></div><div class="rud-collection-preview">${savedHtml}</div></section>
    <section class="rud-deen-section"><div class="rud-deen-section-head"><div><h2>Settings & Offline</h2><p>Open details only when you need them.</p></div></div><div class="rud-deen-utility-grid"><article class="rud-utility-card"><span class="rud-deen-label">Reminder Settings</span><h3>${notifyEnabled ? 'Reminders enabled' : 'Reminder preferences'}</h3><p>Manage notification categories and delivery choices.</p><button class="premium-btn" id="rudOpenReminderSettings" type="button">Manage reminders</button></article><article class="rud-utility-card"><span class="rud-deen-label">Reading & Accessibility</span><h3>Reading controls</h3><p>Font size, spacing, Urdu, motion, contrast, Focus Mode and Data Saver.</p><button class="premium-btn" id="rudOpenReadingSettings" type="button">Reading settings</button></article><article class="rud-utility-card"><span class="rud-deen-label">Offline Rise</span><h3>${offlineCount ? `${offlineCount} selected offline` : cached.items.length ? 'Core cache ready' : 'Preparing cache'}</h3><p>Choose lightweight content or a Qur'an Surah to make it explicitly available offline. Audio is never downloaded automatically.</p></article>${rudBackupStorageCardHtml()}</div><div class="rud-reminder-settings-mount" id="rudReminderSettingsMount"></div><div class="rud-reminder-settings-mount" id="rudReadingSettingsMount"></div></section>
    <div class="rud-private-note">Private by default. Qur'an position, Adhkar, prayer tracking, Khatam planning, consistency and reading preferences remain local. Cloud storage is used only where an existing feature explicitly needs it, such as push delivery.</div></section>`;
  showPage(html, 'My Deen | Rise Upon Deen');
  rudBindMyDeen();
  if (preservedScrollY !== null)
    requestAnimationFrame(() =>
      window.scrollTo({
        top: Math.min(preservedScrollY, Math.max(0, document.documentElement.scrollHeight - innerHeight)),
        left: 0,
        behavior: 'auto',
      }),
    );
  if (window.__rudOpenReminderSettings) {
    window.__rudOpenReminderSettings = false;
    requestAnimationFrame(rudOpenReminderSettings);
  }
  if (window.__rudOpenAdhkar) {
    const period = window.__rudOpenAdhkar;
    window.__rudOpenAdhkar = '';
    requestAnimationFrame(() => rudOpenGuidedAdhkar(period));
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  /* ============================================================
   V2 FEATURE COMPLETION — local-first helpers for the missing features only.
   Reuses existing pages, public content, Qur'an player, My Deen and service worker.
   ============================================================ */
  RUD_DEEN_HISTORY_KEY = 'rud_deen_history_v2';
  RUD_ADHKAR_PROGRESS_KEY = 'rud_guided_adhkar_v2';
  RUD_KHATAM_PLAN_KEY = 'rud_khatam_plan_v2';
  RUD_READING_PREF_KEY = 'rud_reading_preferences_v2';
  RUD_OFFLINE_ITEMS_KEY = 'rud_offline_selected_content_v2';
  RUD_QURAN_OFFLINE_KEY = 'rud_quran_offline_selected_v2';
  RUD_QURAN_MEM_KEY = 'rud_quran_memorization_v2';
  RUD_QURAN_SLEEP_KEY = 'rud_quran_sleep_timer_v2';
  RUD_QURAN_GOAL_KEY = 'rud_quran_reading_goal_v2';
  RUD_QURAN_ACTIVITY_KEY = 'rud_quran_daily_activity_v2';
  RUD_DAILY_PLAN_KEY = 'rud_daily_deen_plan_v2';
  RUD_FASTING_KEY = 'rud_ramadan_fasting_v2';
  RUD_AYAH_NOTES_KEY = 'rud_quran_ayah_notes_v2';
  RUD_BACKUP_SCHEMA = 2;
  rudApplyReadingPrefs();
  window.rudApplyReadingPrefs = rudApplyReadingPrefs;
  window.rudRecordDeenActivity = rudRecordDeenActivity;
  window.rudMarkKhatamDay = rudMarkKhatamDay;
  RUD_BACKUP_KEYS = [
    'rud_deen_history_v2',
    'rud_guided_adhkar_v2',
    'rud_khatam_plan_v2',
    'rud_reading_preferences_v2',
    'rud_my_deen_today_v2',
    'rud_quran_bookmarks_v1',
    'rud_quran_last_read_v1',
    'rud_quran_memorization_v2',
    'rud_quran_sleep_timer_v2',
    'rud_quran_player_state_v2',
    'rud_quran_reading_goal_v2',
    'rud_quran_daily_activity_v2',
    'rud_daily_deen_plan_v2',
    'rud_ramadan_fasting_v2',
    'rud_quran_ayah_notes_v2',
    'rud_favorites',
    'rud_push_preferences_v2',
  ];
  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest?.('[data-rud-friday-listen]')) {
        window.__rudFridayListen = true;
      }
      if (e.target.closest?.('[data-rud-open-sleep]')) {
        window.__rudOpenSleepTimer = true;
      }
    },
    true,
  );
  RUD_DEEN_TODAY_KEY = 'rud_my_deen_today_v2';
}

export {
  rudAyahNote,
  rudDataSaverEnabled,
  rudOfflineAction,
  rudOfflineHas,
  rudOfflineItems,
  rudOfflineRemoveItem,
  rudOfflineSaveItem,
  rudQuranMetaLocal,
  rudReadingPrefs,
  rudRenderMyDeen,
  rudSaveAyahNote,
  rudSaveReadingPrefs,
  rudSyncFridayMode,
  rudSyncSmartHome,
  rudTrackQuranLocalActivity,
};
