/**
 * Qur'an reader and the single-element recitation engine (playlist, repeat, sleep timer, memorisation, Urdu), bookmarks and offline surahs.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import QURAN_SURAH_INDEX from './data/surahIndex.json';
import { loadQuranText } from './quranText';
import { rudExportRisePoster } from '../library/readers';
import {
  rudAyahNote,
  rudDataSaverEnabled,
  rudReadingPrefs,
  rudSaveAyahNote,
  rudSaveReadingPrefs,
  rudTrackQuranLocalActivity,
} from '../my-deen/myDeen';
import { esc, featureShowPage } from '../tools/featurePageShell';
import appLogoUrl from '../../assets/images/app-logo.png';

let RUD_QURAN_META_KEY,
  RUD_QURAN_BOOKMARK_KEY,
  RUD_QURAN_LAST_KEY,
  RUD_QURAN_RECITER_KEY,
  RUD_QURAN_OFFLINE_MAX,
  RUD_QURAN_OFFLINE_STORE_KEY,
  RUD_QURAN_MEM_STORE_KEY,
  RUD_QURAN_SLEEP_STORE_KEY,
  RUD_QURAN_PLAYER_STORE_KEY,
  RUD_QURAN_URDU_TEXT_EDITION,
  RUD_QURAN_URDU_AUDIO_EDITION,
  RUD_QURAN_BUILTIN,
  RUD_QURAN_RECITERS,
  rudQuranSurahCache,
  rudQuranUrduCache,
  rudQuranUrduPending,
  rudQuranSurahs,
  rudQuranData,
  rudQuranCurrentSurah,
  rudQuranCurrentAyah,
  rudQuranFullPlay,
  rudQuranRequest,
  rudQuranAudio,
  rudQuranPlaybackMode,
  rudQuranPlaybackPhase,
  rudQuranPausedByUser,
  rudQuranPlaybackCommand,
  rudQuranSleepTimer,
  rudQuranSleepEndsAt,
  rudQuranSleepMode,
  rudQuranMemSession,
  rudQuranRepeatMode,
  rudQuranRepeatIteration,
  rudQuranActionAyah,
  rudQuranPlaybackState,
  rudQuranLastManualScroll,
  rudQuranAutoScrollUntil,
  rudQuranPersistAt,
  rudQuranActivityTimer,
  RUD_QURAN_AYAH_OFFSETS,
  rudQuranSearchTimer;

function rudQuranLocalGet(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function rudQuranLocalSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function rudQuranReadingPrefs() {
  const p =
    typeof rudReadingPrefs === 'function'
      ? rudReadingPrefs()
      : {
          arabicSize: 'normal',
          translationSize: 'normal',
          lineSpacing: 'normal',
          urduVisible: false,
          reducedMotion: false,
          highContrast: false,
          largeText: false,
          focusReading: false,
          dataSaver: false,
        };
  return { translationVisible: true, ...p };
}
function rudQuranSaveReadingPrefs(p) {
  if (typeof rudSaveReadingPrefs === 'function') rudSaveReadingPrefs(p);
  else rudQuranLocalSet('rud_reading_preferences_v2', p);
  rudQuranSyncFocusClass();
}
function rudQuranDataSaverEnabled() {
  return typeof rudDataSaverEnabled === 'function' ? rudDataSaverEnabled() : rudQuranReadingPrefs().dataSaver === true;
}
function rudQuranToast(msg, type = 'ok') {
  try {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3900);
  } catch {}
}
function rudSafeJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function rudQuranBookmarks() {
  const v = rudSafeJSON(RUD_QURAN_BOOKMARK_KEY, []);
  return Array.isArray(v) ? v : [];
}
function rudQuranSaveBookmarks(v) {
  try {
    localStorage.setItem(RUD_QURAN_BOOKMARK_KEY, JSON.stringify(v));
  } catch {}
}
function rudQuranLast() {
  const v = rudSafeJSON(RUD_QURAN_LAST_KEY, null);
  return v && Number(v.surah) && Number(v.ayah) ? v : null;
}
function rudQuranSetLast(surah, ayah, extra = {}, recordActivity = true) {
  const previous = rudQuranLast() || {};
  const prefs = rudQuranReadingPrefs(),
    next = {
      ...previous,
      surah: Number(surah),
      ayah: Number(ayah),
      playbackMode: rudQuranPlaybackMode,
      playbackPhase: rudQuranPlaybackPhase,
      translationVisible: prefs.translationVisible !== false,
      urduVisible: prefs.urduVisible === true,
      ...extra,
      updatedAt: Date.now(),
    };
  try {
    localStorage.setItem(RUD_QURAN_LAST_KEY, JSON.stringify(next));
  } catch {}
  if (recordActivity) {
    try {
      window.rudRecordDeenActivity?.('quran', true);
      window.rudMarkKhatamDay?.();
      rudTrackQuranLocalActivity(`${Number(surah)}:${Number(ayah)}`);
    } catch {}
  }
  return next;
}
function rudQuranPersistPlayback(force = false) {
  if (!rudQuranAudio || !Number.isFinite(rudQuranAudio.currentTime)) return;
  const now = Date.now();
  if (!force && now - rudQuranPersistAt < 4000) return;
  rudQuranPersistAt = now;
  rudQuranSetLast(
    rudQuranCurrentSurah,
    rudQuranCurrentAyah,
    {
      audioTime: Math.max(0, rudQuranAudio.currentTime || 0),
      playbackMode: rudQuranPlaybackMode,
      playbackPhase: rudQuranPlaybackPhase,
    },
    false,
  );
}
function rudQuranReciter() {
  try {
    const saved = localStorage.getItem(RUD_QURAN_RECITER_KEY) || 'ar.alafasy';
    return RUD_QURAN_RECITERS.some((x) => x.id === saved) ? saved : 'ar.alafasy';
  } catch {
    return 'ar.alafasy';
  }
}
function rudQuranSetReciter(id) {
  const safe = RUD_QURAN_RECITERS.some((x) => x.id === id) ? id : 'ar.alafasy';
  try {
    localStorage.setItem(RUD_QURAN_RECITER_KEY, safe);
  } catch {}
  return safe;
}
function rudQuranPlayerState() {
  return { ...{ mode: 'arabic', repeat: '1', minimized: true }, ...rudQuranLocalGet(RUD_QURAN_PLAYER_STORE_KEY, {}) };
}
function rudQuranSavePlayerState(patch) {
  const next = { ...rudQuranPlayerState(), ...patch };
  rudQuranLocalSet(RUD_QURAN_PLAYER_STORE_KEY, next);
  return next;
}
function rudQuranOfflineMap() {
  const v = rudQuranLocalGet(RUD_QURAN_OFFLINE_STORE_KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
function rudQuranOfflineGet(n) {
  return rudQuranOfflineMap()[String(Number(n))] || null;
}
function rudQuranSaveOfflineCurrent() {
  if (!rudQuranData?.arabic?.ayahs || !rudQuranData?.translation?.ayahs) return false;
  const map = rudQuranOfflineMap(),
    key = String(rudQuranCurrentSurah),
    strip = (e) => ({
      ...e,
      ayahs: (e.ayahs || []).map((a) => ({
        number: a.number,
        numberInSurah: a.numberInSurah,
        text: a.text,
        juz: a.juz,
        manzil: a.manzil,
        page: a.page,
        ruku: a.ruku,
        hizbQuarter: a.hizbQuarter,
      })),
    });
  map[key] = { arabic: strip(rudQuranData.arabic), translation: strip(rudQuranData.translation), savedAt: Date.now() };
  const keys = Object.keys(map).sort((a, b) => (map[b].savedAt || 0) - (map[a].savedAt || 0));
  keys.slice(RUD_QURAN_OFFLINE_MAX).forEach((k) => delete map[k]);
  rudQuranLocalSet(RUD_QURAN_OFFLINE_STORE_KEY, map);
  return true;
}
function rudQuranRemoveOffline(n) {
  const map = rudQuranOfflineMap();
  delete map[String(Number(n))];
  rudQuranLocalSet(RUD_QURAN_OFFLINE_STORE_KEY, map);
}
function rudQuranMemSettings() {
  return {
    ...{
      enabled: false,
      startAyah: 1,
      endAyah: 1,
      repeat: '3',
      hideArabic: false,
      hideTranslation: false,
      tapToReveal: false,
      delayMs: 0,
    },
    ...rudQuranLocalGet(RUD_QURAN_MEM_STORE_KEY, {}),
  };
}
function rudQuranSaveMemSettings(v) {
  rudQuranLocalSet(RUD_QURAN_MEM_STORE_KEY, v);
  rudQuranApplyMemorizationView();
  rudQuranSyncPlayerUi();
}
function rudQuranApplyMemorizationView() {
  const page = document.querySelector('.rud-quran-page'),
    p = rudQuranMemSettings();
  if (!page) return;
  page.classList.toggle('rud-mem-hide-arabic', !!p.enabled && !!p.hideArabic);
  page.classList.toggle('rud-mem-hide-translation', !!p.enabled && !!p.hideTranslation);
  page.classList.toggle('rud-mem-tap-reveal', !!p.enabled && !!p.tapToReveal);
}
function rudQuranClearMemSession() {
  clearTimeout(rudQuranMemSession.delayTimer);
  rudQuranMemSession = { active: false, current: 0, repeats: 0, delayTimer: null };
  rudQuranSyncPlayerUi();
}
function rudQuranClearSleep(reset = true) {
  clearTimeout(rudQuranSleepTimer);
  rudQuranSleepTimer = null;
  rudQuranSleepEndsAt = 0;
  if (reset) {
    rudQuranSleepMode = 'off';
    rudQuranLocalSet(RUD_QURAN_SLEEP_STORE_KEY, { mode: 'off' });
  }
  rudQuranSyncPlayerUi();
}
function rudQuranSetSleep(mode) {
  rudQuranClearSleep(false);
  rudQuranSleepMode = mode || 'off';
  rudQuranLocalSet(RUD_QURAN_SLEEP_STORE_KEY, { mode: rudQuranSleepMode });
  if (['10', '20', '30'].includes(rudQuranSleepMode)) {
    rudQuranSleepEndsAt = Date.now() + Number(rudQuranSleepMode) * 60 * 1000;
    if (rudQuranAudio && !rudQuranAudio.paused) rudQuranScheduleSleepIfNeeded();
  }
  rudQuranSyncPlayerUi();
}
function rudQuranScheduleSleepIfNeeded() {
  if (!['10', '20', '30'].includes(rudQuranSleepMode) || rudQuranSleepTimer) return;
  const delay = Math.max(
    1000,
    (rudQuranSleepEndsAt || Date.now() + Number(rudQuranSleepMode) * 60 * 1000) - Date.now(),
  );
  rudQuranSleepTimer = setTimeout(() => {
    try {
      rudQuranAudio?.pause();
    } catch {}
    rudQuranClearMemSession();
    rudQuranFullPlay = false;
    rudQuranPausedByUser = true;
    rudQuranClearSleep(true);
    rudQuranToast("Qur'an sleep timer ended.");
  }, delay);
}
function rudQuranResetPlaybackState({ keepMode = true } = {}) {
  rudQuranFullPlay = false;
  if (!keepMode) rudQuranPlaybackMode = 'arabic';
  rudQuranPlaybackPhase = rudQuranPlaybackMode === 'urdu' ? 'urdu' : 'arabic';
  rudQuranPausedByUser = false;
  rudQuranPlaybackCommand++;
  rudQuranRepeatIteration = 0;
  rudQuranPlaybackState = null;
}
function rudQuranReleaseAudioSource() {
  const audio = rudQuranAudio;
  if (!audio) return;
  try {
    audio.pause();
    audio.removeAttribute('src');
    audio.currentTime = 0;
  } catch {}
  rudQuranPlaybackState = null;
}
function rudStopQuranAudio({ clearSession = true } = {}) {
  rudQuranPersistPlayback(true);
  if (clearSession) {
    rudQuranClearMemSession();
    rudQuranClearSleep(true);
  }
  rudQuranResetPlaybackState();
  rudQuranReleaseAudioSource();
  rudQuranSyncPlayerUi();
}
async function rudGetQuranSurahs() {
  if (rudQuranSurahs.length === 114) return rudQuranSurahs;
  const cached = rudSafeJSON(RUD_QURAN_META_KEY, []);
  if (Array.isArray(cached) && cached.length === 114) {
    rudQuranSurahs = cached;
    return cached;
  }
  // The complete chapter index is bundled so the Qur'an page never depends on a metadata request to render.
  rudQuranSurahs = RUD_QURAN_BUILTIN.surahs.map((x) => ({ ...x }));
  try {
    localStorage.setItem(RUD_QURAN_META_KEY, JSON.stringify(rudQuranSurahs));
  } catch {}
  return rudQuranSurahs;
}
/** Loads the full Qur'an text chunk once and attaches it to RUD_QURAN_BUILTIN.data. */
function rudQuranEnsureText() {
  if (RUD_QURAN_BUILTIN.data) return Promise.resolve(RUD_QURAN_BUILTIN.data);
  return loadQuranText().then((data) => {
    RUD_QURAN_BUILTIN.data = data;
    return data;
  });
}
function rudQuranRef(s, a) {
  return `${Number(s)}:${Number(a)}`;
}
function rudQuranUpdateHash(s, a) {
  if (!(location.hash || '').startsWith('#quran')) return;
  try {
    history.replaceState(
      history.state || {},
      '',
      location.pathname + location.search + `#quran/${Number(s)}/${Number(a)}`,
    );
  } catch {}
}
function rudQuranRevelationLabel(value) {
  return String(value || '')
    .toLowerCase()
    .includes('medin')
    ? 'Madani'
    : 'Makki';
}
function rudQuranPercent(surah, ayah) {
  const meta = rudQuranSurahs.find((x) => Number(x.number) === Number(surah));
  return meta?.numberOfAyahs ? Math.max(0, Math.min(100, ((Number(ayah) || 1) / Number(meta.numberOfAyahs)) * 100)) : 0;
}
function rudQuranModeLabel(mode = rudQuranPlaybackMode) {
  return mode === 'urdu' ? 'Urdu' : mode === 'arabic-urdu' ? 'Arabic + Urdu' : 'Arabic';
}
function rudQuranFormatTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '00:00';
  const m = Math.floor(n / 60),
    s = Math.floor(n % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function rudQuranNowMeta() {
  const ar = rudQuranData?.arabic,
    meta = rudQuranSurahs.find((x) => Number(x.number) === Number(rudQuranCurrentSurah));
  return {
    name: ar?.englishName || meta?.englishName || `Surah ${rudQuranCurrentSurah}`,
    arabic: (ar?.name || meta?.name || '').replace(/^سُورَةُ\s*/, ''),
    ayahs: Number(ar?.numberOfAyahs || meta?.numberOfAyahs || 0),
  };
}
function rudQuranPlayerChromeHtml() {
  return `<div class="rud-quran-mini-player" id="rudQuranMiniPlayer" hidden><button class="rud-quran-mini-main" type="button" data-quran-player-action="expand" aria-label="Open Qur'an player"><span class="rud-quran-mini-art" aria-hidden="true"><img class="rud-quran-mini-logo" alt="" width="192" height="192" decoding="async" draggable="false"></span><span class="rud-quran-mini-copy"><strong data-quran-ui="surah">Qur'an</strong><small data-quran-ui="ayah">Ayah</small></span><span class="rud-quran-mini-progress"><i data-quran-ui="progressbar"></i></span></button><div class="rud-quran-mini-actions"><button type="button" data-quran-player-action="prev" aria-label="Previous Ayah">‹</button><button type="button" class="primary" data-quran-player-action="toggle" aria-label="Play or pause"><span data-quran-ui="playicon">▶</span></button><button type="button" data-quran-player-action="next" aria-label="Next Ayah">›</button><button type="button" class="rud-quran-mini-collapse" data-quran-player-action="collapse" aria-label="Minimize player" title="Minimize"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="rud-quran-mini-restore" data-quran-player-action="restore" aria-label="Restore player" title="Restore"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="m7 14 5-5 5 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div><div class="rud-quran-player-overlay" id="rudQuranPlayerOverlay" aria-hidden="true"><div class="rud-quran-player-screen" role="dialog" aria-modal="true" aria-label="Qur'an Now Playing"><header class="rud-quran-player-top"><button type="button" class="rud-quran-player-minimize" data-quran-player-action="minimize" aria-label="Minimize Qur'an player" title="Minimize"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span>NOW PLAYING</span><button type="button" data-quran-sheet="more" aria-label="Player options">•••</button></header><div class="rud-quran-player-art" aria-hidden="true"><div class="rud-quran-player-art-inner"><img class="rud-quran-player-logo" alt="" width="192" height="192" decoding="async" draggable="false"><i></i></div></div><div class="rud-quran-player-copy"><h2 data-quran-ui="surah">Qur'an</h2><p lang="ar" dir="rtl" data-quran-ui="arabic"></p><span data-quran-ui="ayah">Ayah</span></div><div class="rud-quran-mode-segment" aria-label="Playback mode"><button type="button" data-quran-mode="arabic">Arabic</button><button type="button" data-quran-mode="urdu">Urdu</button><button type="button" data-quran-mode="arabic-urdu">Arabic + Urdu</button></div><div class="rud-quran-player-progress"><input type="range" min="0" max="1000" value="0" step="1" data-quran-seek aria-label="Audio progress"><div><span data-quran-ui="currenttime">00:00</span><span data-quran-ui="duration">00:00</span></div></div><div class="rud-quran-player-primary"><button type="button" data-quran-player-action="prev" aria-label="Previous Ayah">‹</button><button class="play" type="button" data-quran-player-action="toggle" aria-label="Play or pause"><span data-quran-ui="playicon">▶</span></button><button type="button" data-quran-player-action="next" aria-label="Next Ayah">›</button></div><div class="rud-quran-player-secondary"><button type="button" data-quran-sheet="repeat"><span>↻</span><small data-quran-ui="repeat">Repeat</small></button><button type="button" data-quran-sheet="memorize"><span>◫</span><small>Memorize</small></button><button type="button" data-quran-sheet="sleep"><span>◷</span><small data-quran-ui="sleep">Sleep</small></button><button type="button" data-quran-sheet="settings"><span>Aa</span><small>Reading</small></button><button type="button" data-quran-sheet="more"><span>•••</span><small>More</small></button></div><div class="rud-quran-player-status" id="rudQuranPlayerStatus" hidden></div><div class="rud-quran-mem-session" id="rudQuranMemSessionBanner" hidden></div></div></div><div class="rud-quran-sheet-overlay" id="rudQuranSheetOverlay" aria-hidden="true"><div class="rud-quran-sheet" role="dialog" aria-modal="true"><div class="rud-quran-sheet-grab" aria-hidden="true"></div><div id="rudQuranSheetContent"></div></div></div>`;
}
function rudQuranEnsurePlayerChrome() {
  rudQuranEnsureAudioEngine();
  if (!document.getElementById('rudQuranMiniPlayer'))
    document.body.insertAdjacentHTML('beforeend', rudQuranPlayerChromeHtml());
  // The player artwork is the app-icon logo (the header keeps the original brand logo).
  const logoSrc = appLogoUrl;
  document.querySelectorAll('.rud-quran-player-logo,.rud-quran-mini-logo').forEach((img) => {
    if (logoSrc && img.getAttribute('src') !== logoSrc) img.setAttribute('src', logoSrc);
  });
  const state = rudQuranPlayerState();
  rudQuranPlaybackMode = ['arabic', 'urdu', 'arabic-urdu'].includes(state.mode) ? state.mode : 'arabic';
  rudQuranRepeatMode = ['1', '3', '5', '10', 'infinity'].includes(String(state.repeat)) ? String(state.repeat) : '1';
  rudQuranSyncPlayerUi();
}
function rudQuranOpenPlayer() {
  rudQuranEnsurePlayerChrome();
  const overlay = document.getElementById('rudQuranPlayerOverlay');
  overlay?.classList.add('open');
  overlay?.setAttribute('aria-hidden', 'false');
  rudQuranSavePlayerState({ minimized: false });
  document.body.classList.add('rud-quran-player-open');
  rudQuranSyncPlayerUi();
}
function rudQuranMinimizePlayer() {
  const overlay = document.getElementById('rudQuranPlayerOverlay');
  overlay?.classList.remove('open');
  overlay?.setAttribute('aria-hidden', 'true');
  rudQuranSavePlayerState({ minimized: true });
  document.body.classList.remove('rud-quran-player-open');
  rudQuranSyncPlayerUi();
}
function rudQuranCloseSheet() {
  const overlay = document.getElementById('rudQuranSheetOverlay');
  overlay?.classList.remove('open');
  overlay?.setAttribute('aria-hidden', 'true');
}
function rudQuranSleepLabel() {
  if (['10', '20', '30'].includes(rudQuranSleepMode) && rudQuranSleepEndsAt) {
    return `Sleep · ${Math.max(1, Math.ceil((rudQuranSleepEndsAt - Date.now()) / 60000))} min`;
  }
  if (rudQuranSleepMode === 'ayah') return 'Sleep · Ayah';
  if (rudQuranSleepMode === 'surah') return 'Sleep · Surah';
  return 'Sleep';
}
function rudQuranSyncPlayerUi() {
  const audio = rudQuranAudio,
    meta = rudQuranNowMeta(),
    max = meta.ayahs || 0,
    playing = !!audio && !!audio.src && !audio.paused && !audio.ended && audio.readyState >= 2,
    hasSource = !!audio?.src || !!rudQuranPlaybackState;
  document.querySelectorAll('[data-quran-ui="surah"]').forEach((el) => (el.textContent = meta.name));
  document.querySelectorAll('[data-quran-ui="arabic"]').forEach((el) => (el.textContent = meta.arabic));
  document
    .querySelectorAll('[data-quran-ui="ayah"]')
    .forEach((el) => (el.textContent = max ? `Ayah ${rudQuranCurrentAyah} of ${max}` : `Ayah ${rudQuranCurrentAyah}`));
  document.querySelectorAll('[data-quran-ui="playicon"]').forEach((el) => (el.textContent = playing ? 'Ⅱ' : '▶'));
  document
    .querySelectorAll('[data-quran-ui="currenttime"]')
    .forEach((el) => (el.textContent = rudQuranFormatTime(audio?.currentTime)));
  document
    .querySelectorAll('[data-quran-ui="duration"]')
    .forEach((el) => (el.textContent = rudQuranFormatTime(audio?.duration)));
  const ratio =
    audio && Number.isFinite(audio.duration) && audio.duration > 0
      ? Math.max(0, Math.min(1, audio.currentTime / audio.duration))
      : 0;
  document.querySelectorAll('[data-quran-ui="progressbar"]').forEach((el) => (el.style.width = `${ratio * 100}%`));
  document.querySelectorAll('[data-quran-seek]').forEach((el) => {
    if (document.activeElement !== el) el.value = String(Math.round(ratio * 1000));
    el.disabled = !(audio && Number.isFinite(audio.duration) && audio.duration > 0);
  });
  document.querySelectorAll('[data-quran-mode]').forEach((el) => {
    const active = el.dataset.quranMode === rudQuranPlaybackMode;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
  document
    .querySelectorAll('[data-quran-ui="repeat"]')
    .forEach(
      (el) =>
        (el.textContent =
          rudQuranRepeatMode === '1'
            ? 'Repeat'
            : rudQuranRepeatMode === 'infinity'
              ? 'Repeat ∞'
              : `Repeat ${rudQuranRepeatMode}×`),
    );
  document.querySelectorAll('[data-quran-ui="sleep"]').forEach((el) => (el.textContent = rudQuranSleepLabel()));
  const mini = document.getElementById('rudQuranMiniPlayer');
  if (mini) {
    const readerActive = !!document.querySelector('.rud-quran-page.reading') && !!rudQuranData;
    mini.hidden = !(hasSource || readerActive);
    mini.classList.toggle('playing', playing);
    mini.classList.toggle('is-collapsed', rudQuranPlayerState().miniCollapsed === true);
  }
  const status = document.getElementById('rudQuranPlayerStatus');
  if (status && status.dataset.kind !== 'error') {
    status.hidden = true;
    status.textContent = '';
    status.dataset.kind = '';
  }
  const banner = document.getElementById('rudQuranMemSessionBanner');
  if (banner) {
    if (rudQuranMemSession.active) {
      const p = rudQuranMemSettings(),
        repeatTarget = p.repeat === 'continuous' ? '∞' : p.repeat;
      banner.hidden = false;
      banner.innerHTML = `<strong>Memorization</strong><span>${esc(meta.name)} · Ayah ${rudQuranCurrentAyah} / ${Math.max(1, Number(p.endAyah) || rudQuranCurrentAyah)} · Repeat ${rudQuranMemSession.repeats + 1} / ${repeatTarget}</span><button type="button" data-quran-mem-stop>Exit</button>`;
    } else banner.hidden = true;
  }
  document.querySelectorAll('#rudAyahList .rud-ayah.is-playing').forEach((el) => el.classList.remove('is-playing'));
  const currentAyahEl = document.querySelector(`#rudAyahList .rud-ayah[data-ayah="${rudQuranCurrentAyah}"]`);
  if (currentAyahEl && playing) currentAyahEl.classList.add('is-playing');
  const side = document.getElementById('rudQuranSidePlayer');
  if (side) {
    const key = `${rudQuranCurrentSurah}:${rudQuranCurrentAyah}:${rudQuranPlaybackMode}`;
    if (side.dataset.rudKey !== key) {
      side.innerHTML = rudQuranSidePlayerHtml();
      side.dataset.rudKey = key;
    }
    const sideProgress = side.querySelector('[data-quran-side-progress]');
    if (sideProgress) sideProgress.style.width = `${ratio * 100}%`;
    const sidePlay = side.querySelector('[data-quran-side-play]');
    if (sidePlay) sidePlay.textContent = playing ? 'Ⅱ' : '▶';
  }
}
function rudQuranSidePlayerHtml() {
  const meta = rudQuranNowMeta();
  return `<div class="rud-quran-side-art" aria-hidden="true">۞</div><span class="rud-quran-side-kicker">NOW PLAYING</span><h3>${esc(meta.name)}</h3><p lang="ar" dir="rtl">${esc(meta.arabic)}</p><small>Ayah ${rudQuranCurrentAyah}${meta.ayahs ? ` of ${meta.ayahs}` : ''} · ${rudQuranModeLabel()}</small><div class="rud-quran-side-progress"><i data-quran-side-progress></i></div><div class="rud-quran-side-controls"><button type="button" data-quran-player-action="prev" aria-label="Previous Ayah">‹</button><button type="button" class="primary" data-quran-player-action="toggle" aria-label="Play or pause"><span data-quran-side-play>▶</span></button><button type="button" data-quran-player-action="next" aria-label="Next Ayah">›</button></div><button type="button" class="rud-quran-side-expand" data-quran-player-action="expand">Open Player</button>`;
}
function rudQuranLocalAyahMatches(raw) {
  const query = String(raw || '').trim(),
    q = query.toLowerCase();
  if (q.length < 2) return [];
  const results = [],
    seen = new Set(),
    offline = rudQuranOfflineMap(),
    sources = [];
  for (const [surahNo, data] of Object.entries(offline))
    sources.push({ surah: Number(surahNo), arabic: data?.arabic, translation: data?.translation, urdu: null });
  if (rudQuranData?.arabic?.ayahs) {
    const ur = rudQuranUrduCache.get(rudQuranCurrentSurah)?.text;
    sources.push({
      surah: rudQuranCurrentSurah,
      arabic: rudQuranData.arabic,
      translation: rudQuranData.translation,
      urdu: ur,
    });
  }
  for (const src of sources) {
    const meta = rudQuranSurahs.find((x) => Number(x.number) === Number(src.surah));
    (src.arabic?.ayahs || []).some((ayah, i) => {
      const tr = src.translation?.ayahs?.[i]?.text || '',
        ur = src.urdu?.ayahs?.[i]?.text || '',
        hay = [ayah?.text, tr, ur, meta?.englishName, meta?.englishNameTranslation].filter(Boolean).join(' '),
        match = hay.toLowerCase().includes(q) || hay.includes(query);
      if (match) {
        const key = `${src.surah}:${ayah.numberInSurah}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            surah: src.surah,
            ayah: ayah.numberInSurah,
            name: meta?.englishName || `Surah ${src.surah}`,
            preview: tr || ayah.text || '',
          });
        }
      }
      return results.length >= 18;
    });
    if (results.length >= 18) break;
  }
  const saved = rudQuranBookmarks();
  if (['saved', 'bookmark', 'bookmarks'].some((x) => q.includes(x))) {
    for (const ref of saved.slice(-18).reverse()) {
      if (seen.has(ref)) continue;
      const [surah, ayah] = ref.split(':').map(Number),
        meta = rudQuranSurahs.find((x) => Number(x.number) === surah);
      results.push({ surah, ayah, name: meta?.englishName || `Surah ${surah}`, preview: 'Saved Ayah' });
      if (results.length >= 18) break;
    }
  }
  return results.slice(0, 18);
}
function rudQuranRenderSurahList(filter = '') {
  const host = document.getElementById('rudSurahList');
  if (!host) return;
  const raw = String(filter || '').trim(),
    q = raw.toLowerCase(),
    list = rudQuranSurahs.filter(
      (s) =>
        !q ||
        String(s.number) === q ||
        String(s.englishName || '')
          .toLowerCase()
          .includes(q) ||
        String(s.englishNameTranslation || '')
          .toLowerCase()
          .includes(q) ||
        String(s.name || '').includes(raw),
    ),
    ayahMatches = rudQuranLocalAyahMatches(raw);
  const ayahHtml = ayahMatches.length
    ? `<div class="rud-quran-local-results"><span class="rud-deen-label">CACHED / SAVED AYAH RESULTS</span>${ayahMatches.map((x) => `<button type="button" data-quran-jump="${x.surah}:${x.ayah}"><strong>${esc(x.name)} · ${x.ayah}</strong><small>${esc(String(x.preview || '').slice(0, 110))}</small></button>`).join('')}</div>`
    : '';
  const surahHtml = list
    .map(
      (s) =>
        `<button type="button" class="rud-surah-item ${Number(s.number) === Number(rudQuranCurrentSurah) && document.querySelector('.rud-quran-page.reading') ? 'active' : ''}" data-quran-surah="${s.number}"><span class="rud-surah-no">${String(s.number).padStart(2, '0')}</span><span class="rud-surah-name"><strong>${esc(s.englishName)}</strong><small>${s.numberOfAyahs} Ayahs · ${rudQuranRevelationLabel(s.revelationType)}</small></span><span class="rud-surah-ar" lang="ar" dir="rtl">${esc(String(s.name || '').replace(/^سُورَةُ\s*/, ''))}</span><span class="rud-surah-arrow" aria-hidden="true">›</span></button>`,
    )
    .join('');
  host.innerHTML =
    ayahHtml + surahHtml ||
    `<div class="rud-quran-status">No local Qur'an match. Open a Surah online once to make its text searchable from cache.</div>`;
}
function rudQuranUpdateContinue() {
  const box = document.getElementById('rudQuranContinue');
  if (!box) return;
  const last = rudQuranLast(),
    marks = rudQuranBookmarks();
  if (!last) {
    box.innerHTML = `<div class="rud-quran-continue-copy"><span>CONTINUE READING</span><strong>Begin your Qur'an journey</strong><small>Your place will be remembered privately on this device.</small></div><a class="rud-quran-continue-action" href="#quran/1/1">Start Reading <b>→</b></a>`;
  } else {
    const surah = rudQuranSurahs.find((x) => Number(x.number) === Number(last.surah)),
      percent = rudQuranPercent(last.surah, last.ayah);
    box.innerHTML = `<div class="rud-quran-continue-copy"><span>CONTINUE READING</span><strong>${esc(surah?.englishName || `Surah ${last.surah}`)}</strong><p lang="ar" dir="rtl">${esc(String(surah?.name || '').replace(/^سُورَةُ\s*/, ''))}</p><small>Ayah ${Number(last.ayah) || 1}</small><div class="rud-quran-continue-progress"><i style="width:${percent.toFixed(2)}%"></i></div></div><button class="rud-quran-continue-action" type="button" data-quran-jump="${last.surah}:${last.ayah}">Continue <b>→</b></button>`;
  }
  const saved = document.getElementById('rudQuranBookmarks');
  if (!saved) return;
  if (!marks.length) {
    saved.innerHTML = `<span>Saved Ayahs</span><small>No bookmarks yet.</small>`;
    return;
  }
  saved.innerHTML = `<span>Saved Ayahs</span><div>${marks
    .slice(-4)
    .reverse()
    .map((ref) => {
      const [s, a] = ref.split(':').map(Number),
        surah = rudQuranSurahs.find((x) => Number(x.number) === s);
      return `<button type="button" data-quran-jump="${s}:${a}">${esc(surah?.englishName || `Surah ${s}`)} <b>${a}</b></button>`;
    })
    .join('')}</div>`;
}
function rudQuranSetActiveAyah(ayah, scroll = true, { preserveTime = false } = {}) {
  if (!rudQuranData) return;
  const max = rudQuranData.arabic.ayahs.length;
  rudQuranCurrentAyah = Math.max(1, Math.min(max, Number(ayah) || 1));
  document
    .querySelectorAll('#rudAyahList .rud-ayah')
    .forEach((x) => x.classList.toggle('active', Number(x.dataset.ayah) === rudQuranCurrentAyah));
  const el = document.querySelector(`#rudAyahList .rud-ayah[data-ayah="${rudQuranCurrentAyah}"]`);
  const canScroll = scroll && Date.now() - rudQuranLastManualScroll > 2600;
  if (canScroll && el) {
    rudQuranAutoScrollUntil = Date.now() + 850;
    el.scrollIntoView({ behavior: rudQuranReadingPrefs().reducedMotion ? 'auto' : 'smooth', block: 'center' });
  }
  const existing = rudQuranLast(),
    time =
      preserveTime && Number(existing?.surah) === rudQuranCurrentSurah && Number(existing?.ayah) === rudQuranCurrentAyah
        ? Number(existing.audioTime) || 0
        : 0;
  rudQuranSetLast(rudQuranCurrentSurah, rudQuranCurrentAyah, { audioTime: time }, true);
  rudQuranUpdateHash(rudQuranCurrentSurah, rudQuranCurrentAyah);
  rudQuranUpdateContinue();
  rudQuranSyncPlayerUi();
}
function rudQuranApplyTranslationVisibility() {
  const visible = rudQuranReadingPrefs().translationVisible !== false;
  document.querySelectorAll('.rud-quran-page .rud-ayah-meaning').forEach((el) => {
    el.hidden = !visible;
  });
}
function rudQuranApplyUrduText(data) {
  const ayahs = Array.isArray(data?.ayahs) ? data.ayahs : [],
    visible = rudQuranReadingPrefs().urduVisible === true;
  document.querySelectorAll('[data-quran-urdu-ayah]').forEach((el) => {
    const index = Math.max(0, Number(el.dataset.quranUrduAyah) - 1),
      text = String(ayahs[index]?.text || '');
    el.textContent = text;
    el.hidden = !(visible && text);
  });
}
async function rudQuranEnsureUrdu({ needAudio = false } = {}) {
  const surah = Number(rudQuranCurrentSurah) || 1;
  const cached = rudQuranUrduCache.get(surah) || {};
  const expected = Number(rudQuranData?.arabic?.ayahs?.length) || 0;
  const needText = !Array.isArray(cached.text?.ayahs) || cached.text.ayahs.length !== expected;
  const needAudioData = needAudio && (!Array.isArray(cached.audio?.ayahs) || cached.audio.ayahs.length !== expected);
  if (!needText && !needAudioData) {
    if (cached.text) rudQuranApplyUrduText(cached.text);
    return cached;
  }
  const requestKey = `urdu:${surah}:${needText ? 'text' : ''}:${needAudioData ? 'audio' : ''}`;
  if (rudQuranUrduPending.has(requestKey)) return rudQuranUrduPending.get(requestKey);
  const promise = (async () => {
    const editions = [];
    if (needText) editions.push(RUD_QURAN_URDU_TEXT_EDITION);
    if (needAudioData) editions.push(RUD_QURAN_URDU_AUDIO_EDITION);
    const url = `https://api.alquran.cloud/v1/surah/${surah}/editions/${editions.join(',')}`;
    const response = await fetch(url, { method: 'GET', cache: 'force-cache' });
    if (!response.ok) throw new Error(`Urdu request failed (${response.status})`);
    const json = await response.json(),
      items = Array.isArray(json?.data) ? json.data : [];
    const next = { ...cached };
    for (const item of items) {
      const id = item?.edition?.identifier;
      if (id === RUD_QURAN_URDU_TEXT_EDITION) next.text = item;
      if (id === RUD_QURAN_URDU_AUDIO_EDITION) next.audio = item;
    }
    if (needText && (!Array.isArray(next.text?.ayahs) || next.text.ayahs.length !== expected))
      throw new Error('Urdu text did not match this Surah.');
    if (needAudioData && (!Array.isArray(next.audio?.ayahs) || next.audio.ayahs.length !== expected))
      throw new Error('Urdu audio did not match this Surah.');
    rudQuranUrduCache.set(surah, next);
    if (surah === rudQuranCurrentSurah && next.text) rudQuranApplyUrduText(next.text);
    return next;
  })().finally(() => rudQuranUrduPending.delete(requestKey));
  rudQuranUrduPending.set(requestKey, promise);
  return promise;
}
function rudQuranRenderAyahs() {
  const host = document.getElementById('rudAyahList');
  if (!host || !rudQuranData) return;
  const marks = new Set(rudQuranBookmarks()),
    urdu = rudQuranUrduCache.get(rudQuranCurrentSurah)?.text;
  host.innerHTML = rudQuranData.arabic.ayahs
    .map((ayah, i) => {
      const tr = rudQuranData.translation.ayahs[i],
        ur = urdu?.ayahs?.[i],
        ref = rudQuranRef(rudQuranCurrentSurah, ayah.numberInSurah);
      return `<article class="rud-ayah ${ayah.numberInSurah === rudQuranCurrentAyah ? 'active' : ''}" data-ayah="${ayah.numberInSurah}"><div class="rud-ayah-top"><span class="rud-ayah-number">${ayah.numberInSurah}</span><span class="rud-ayah-now">NOW PLAYING</span><div class="rud-ayah-actions"><button type="button" data-quran-play="${ayah.numberInSurah}" aria-label="Play Ayah ${ayah.numberInSurah}">▶</button><button type="button" class="rud-ayah-action-trigger" data-quran-ayah-menu="${ayah.numberInSurah}" aria-label="More Ayah Actions for Ayah ${ayah.numberInSurah}" title="Ayah Actions"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16" cy="7" r="2" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="17" r="2" stroke="currentColor" stroke-width="1.7"/></svg></button></div></div><div class="rud-ayah-arabic" lang="ar" dir="rtl">${esc(ayah.text)}</div><p class="rud-ayah-meaning" ${rudQuranReadingPrefs().translationVisible === false ? 'hidden' : ''}>${esc(tr?.text || '')}</p><p class="rud-ayah-urdu" data-quran-urdu-ayah="${ayah.numberInSurah}" lang="ur" dir="rtl" ${rudQuranReadingPrefs().urduVisible && ur ? '' : 'hidden'}>${esc(ur?.text || '')}</p><span class="rud-ayah-saved ${marks.has(ref) ? 'saved' : ''}" aria-label="${marks.has(ref) ? 'Saved' : 'Not saved'}">${marks.has(ref) ? 'Saved' : ''}</span></article>`;
    })
    .join('');
  rudQuranApplyTranslationVisibility();
  rudQuranSyncPlayerUi();
}
function rudQuranGlobalAyahNumber(surah, ayah) {
  const s = Math.max(1, Math.min(114, Number(surah) || 1));
  const a = Math.max(1, Number(ayah) || 1);
  return (RUD_QURAN_AYAH_OFFSETS[s - 1] || 1) + a - 1;
}
function rudQuranAudioForAyah(ayah) {
  const reciter = rudQuranReciter();
  const n = Math.max(1, Number(ayah) || 1);
  const s = rudQuranCurrentSurah;
  const file = `${String(s).padStart(3, '0')}${String(n).padStart(3, '0')}.mp3`;
  const folders = {
    'ar.alafasy': 'Alafasy_128kbps',
    'ar.husary': 'Husary_128kbps',
    'ar.minshawi': 'Minshawy_Murattal_128kbps',
    'ar.sudais': 'Abdurrahmaan_As-Sudais_192kbps',
    'ar.abdulbasit': 'Abdul_Basit_Murattal_192kbps',
  };
  const folder = folders[reciter] || folders['ar.alafasy'];
  return `https://everyayah.com/data/${folder}/${file}`;
}
function rudQuranUrduAudioForAyah(ayah) {
  const idx = Math.max(0, Number(ayah) - 1);
  const cached = String(rudQuranUrduCache.get(rudQuranCurrentSurah)?.audio?.ayahs?.[idx]?.audio || '').trim();
  if (cached) return cached;
  const number = rudQuranGlobalAyahNumber(rudQuranCurrentSurah, ayah);
  return `https://cdn.islamic.network/quran/audio/64/${encodeURIComponent(RUD_QURAN_URDU_AUDIO_EDITION)}/${number}.mp3`;
}
function rudQuranEnsureAudioEngine() {
  let audio = rudQuranAudio;
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = 'rudQuranAudio';
    audio.className = 'rud-quran-audio-engine';
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.preload = 'auto';
    audio.controls = false;
    audio.autoplay = false;
    audio.loop = false;
    audio.muted = false;
    audio.defaultMuted = false;
    audio.volume = 1;
    audio.playsInline = true;
    document.body.appendChild(audio);
    /* Listeners are bound once, at creation of the single native element. */
    audio.addEventListener('play', rudQuranSyncPlayerUi);
    audio.addEventListener('playing', () => {
      rudQuranPausedByUser = false;
      rudQuranSyncPlayerUi();
      rudQuranScheduleSleepIfNeeded();
    });
    audio.addEventListener('waiting', rudQuranSyncPlayerUi);
    audio.addEventListener('loadedmetadata', rudQuranSyncPlayerUi);
    audio.addEventListener('canplay', rudQuranSyncPlayerUi);
    audio.addEventListener('pause', () => {
      rudQuranPersistPlayback(true);
      rudQuranSyncPlayerUi();
    });
    audio.addEventListener('timeupdate', () => {
      rudQuranPersistPlayback(false);
      rudQuranSyncPlayerUi();
    });
    audio.addEventListener('durationchange', rudQuranSyncPlayerUi);
    audio.addEventListener('ended', rudQuranHandleEnded);
    audio.addEventListener('error', rudQuranHandleMediaError);
  }
  rudQuranAudio = audio;
  return audio;
}
function rudQuranMediaErrorMessage(audio) {
  if (!navigator.onLine) return 'Audio requires an internet connection.';
  const code = audio?.error?.code;
  if (code === 2) return 'Network problem while loading this recitation. Please try again.';
  if (code === 3) return 'This recitation file could not be decoded.';
  if (code === 4) return 'This recitation source is not supported by this browser.';
  return 'This recitation could not be loaded. Please try again.';
}
function rudQuranHandleMediaError() {
  const audio = rudQuranAudio;
  /* Ignore the element being emptied on purpose (no src) or an aborted load (code 1). */
  if (!audio || !audio.getAttribute('src') || audio.error?.code === 1) return;
  rudQuranShowAudioError(rudQuranMediaErrorMessage(audio));
}
function rudQuranHandlePlayError(error, commandToken) {
  /* A rejection from a request that was already superseded is not a failure. */
  if (Number(commandToken) !== rudQuranPlaybackCommand) return;
  const name = error?.name;
  /* AbortError: this play() was interrupted by our own pause()/new source, not by a fault. */
  if (name === 'AbortError') return;
  if (name === 'NotAllowedError') return rudQuranShowAudioError('Audio was blocked by the browser. Tap Play again.');
  if (name === 'NotSupportedError') return rudQuranShowAudioError(rudQuranPlayFailureMessage());
  rudQuranShowAudioError(navigator.onLine ? 'Recitation could not start.' : 'Audio requires an internet connection.');
}
function rudQuranPlayFailureMessage() {
  const audio = rudQuranAudio;
  return audio?.error
    ? rudQuranMediaErrorMessage(audio)
    : navigator.onLine
      ? 'This recitation source is not supported by this browser.'
      : 'Audio requires an internet connection.';
}
/* The one place that calls audio.play(). Always invoked synchronously from the user's tap. */
function rudQuranStartNative(audio, commandToken) {
  try {
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch((error) => rudQuranHandlePlayError(error, commandToken));
    return true;
  } catch (error) {
    rudQuranHandlePlayError(error, commandToken);
    return false;
  }
}
function rudQuranBeginPlayback(mode, phase, playlist, commandToken = null) {
  const token = commandToken === null || commandToken === undefined ? ++rudQuranPlaybackCommand : Number(commandToken);
  if (token !== rudQuranPlaybackCommand) return 0;
  if (commandToken === null || commandToken === undefined) {
    try {
      rudQuranAudio?.pause();
    } catch {}
    rudQuranRepeatIteration = 0;
  }
  rudQuranPlaybackMode = mode;
  rudQuranPlaybackPhase = phase;
  rudQuranFullPlay = !!playlist;
  rudQuranPausedByUser = false;
  rudQuranSavePlayerState({ mode });
  return token;
}
function rudQuranPlaybackCurrent(commandToken, surah = rudQuranCurrentSurah) {
  return Number(commandToken) === rudQuranPlaybackCommand && Number(surah) === rudQuranCurrentSurah && !!rudQuranData;
}
function rudQuranShowAudioError(message = 'Unable to play recitation.') {
  const status = document.getElementById('rudQuranPlayerStatus');
  if (status) {
    status.hidden = false;
    status.dataset.kind = 'error';
    status.innerHTML = `<span>${esc(message)}</span><button type="button" data-quran-player-action="retry">Retry</button>`;
  }
  rudQuranSyncPlayerUi();
}
function rudQuranPlaySource(
  src,
  {
    mode = 'arabic',
    phase = 'arabic',
    playlist = false,
    ayah = rudQuranCurrentAyah,
    commandToken = rudQuranPlaybackCommand,
  } = {},
) {
  if (!src || !rudQuranPlaybackCurrent(commandToken)) return false;
  const audio = rudQuranEnsureAudioEngine();
  rudQuranPlaybackMode = mode;
  rudQuranPlaybackPhase = phase;
  rudQuranFullPlay = !!playlist;
  rudQuranPausedByUser = false;
  rudQuranPlaybackState = { src, mode, phase, playlist: !!playlist, ayah: Number(ayah), surah: rudQuranCurrentSurah };
  rudQuranSetActiveAyah(ayah, true, { preserveTime: false });
  const status = document.getElementById('rudQuranPlayerStatus');
  if (status && status.dataset.kind === 'error') {
    status.hidden = true;
    status.textContent = '';
    status.dataset.kind = '';
  }
  /* iOS-safe rule: keep exactly one native media element and never call
     load(), remove it, or create a replacement during normal playback.
     Re-assigning src is only done for a new source or after a failed load
     (an errored element does not retry by itself, so Retry must reload it). */
  if (audio.src !== src || audio.error) audio.src = src;
  else if (audio.ended) audio.currentTime = 0;
  if (!rudQuranStartNative(audio, commandToken)) return false;
  rudQuranSyncPlayerUi();
  return true;
}
function rudQuranRetryAudio() {
  const a = rudQuranPlaybackState;
  if (!a) return false;
  return rudQuranPlaySource(a.src, {
    mode: a.mode,
    phase: a.phase,
    playlist: a.playlist,
    ayah: a.ayah,
    commandToken: rudQuranPlaybackCommand,
  });
}
function rudQuranPlayAyah(ayah, continueSurah = false, commandToken = null) {
  if (!rudQuranData) return false;
  const token = rudQuranBeginPlayback('arabic', 'arabic', !!continueSurah, commandToken);
  if (!token) return false;
  const target = Math.max(1, Math.min(rudQuranData.arabic.ayahs.length, Number(ayah) || 1));
  return rudQuranPlaySource(rudQuranAudioForAyah(target), {
    mode: 'arabic',
    phase: 'arabic',
    playlist: !!continueSurah,
    ayah: target,
    commandToken: token,
  });
}
function rudQuranPlayUrduAyah(ayah, playlist = true, commandToken = null) {
  if (!rudQuranData) return false;
  const target = Math.max(1, Math.min(rudQuranData.arabic.ayahs.length, Number(ayah) || 1));
  const token = rudQuranBeginPlayback('urdu', 'urdu', !!playlist, commandToken);
  if (!token) return false;
  const src = rudQuranUrduAudioForAyah(target);
  if (!src) {
    rudQuranShowAudioError('Urdu recitation source is unavailable.');
    return false;
  }
  return rudQuranPlaySource(src, {
    mode: 'urdu',
    phase: 'urdu',
    playlist: !!playlist,
    ayah: target,
    commandToken: token,
  });
}
function rudQuranPlayArabicUrduAyah(ayah, playlist = true, phase = 'arabic', commandToken = null) {
  if (!rudQuranData) return false;
  const target = Math.max(1, Math.min(rudQuranData.arabic.ayahs.length, Number(ayah) || 1));
  const token = rudQuranBeginPlayback('arabic-urdu', phase, !!playlist, commandToken);
  if (!token) return false;
  const src = phase === 'urdu' ? rudQuranUrduAudioForAyah(target) : rudQuranAudioForAyah(target);
  if (!src) {
    rudQuranShowAudioError(`Unable to load ${phase === 'urdu' ? 'Urdu' : 'Arabic'} recitation.`);
    return false;
  }
  return rudQuranPlaySource(src, {
    mode: 'arabic-urdu',
    phase,
    playlist: !!playlist,
    ayah: target,
    commandToken: token,
  });
}
function rudQuranPlayCurrentMode(ayah = rudQuranCurrentAyah, playlist = true, commandToken = null) {
  if (rudQuranPlaybackMode === 'urdu') return rudQuranPlayUrduAyah(ayah, playlist, commandToken);
  if (rudQuranPlaybackMode === 'arabic-urdu') return rudQuranPlayArabicUrduAyah(ayah, playlist, 'arabic', commandToken);
  return rudQuranPlayAyah(ayah, playlist, commandToken);
}
function rudQuranRepeatTarget() {
  return rudQuranRepeatMode === 'infinity' ? Infinity : Math.max(1, Number(rudQuranRepeatMode) || 1);
}
function rudQuranReplayCurrent(commandToken) {
  if (rudQuranPlaybackMode === 'urdu') return rudQuranPlayUrduAyah(rudQuranCurrentAyah, rudQuranFullPlay, commandToken);
  if (rudQuranPlaybackMode === 'arabic-urdu')
    return rudQuranPlayArabicUrduAyah(rudQuranCurrentAyah, rudQuranFullPlay, rudQuranPlaybackPhase, commandToken);
  return rudQuranPlayAyah(rudQuranCurrentAyah, rudQuranFullPlay, commandToken);
}
function rudQuranHandleEnded() {
  if (rudQuranPausedByUser || !rudQuranData) return;
  const max = rudQuranData.arabic.ayahs.length,
    commandToken = rudQuranPlaybackCommand;
  if (rudQuranSleepMode === 'ayah') {
    rudQuranClearSleep(true);
    rudQuranClearMemSession();
    rudQuranFullPlay = false;
    rudQuranSyncPlayerUi();
    return;
  }
  if (rudQuranMemSession.active && rudQuranPlaybackMode === 'arabic') {
    const p = rudQuranMemSettings(),
      start = Math.max(1, Math.min(max, Number(p.startAyah) || 1)),
      end = Math.max(start, Math.min(max, Number(p.endAyah) || start)),
      continuous = p.repeat === 'continuous',
      target = continuous ? Infinity : Math.max(1, Number(p.repeat) || 3),
      current = rudQuranCurrentAyah;
    if (rudQuranMemSession.current === current && rudQuranMemSession.repeats + 1 < target) {
      rudQuranMemSession.repeats++;
      rudQuranSyncPlayerUi();
      rudQuranMemSession.delayTimer = setTimeout(
        () => rudQuranPlayAyah(current, true, commandToken),
        Math.max(0, Number(p.delayMs) || 0),
      );
      return;
    }
    rudQuranMemSession.current = current;
    rudQuranMemSession.repeats = 0;
    let next = current + 1;
    if (next > end) {
      if (continuous) next = start;
      else {
        rudQuranClearMemSession();
        rudQuranFullPlay = false;
        rudQuranSyncPlayerUi();
        return;
      }
    }
    rudQuranMemSession.delayTimer = setTimeout(
      () => rudQuranPlayAyah(next, true, commandToken),
      Math.max(0, Number(p.delayMs) || 0),
    );
    return;
  }
  if (rudQuranPlaybackMode === 'arabic-urdu' && rudQuranPlaybackPhase === 'arabic') {
    rudQuranPlayArabicUrduAyah(rudQuranCurrentAyah, rudQuranFullPlay, 'urdu', commandToken);
    return;
  }
  const target = rudQuranRepeatTarget();
  if (rudQuranRepeatIteration + 1 < target) {
    rudQuranRepeatIteration++;
    rudQuranReplayCurrent(commandToken);
    return;
  }
  rudQuranRepeatIteration = 0;
  if (rudQuranFullPlay && rudQuranCurrentAyah < max) {
    rudQuranPlayCurrentMode(rudQuranCurrentAyah + 1, true, commandToken);
    return;
  }
  if (rudQuranSleepMode === 'surah') rudQuranClearSleep(true);
  rudQuranFullPlay = false;
  rudQuranPausedByUser = false;
  rudQuranPlaybackState = null;
  rudQuranSyncPlayerUi();
}
function rudQuranTogglePlayback() {
  const audio = rudQuranEnsureAudioEngine();
  if (audio.src && !audio.paused && !audio.ended) {
    rudQuranPausedByUser = true;
    audio.pause();
    rudQuranSyncPlayerUi();
    return;
  }
  if (audio.src && audio.paused && !audio.error && rudQuranPlaybackState) {
    rudQuranPausedByUser = false;
    rudQuranStartNative(audio, rudQuranPlaybackCommand);
    return;
  }
  rudQuranPlayCurrentMode(rudQuranCurrentAyah, true);
}
function rudQuranSelectMode(mode) {
  if (!['arabic', 'urdu', 'arabic-urdu'].includes(mode)) return;
  const wasPlaying = !!rudQuranAudio?.src && !rudQuranAudio.paused && !rudQuranAudio.ended;
  try {
    rudQuranAudio?.pause();
  } catch {}
  rudQuranPlaybackMode = mode;
  rudQuranPlaybackPhase = mode === 'urdu' ? 'urdu' : 'arabic';
  rudQuranRepeatIteration = 0;
  rudQuranSavePlayerState({ mode });
  rudQuranPlaybackState = null;
  rudQuranReleaseAudioSource();
  rudQuranSetLast(
    rudQuranCurrentSurah,
    rudQuranCurrentAyah,
    { audioTime: 0, playbackMode: mode, playbackPhase: rudQuranPlaybackPhase },
    false,
  );
  rudQuranSyncPlayerUi();
  if (wasPlaying) rudQuranPlayCurrentMode(rudQuranCurrentAyah, true);
}
function rudQuranSkipAyah(target) {
  if (!rudQuranData) return false;
  const ayah = Math.max(1, Math.min(rudQuranData.arabic.ayahs.length, Number(target) || 1));
  const playlist = rudQuranFullPlay || !!rudQuranAudio?.src;
  rudQuranRepeatIteration = 0;
  return rudQuranPlayCurrentMode(ayah, playlist);
}
function rudQuranStudyHtml() {
  const p = rudQuranReadingPrefs();
  if (!p.studyMode) return '';
  return `<section class="rud-quran-study-strip"><div><span class="rud-deen-label">STUDY MODE</span><strong>Existing Qur'an tools, one focused view</strong></div><div class="rud-inline-actions"><button type="button" class="rud-mini-btn" data-quran-study-action="translation">${p.translationVisible === false ? 'Show Translation' : 'Translation ✓'}</button><button type="button" class="rud-mini-btn" data-quran-study-action="urdu">${p.urduVisible ? 'Urdu ✓' : 'Urdu'}</button><button type="button" class="rud-mini-btn" data-quran-study-action="reflection">My Reflection</button><button type="button" class="rud-mini-btn" data-quran-study-action="repeat">Repeat</button><button type="button" class="rud-mini-btn" data-quran-study-action="memorize">Memorize</button></div></section>`;
}
function rudQuranReaderHeadHtml(arabic, offlineNow) {
  return `<header class="rud-quran-reader-head"><div class="rud-quran-reader-nav"><button type="button" data-quran-reader-back aria-label="Back to Surah list">←</button><div><span>QUR'AN</span><h2>${esc(arabic.englishName)}</h2><p lang="ar" dir="rtl">${esc(String(arabic.name || '').replace(/^سُورَةُ\s*/, ''))}</p><small>${arabic.number} · ${arabic.numberOfAyahs} Ayahs · ${rudQuranRevelationLabel(arabic.revelationType)}</small></div><div class="rud-quran-reader-tools"><button type="button" data-quran-sheet="settings" aria-label="Reading settings">Aa</button><button type="button" data-quran-player-action="expand" aria-label="Open player">♫</button></div></div><div class="rud-quran-reader-quick"><button type="button" data-quran-play-from-here>Play from Ayah ${rudQuranCurrentAyah}</button><button type="button" data-quran-study-toggle>${rudQuranReadingPrefs().studyMode ? 'Study Mode ✓' : 'Study Mode'}</button><button type="button" data-quran-sheet="more">${offlineNow ? 'Available Offline' : 'More'}</button></div></header>`;
}
function rudQuranRenderReader() {
  const reader = document.getElementById('rudQuranReader');
  if (!reader || !rudQuranData) return;
  const offlineNow = !!rudQuranOfflineGet(rudQuranCurrentSurah);
  reader.innerHTML = `${rudQuranReaderHeadHtml(rudQuranData.arabic, offlineNow)}${rudQuranStudyHtml()}<div class="rud-ayah-list" id="rudAyahList"></div>`;
  rudQuranRenderAyahs();
  rudQuranApplyMemorizationView();
  rudQuranSyncPlayerUi();
}
function rudQuranLoadSurah(number, ayah = 1, scrollAyah = false, { preserveAudio = false } = {}) {
  const n = Math.max(1, Math.min(114, Number(number) || 1));
  if (!RUD_QURAN_BUILTIN.data) {
    /* Text chunk still downloading: load it, then open the requested surah if the reader is still on screen. */
    rudQuranEnsureText()
      .then(() => {
        if (document.querySelector('.rud-quran-page')) rudQuranLoadSurah(number, ayah, scrollAyah, { preserveAudio });
      })
      .catch(() => {});
    return false;
  }
  const builtin = RUD_QURAN_BUILTIN?.data?.[n - 1];
  if (!builtin?.arabic?.ayahs?.length || !builtin?.translation?.ayahs?.length) return false;
  const sameSurah = Number(rudQuranData?.arabic?.number) === n && !!rudQuranData?.arabic?.ayahs?.length;
  if (!preserveAudio && !sameSurah) rudStopQuranAudio();
  ++rudQuranRequest;
  rudQuranCurrentSurah = n;
  rudQuranCurrentAyah = Math.max(
    1,
    Math.min(Number(builtin.arabic.numberOfAyahs) || builtin.arabic.ayahs.length, Number(ayah) || 1),
  );
  if (scrollAyah) rudQuranLastManualScroll = 0;
  const page = document.querySelector('.rud-quran-page');
  page?.classList.add('reading');
  rudQuranRenderSurahList(document.getElementById('rudQuranSurahFilter')?.value || '');
  const reader = document.getElementById('rudQuranReader');
  try {
    const cached = rudQuranSurahCache.get(`builtin:${n}`);
    const source = cached || builtin;
    const payload = {
      arabic: { ...source.arabic, ayahs: (source.arabic.ayahs || []).map((x, i) => ({ ...x, numberInSurah: i + 1 })) },
      translation: {
        ...source.translation,
        ayahs: (source.translation.ayahs || []).map((x, i) => ({ ...x, numberInSurah: i + 1 })),
      },
      audio: null,
    };
    rudQuranSurahCache.set(`builtin:${n}`, payload);
    rudQuranData = payload;
    rudQuranCurrentAyah = Math.max(1, Math.min(payload.arabic.ayahs.length, rudQuranCurrentAyah));
    rudQuranRenderReader();
    rudQuranSetActiveAyah(rudQuranCurrentAyah, scrollAyah, { preserveTime: true });
    if (rudQuranReadingPrefs().urduVisible)
      rudQuranEnsureUrdu({ needAudio: false })
        .then((d) => rudQuranApplyUrduText(d.text))
        .catch(() => {});
    rudQuranSyncFocusClass();
    if (window.__rudFridayListen && n === 18) {
      window.__rudFridayListen = false;
      rudQuranOpenPlayer();
    }
    if (window.__rudOpenSleepTimer) {
      window.__rudOpenSleepTimer = false;
      requestAnimationFrame(() => rudQuranOpenSheet('sleep'));
    }
    return true;
  } catch (e) {
    console.error("RiseUponDeen Qur'an render failed", e);
    if (reader)
      reader.innerHTML = `<div class="rud-quran-error-state"><strong>Qur'an could not be displayed.</strong><span>Please try again.</span><button type="button" data-quran-retry-surah="${n}:${rudQuranCurrentAyah}">Retry</button></div>`;
    return false;
  }
}
function rudQuranShowDiscovery() {
  const page = document.querySelector('.rud-quran-page');
  page?.classList.remove('reading');
  try {
    history.replaceState(history.state || {}, '', location.pathname + location.search + '#quran');
  } catch {}
  rudQuranRenderSurahList(document.getElementById('rudQuranSurahFilter')?.value || '');
  rudQuranSyncFocusClass();
}
function rudQuranSyncFocusClass() {
  const on = !!document.querySelector('.rud-quran-page') && rudQuranReadingPrefs().focusReading === true;
  document.body.classList.toggle('rud-quran-focus', on);
}
function rudQuranSheetButton(value, label, active, attr) {
  return `<button type="button" class="rud-quran-sheet-choice ${active ? 'active' : ''}" ${attr}="${value}">${label}</button>`;
}
function rudQuranOpenSheet(type, ayah = null) {
  rudQuranEnsurePlayerChrome();
  if (ayah) rudQuranActionAyah = Number(ayah) || rudQuranCurrentAyah;
  const host = document.getElementById('rudQuranSheetContent'),
    overlay = document.getElementById('rudQuranSheetOverlay');
  if (!host || !overlay) return;
  const mem = rudQuranMemSettings(),
    prefs = rudQuranReadingPrefs(),
    max = rudQuranData?.arabic?.ayahs?.length || 1,
    marks = new Set(rudQuranBookmarks()),
    ref = rudQuranRef(rudQuranCurrentSurah, rudQuranActionAyah),
    offline = !!rudQuranOfflineGet(rudQuranCurrentSurah);
  if (type === 'repeat')
    host.innerHTML = `<header><div><span>PLAYBACK</span><h3>Repeat</h3></div><button type="button" data-quran-sheet-close>×</button></header><div class="rud-quran-sheet-choices">${[
      ['1', '1×'],
      ['3', '3×'],
      ['5', '5×'],
      ['10', '10×'],
      ['infinity', '∞'],
    ]
      .map(([v, l]) => rudQuranSheetButton(v, l, rudQuranRepeatMode === v, 'data-quran-repeat-mode'))
      .join('')}</div><p>Repeat uses the same current Ayah queue and audio engine.</p>`;
  else if (type === 'sleep')
    host.innerHTML = `<header><div><span>QUR'AN PLAYER</span><h3>Sleep Timer</h3></div><button type="button" data-quran-sheet-close>×</button></header><div class="rud-quran-sheet-list">${[
      ['ayah', 'End of Ayah'],
      ['surah', 'End of Surah'],
      ['10', '10 Minutes'],
      ['20', '20 Minutes'],
      ['30', '30 Minutes'],
      ['off', 'Turn Off'],
    ]
      .map(
        ([v, l]) =>
          `<button type="button" class="${rudQuranSleepMode === v ? 'active' : ''}" data-quran-sleep-mode="${v}"><span>${l}</span><b>${rudQuranSleepMode === v ? '✓' : ''}</b></button>`,
      )
      .join('')}</div>`;
  else if (type === 'memorize')
    host.innerHTML = `<header><div><span>FOCUSED SESSION</span><h3>Memorization</h3></div><button type="button" data-quran-sheet-close>×</button></header><div class="rud-quran-sheet-grid"><label>Start Ayah<input id="rudMemStart" type="number" min="1" max="${max}" value="${Number(ayah) ? rudQuranActionAyah : Math.min(max, Number(mem.startAyah) || 1)}"></label><label>End Ayah<input id="rudMemEnd" type="number" min="1" max="${max}" value="${Number(ayah) ? rudQuranActionAyah : Math.min(max, Number(mem.endAyah) || Math.min(max, 3))}"></label></div><span class="rud-quran-sheet-label">Repeat</span><div class="rud-quran-sheet-choices">${[
      ['3', '3×'],
      ['5', '5×'],
      ['10', '10×'],
      ['continuous', 'Continuous'],
    ]
      .map(
        ([v, l]) =>
          `<button type="button" class="${String(mem.repeat) === v ? 'active' : ''}" data-quran-mem-repeat="${v}">${l}</button>`,
      )
      .join(
        '',
      )}</div><div class="rud-quran-sheet-toggles"><label><span>Hide Arabic</span><input id="rudMemHideArabic" type="checkbox" ${mem.hideArabic ? 'checked' : ''}></label><label><span>Hide Translation</span><input id="rudMemHideTranslation" type="checkbox" ${mem.hideTranslation ? 'checked' : ''}></label><label><span>Tap to Reveal</span><input id="rudMemReveal" type="checkbox" ${mem.tapToReveal ? 'checked' : ''}></label><label><span>Delay Between Ayahs</span><select id="rudMemDelay"><option value="0" ${Number(mem.delayMs) === 0 ? 'selected' : ''}>No delay</option><option value="1000" ${Number(mem.delayMs) === 1000 ? 'selected' : ''}>1 second</option><option value="3000" ${Number(mem.delayMs) === 3000 ? 'selected' : ''}>3 seconds</option><option value="5000" ${Number(mem.delayMs) === 5000 ? 'selected' : ''}>5 seconds</option></select></label></div><button class="rud-quran-sheet-primary" type="button" data-quran-mem-start>Begin Session</button>`;
  else if (type === 'settings') {
    const arMap = { small: 0, normal: 1, large: 2, xl: 3 },
      trMap = { small: 0, normal: 1, large: 2, xl: 3 };
    host.innerHTML = `<header><div><span>READER</span><h3>Reading Settings</h3></div><button type="button" data-quran-sheet-close>×</button></header><div class="rud-quran-range-row"><label>Arabic Size</label><div><span>A−</span><input type="range" min="0" max="3" step="1" value="${arMap[prefs.arabicSize] ?? 1}" data-quran-setting-range="arabicSize"><span>A+</span></div></div><div class="rud-quran-range-row"><label>Translation Size</label><div><span>A−</span><input type="range" min="0" max="3" step="1" value="${trMap[prefs.translationSize] ?? 1}" data-quran-setting-range="translationSize"><span>A+</span></div></div><div class="rud-quran-sheet-toggles"><label><span>Line Spacing</span><select data-quran-setting="lineSpacing"><option value="compact" ${prefs.lineSpacing === 'compact' ? 'selected' : ''}>Compact</option><option value="normal" ${prefs.lineSpacing === 'normal' ? 'selected' : ''}>Comfortable</option><option value="relaxed" ${prefs.lineSpacing === 'relaxed' ? 'selected' : ''}>Relaxed</option></select></label>${[
      ['translationVisible', 'Translation'],
      ['urduVisible', 'Show Urdu'],
      ['focusReading', 'Focus Reading'],
      ['studyMode', 'Study Mode'],
      ['highContrast', 'High Contrast'],
      ['reducedMotion', 'Reduced Motion'],
    ]
      .map(
        ([k, l]) =>
          `<label><span>${l}</span><input type="checkbox" data-quran-setting="${k}" ${(k === 'translationVisible' ? prefs[k] !== false : !!prefs[k]) ? 'checked' : ''}></label>`,
      )
      .join('')}</div>`;
  } else if (type === 'ayah')
    host.innerHTML = `<header><div><span>AYAH ${rudQuranActionAyah}</span><h3>Ayah Actions</h3></div><button type="button" data-quran-sheet-close>×</button></header><div class="rud-quran-sheet-list"><button type="button" data-quran-ayah-action="play"><span>Play</span><b>▶</b></button><button type="button" data-quran-ayah-action="save"><span>${marks.has(ref) ? 'Remove from Saved' : 'Save'}</span><b>${marks.has(ref) ? '★' : '☆'}</b></button><button type="button" data-quran-ayah-action="reflection"><span>Note</span><b>✎</b></button><button type="button" data-quran-ayah-action="study"><span>Study</span><b>◫</b></button><button type="button" data-quran-ayah-action="memorize"><span>Memorize</span><b>◎</b></button><button type="button" data-quran-ayah-action="poster"><span>Share as Poster</span><b>▣</b></button><button type="button" data-quran-ayah-action="share"><span>Share Text</span><b>↗</b></button><button type="button" data-quran-ayah-action="copy"><span>Copy</span><b>□</b></button><button type="button" data-quran-ayah-action="repeat"><span>Repeat</span><b>↻</b></button></div>`;
  else if (type === 'reflection') {
    const note = rudAyahNote(ref);
    host.innerHTML = `<header><div><span>AYAH ${rudQuranActionAyah}</span><h3>My Reflection</h3></div><button type="button" data-quran-sheet-close>×</button></header><label class="rud-quran-reflection-field"><span>Private personal note</span><textarea id="rudQuranReflectionText" maxlength="5000" placeholder="Write a private reflection for this Ayah…">${esc(note)}</textarea></label><div class="rud-inline-actions"><button type="button" class="rud-quran-sheet-primary" data-quran-reflection-save>Save locally</button>${note ? `<button type="button" class="rud-mini-btn" data-quran-reflection-delete>Delete note</button>` : ''}</div><p>This personal reflection stays on this device and is not presented as religious commentary or interpretation.</p>`;
  } else
    host.innerHTML = `<header><div><span>QUR'AN PLAYER</span><h3>More</h3></div><button type="button" data-quran-sheet-close>×</button></header><label class="rud-quran-sheet-select"><span>Reciter</span><select id="rudQuranReciter">${RUD_QURAN_RECITERS.map((r) => `<option value="${r.id}" ${r.id === rudQuranReciter() ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label><div class="rud-quran-sheet-list"><button type="button" data-quran-offline-toggle><span>${offline ? 'Available Offline' : 'Make Available Offline'}</span><b>${offline ? '✓' : '↓'}</b></button><button type="button" data-quran-sheet="settings"><span>Reading Settings</span><b>Aa</b></button></div><p><strong>Offline size:</strong> text only · small. Audio remains optional streaming and is never silently downloaded.<br>${rudQuranDataSaverEnabled() ? 'Data Saver is on. Audio loads only when you press play.' : 'Audio is streamed only as needed and is not saved for offline use.'}</p>`;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}
function rudQuranStartMemSession() {
  const p = rudQuranMemSettings(),
    max = rudQuranData?.arabic?.ayahs?.length || 1,
    start = Math.max(1, Math.min(max, Number(document.getElementById('rudMemStart')?.value) || 1)),
    end = Math.max(start, Math.min(max, Number(document.getElementById('rudMemEnd')?.value) || start));
  Object.assign(p, {
    enabled: true,
    startAyah: start,
    endAyah: end,
    repeat: document.querySelector('[data-quran-mem-repeat].active')?.dataset.quranMemRepeat || p.repeat || '3',
    delayMs: Number(document.getElementById('rudMemDelay')?.value) || 0,
    hideArabic: !!document.getElementById('rudMemHideArabic')?.checked,
    hideTranslation: !!document.getElementById('rudMemHideTranslation')?.checked,
    tapToReveal: !!document.getElementById('rudMemReveal')?.checked,
  });
  rudQuranSaveMemSettings(p);
  rudQuranMemSession = { active: true, current: start, repeats: 0, delayTimer: null };
  rudQuranPlaybackMode = 'arabic';
  rudQuranSavePlayerState({ mode: 'arabic' });
  rudQuranCloseSheet();
  rudQuranOpenPlayer();
  rudQuranPlayAyah(start, true);
}
function rudQuranStopMemSession() {
  rudQuranClearMemSession();
  const p = rudQuranMemSettings();
  p.enabled = false;
  rudQuranSaveMemSettings(p);
  try {
    rudQuranAudio?.pause();
  } catch {}
  rudQuranSyncPlayerUi();
}
function rudQuranToggleBookmark(ayah) {
  const ref = rudQuranRef(rudQuranCurrentSurah, ayah);
  let list = rudQuranBookmarks();
  list = list.includes(ref) ? list.filter((x) => x !== ref) : [...list, ref];
  rudQuranSaveBookmarks(list);
  rudQuranRenderAyahs();
  rudQuranUpdateContinue();
  return list.includes(ref);
}
async function rudQuranShareAyah(ayah) {
  const index = Math.max(0, Number(ayah) - 1),
    ar = rudQuranData?.arabic?.ayahs?.[index]?.text || '',
    tr = rudQuranData?.translation?.ayahs?.[index]?.text || '',
    meta = rudQuranNowMeta(),
    text = `${meta.name} ${rudQuranCurrentSurah}:${ayah}\n\n${ar}\n\n${tr}`;
  try {
    if (navigator.share) await navigator.share({ title: `${meta.name} · Ayah ${ayah}`, text });
    else {
      await navigator.clipboard.writeText(text);
      rudQuranToast('Ayah copied for sharing.');
    }
  } catch {}
}
async function rudQuranPoster(ayah) {
  const index = Math.max(0, Number(ayah) - 1),
    ar = rudQuranData?.arabic?.ayahs?.[index]?.text || '',
    tr = rudQuranData?.translation?.ayahs?.[index]?.text || '',
    meta = rudQuranNowMeta();
  return rudExportRisePoster({
    kind: "QUR'AN",
    title: `${meta.name} · Ayah ${ayah}`,
    arabic: ar,
    body: tr,
    reference: `Qur'an ${rudQuranCurrentSurah}:${ayah} · Saheeh International`,
    fileName: `quran-${rudQuranCurrentSurah}-${ayah}`,
  });
}
async function rudQuranCopyAyah(ayah) {
  const index = Math.max(0, Number(ayah) - 1),
    ar = rudQuranData?.arabic?.ayahs?.[index]?.text || '',
    tr = rudQuranData?.translation?.ayahs?.[index]?.text || '';
  try {
    await navigator.clipboard.writeText(`${ar}\n\n${tr}\n\nQur'an ${rudQuranCurrentSurah}:${ayah}`);
    rudQuranToast('Ayah copied.');
  } catch {
    rudQuranToast('Copy is unavailable on this browser.', 'error');
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  /* ---------------- QUR'AN ---------------- */
  RUD_QURAN_META_KEY = 'rud_quran_surahs_v1';
  RUD_QURAN_BOOKMARK_KEY = 'rud_quran_bookmarks_v1';
  RUD_QURAN_LAST_KEY = 'rud_quran_last_read_v1';
  RUD_QURAN_RECITER_KEY = 'rud_quran_reciter_v1';
  RUD_QURAN_OFFLINE_MAX = 8;
  RUD_QURAN_OFFLINE_STORE_KEY = 'rud_quran_offline_selected_v2';
  RUD_QURAN_MEM_STORE_KEY = 'rud_quran_memorization_v2';
  RUD_QURAN_SLEEP_STORE_KEY = 'rud_quran_sleep_timer_v2';
  RUD_QURAN_PLAYER_STORE_KEY = 'rud_quran_player_state_v2';
  RUD_QURAN_URDU_TEXT_EDITION = 'ur.jalandhry';
  RUD_QURAN_URDU_AUDIO_EDITION = 'ur.khan';
  /* The 114-surah index is bundled; the full text (~2.5 MB) is a lazily loaded chunk (see quranText.ts). */
  RUD_QURAN_BUILTIN = { surahs: QURAN_SURAH_INDEX, data: null };
  RUD_QURAN_RECITERS = [
    { id: 'ar.alafasy', name: 'Mishary Rashid Alafasy' },
    { id: 'ar.husary', name: 'Mahmoud Khalil Al-Husary' },
    { id: 'ar.minshawi', name: 'Mohamed Siddiq Al-Minshawi' },
    { id: 'ar.sudais', name: 'Abdul Rahman Al-Sudais' },
    { id: 'ar.abdulbasit', name: 'Abdul Basit Abdul Samad' },
  ];
  rudQuranSurahCache = new Map();
  rudQuranUrduCache = new Map();
  rudQuranUrduPending = new Map();
  rudQuranSurahs = [];
  rudQuranData = null;
  rudQuranCurrentSurah = 1;
  rudQuranCurrentAyah = 1;
  rudQuranFullPlay = false;
  rudQuranRequest = 0;
  rudQuranAudio = null;
  rudQuranPlaybackMode = 'arabic';
  rudQuranPlaybackPhase = 'arabic';
  rudQuranPausedByUser = false;
  rudQuranPlaybackCommand = 0;
  rudQuranSleepTimer = null;
  rudQuranSleepEndsAt = 0;
  rudQuranSleepMode = 'off';
  rudQuranMemSession = { active: false, current: 0, repeats: 0, delayTimer: null };
  rudQuranRepeatMode = '1';
  rudQuranRepeatIteration = 0;
  rudQuranActionAyah = 1;
  rudQuranPlaybackState = null;
  rudQuranLastManualScroll = 0;
  rudQuranAutoScrollUntil = 0;
  rudQuranPersistAt = 0;
  rudQuranActivityTimer = null;
  /* ---------------- QUR'AN AUDIO — FRESH SINGLE ENGINE ---------------- */
  RUD_QURAN_AYAH_OFFSETS = (() => {
    let n = 0;
    return RUD_QURAN_BUILTIN.surahs.map((s) => {
      const start = n + 1;
      n += Number(s.numberOfAyahs) || 0;
      return start;
    });
  })();
  window.rudRenderQuran = async function () {
    rudQuranEnsurePlayerChrome();
    const parts = (location.hash || '#quran')
        .replace(/^#quran\/?/, '')
        .split('/')
        .filter(Boolean),
      last = rudQuranLast(),
      hasExplicit = parts.length > 0,
      startSurah = Number(parts[0]) || last?.surah || 1,
      startAyah = Number(parts[1]) || last?.ayah || 1;
    if (last?.playbackMode && ['arabic', 'urdu', 'arabic-urdu'].includes(last.playbackMode) && !rudQuranAudio?.src)
      rudQuranPlaybackMode = last.playbackMode;
    if (rudQuranActivityTimer) {
      clearInterval(rudQuranActivityTimer);
      rudQuranActivityTimer = null;
    }
    rudQuranActivityTimer = setInterval(() => {
      const page = document.querySelector('.rud-quran-page');
      if (!page) {
        clearInterval(rudQuranActivityTimer);
        rudQuranActivityTimer = null;
        return;
      }
      if (!document.hidden && page.classList.contains('reading') && rudQuranCurrentSurah && rudQuranCurrentAyah)
        rudTrackQuranLocalActivity(`${Number(rudQuranCurrentSurah)}:${Number(rudQuranCurrentAyah)}`);
    }, 30000);
    const html = `<section class="rud-quran-page ${hasExplicit ? 'reading' : ''}"><header class="rud-quran-app-head"><div><span>RISE UPON DEEN · QUR'AN</span><h1>Qur’an</h1><p>Read with presence. Listen with focus.</p></div><button type="button" class="rud-quran-back-home" data-rud-feature-back aria-label="Back to home">← Back</button></header><div class="rud-quran-layout"><aside class="rud-quran-sidebar"><div class="rud-quran-continue" id="rudQuranContinue"></div><div class="rud-quran-library-head"><div><span>SURAHS</span><strong>114 Chapters</strong></div><label class="rud-quran-search"><span aria-hidden="true">⌕</span><input id="rudQuranSurahFilter" type="search" placeholder="Search Surah, cached Ayah, saved" aria-label="Search Qur'an locally"></label></div><div class="rud-quran-bookmarks" id="rudQuranBookmarks"></div><div class="rud-surah-list" id="rudSurahList"><div class="rud-quran-list-skeleton">${Array.from({ length: 7 }, () => '<span></span>').join('')}</div></div></aside><main class="rud-quran-reader" id="rudQuranReader"><div class="rud-quran-reader-welcome"><span aria-hidden="true">۞</span><h2>Select a Surah</h2><p>Choose from the Qur'an library to begin reading.</p></div></main><aside class="rud-quran-side-player" id="rudQuranSidePlayer"></aside></div><p class="rud-quran-source-note">Qur'an text and online recitation: Al Quran Cloud / Islamic Network. English meaning: Saheeh International. Urdu text: Fateh Muhammad Jalandhry. Urdu verse-by-verse audio: Shamshad Ali Khan.</p></section>`;
    if (!featureShowPage(html, 'Qur’an | Rise Upon Deen')) return;
    rudQuranSyncFocusClass();
    try {
      rudGetQuranSurahs();
      if (!document.querySelector('.rud-quran-page')) return;
      rudQuranRenderSurahList();
      rudQuranUpdateContinue();
      rudQuranSyncPlayerUi();
      if (hasExplicit) {
        await rudQuranEnsureText();
        if (!document.querySelector('.rud-quran-page')) return;
      } else rudQuranEnsureText().catch(() => {});
      if (hasExplicit) await rudQuranLoadSurah(startSurah, startAyah, true, { preserveAudio: false });
      else rudQuranShowDiscovery();
    } catch (e) {
      const status = document.getElementById('rudSurahList');
      if (status)
        status.innerHTML = `<div class="rud-quran-error-state"><strong>Qur'an library could not be loaded.</strong><span>Please try again.</span><button type="button" data-quran-retry-library>Retry</button></div>`;
    }
  };
  document.addEventListener(
    'click',
    (e) => {
      const reveal = e.target.closest?.('.rud-ayah-arabic,.rud-ayah-meaning');
      if (reveal && document.querySelector('.rud-quran-page.rud-mem-tap-reveal')) {
        reveal.classList.toggle('rud-mem-revealed');
        return;
      }
      const selectedRow = e.target.closest?.('#rudAyahList .rud-ayah');
      if (selectedRow && !e.target.closest?.('button')) {
        const ayah = Number(selectedRow.dataset.ayah) || 0;
        if (ayah) rudQuranSetActiveAyah(ayah, false);
      }
      if (e.target.closest?.('[data-quran-sheet-close]')) {
        e.preventDefault();
        rudQuranCloseSheet();
        return;
      }
      if (e.target === document.getElementById('rudQuranSheetOverlay')) {
        rudQuranCloseSheet();
        return;
      }
      const sheet = e.target.closest?.('[data-quran-sheet]');
      if (sheet) {
        e.preventDefault();
        rudQuranOpenSheet(sheet.dataset.quranSheet);
        return;
      }
      if (e.target.closest?.('[data-quran-study-toggle]')) {
        e.preventDefault();
        const p = rudQuranReadingPrefs();
        p.studyMode = !p.studyMode;
        rudQuranSaveReadingPrefs(p);
        rudQuranRenderReader();
        return;
      }
      const study = e.target.closest?.('[data-quran-study-action]');
      if (study) {
        e.preventDefault();
        const a = study.dataset.quranStudyAction,
          p = rudQuranReadingPrefs();
        if (a === 'translation') {
          p.translationVisible = p.translationVisible === false;
          rudQuranSaveReadingPrefs(p);
          rudQuranRenderReader();
        } else if (a === 'urdu') {
          p.urduVisible = !p.urduVisible;
          rudQuranSaveReadingPrefs(p);
          rudQuranRenderReader();
          if (p.urduVisible)
            rudQuranEnsureUrdu({ needAudio: false })
              .then((d) => rudQuranApplyUrduText(d.text))
              .catch(() => {});
        } else if (a === 'reflection') rudQuranOpenSheet('reflection', rudQuranCurrentAyah);
        else if (a === 'repeat') rudQuranOpenSheet('repeat');
        else if (a === 'memorize') rudQuranOpenSheet('memorize');
        return;
      }
      const surah = e.target.closest?.('[data-quran-surah]');
      if (surah) {
        e.preventDefault();
        rudQuranLoadSurah(+surah.dataset.quranSurah, 1, true);
        return;
      }
      const jump = e.target.closest?.('[data-quran-jump]');
      if (jump) {
        e.preventDefault();
        const [s, a] = jump.dataset.quranJump.split(':').map(Number);
        rudQuranLoadSurah(s, a, true);
        return;
      }
      if (e.target.closest?.('[data-quran-reader-back]')) {
        e.preventDefault();
        rudQuranShowDiscovery();
        return;
      }
      if (e.target.closest?.('[data-quran-play-from-here]')) {
        e.preventDefault();
        if (rudQuranPlaybackMode === 'arabic') rudQuranPlayAyah(rudQuranCurrentAyah, true);
        else rudQuranPlayCurrentMode(rudQuranCurrentAyah, true);
        rudQuranOpenPlayer();
        return;
      }
      const play = e.target.closest?.('[data-quran-play]');
      if (play) {
        e.preventDefault();
        const ayah = Number(play.dataset.quranPlay) || rudQuranCurrentAyah;
        if (rudQuranPlaybackMode === 'arabic') rudQuranPlayAyah(ayah, false);
        else rudQuranPlayCurrentMode(ayah, false);
        return;
      }
      const menu = e.target.closest?.('[data-quran-ayah-menu]');
      if (menu) {
        e.preventDefault();
        const ayah = +menu.dataset.quranAyahMenu;
        rudQuranSetActiveAyah(ayah, false);
        rudQuranOpenSheet('ayah', ayah);
        return;
      }
      const action = e.target.closest?.('[data-quran-player-action]');
      if (action) {
        e.preventDefault();
        const a = action.dataset.quranPlayerAction;
        if (a === 'expand') rudQuranOpenPlayer();
        else if (a === 'minimize') rudQuranMinimizePlayer();
        /* Mini player: collapse to a small floating control and restore it. Only the UI changes;
           the audio element and playback position are untouched. */ else if (a === 'collapse' || a === 'restore') {
          rudQuranSavePlayerState({ miniCollapsed: a === 'collapse' });
          rudQuranSyncPlayerUi();
          document.querySelector(a === 'collapse' ? '.rud-quran-mini-restore' : '.rud-quran-mini-collapse')?.focus({ preventScroll: true });
        }
        else if (a === 'toggle') rudQuranTogglePlayback();
        else if (a === 'prev') rudQuranSkipAyah(rudQuranCurrentAyah - 1);
        else if (a === 'next') rudQuranSkipAyah(rudQuranCurrentAyah + 1);
        else if (a === 'retry') rudQuranRetryAudio();
        return;
      }
      const mode = e.target.closest?.('[data-quran-mode]');
      if (mode) {
        e.preventDefault();
        rudQuranSelectMode(mode.dataset.quranMode);
        return;
      }
      const repeat = e.target.closest?.('[data-quran-repeat-mode]');
      if (repeat) {
        e.preventDefault();
        rudQuranRepeatMode = repeat.dataset.quranRepeatMode;
        rudQuranRepeatIteration = 0;
        rudQuranSavePlayerState({ repeat: rudQuranRepeatMode });
        rudQuranCloseSheet();
        rudQuranSyncPlayerUi();
        return;
      }
      const sleep = e.target.closest?.('[data-quran-sleep-mode]');
      if (sleep) {
        e.preventDefault();
        rudQuranSetSleep(sleep.dataset.quranSleepMode);
        rudQuranCloseSheet();
        return;
      }
      const memRepeat = e.target.closest?.('[data-quran-mem-repeat]');
      if (memRepeat) {
        e.preventDefault();
        document
          .querySelectorAll('[data-quran-mem-repeat]')
          .forEach((x) => x.classList.toggle('active', x === memRepeat));
        return;
      }
      if (e.target.closest?.('[data-quran-mem-start]')) {
        e.preventDefault();
        rudQuranStartMemSession();
        return;
      }
      if (e.target.closest?.('[data-quran-mem-stop]')) {
        e.preventDefault();
        rudQuranStopMemSession();
        return;
      }
      if (e.target.closest?.('[data-quran-offline-toggle]')) {
        e.preventDefault();
        if (rudQuranOfflineGet(rudQuranCurrentSurah)) {
          rudQuranRemoveOffline(rudQuranCurrentSurah);
          rudQuranToast('Surah removed from offline content.');
        } else if (rudQuranSaveOfflineCurrent())
          rudQuranToast('Surah text is available offline. Audio is not downloaded.');
        rudQuranCloseSheet();
        rudQuranRenderReader();
        return;
      }
      const ayahAction = e.target.closest?.('[data-quran-ayah-action]');
      if (ayahAction) {
        e.preventDefault();
        const a = ayahAction.dataset.quranAyahAction,
          ayah = rudQuranActionAyah;
        rudQuranSetActiveAyah(ayah, false);
        if (a === 'play') {
          rudQuranCloseSheet();
          rudQuranPlayCurrentMode(ayah, false);
        } else if (a === 'save') {
          const saved = rudQuranToggleBookmark(ayah);
          rudQuranToast(saved ? 'Ayah saved.' : 'Ayah removed from Saved.');
          rudQuranCloseSheet();
        } else if (a === 'reflection') rudQuranOpenSheet('reflection', ayah);
        else if (a === 'study') {
          const prefs = rudQuranReadingPrefs();
          prefs.studyMode = true;
          rudQuranSaveReadingPrefs(prefs);
          rudQuranCloseSheet();
          rudQuranRenderReader();
          rudQuranSetActiveAyah(ayah, false);
        } else if (a === 'memorize') rudQuranOpenSheet('memorize', ayah);
        else if (a === 'poster') {
          rudQuranCloseSheet();
          rudQuranPoster(ayah);
        } else if (a === 'share') rudQuranShareAyah(ayah);
        else if (a === 'copy') rudQuranCopyAyah(ayah);
        else if (a === 'repeat') {
          rudQuranCloseSheet();
          rudQuranOpenSheet('repeat', ayah);
        }
        return;
      }
      if (e.target.closest?.('[data-quran-reflection-save]')) {
        e.preventDefault();
        const ref = rudQuranRef(rudQuranCurrentSurah, rudQuranActionAyah),
          text = document.getElementById('rudQuranReflectionText')?.value || '';
        rudSaveAyahNote(ref, text);
        rudQuranToast('My Reflection saved locally.');
        rudQuranCloseSheet();
        return;
      }
      if (e.target.closest?.('[data-quran-reflection-delete]')) {
        e.preventDefault();
        const ref = rudQuranRef(rudQuranCurrentSurah, rudQuranActionAyah);
        rudSaveAyahNote(ref, '');
        rudQuranToast('My Reflection removed.');
        rudQuranCloseSheet();
        return;
      }
      const retry = e.target.closest?.('[data-quran-retry-surah]');
      if (retry) {
        e.preventDefault();
        const [s, a] = retry.dataset.quranRetrySurah.split(':').map(Number);
        rudQuranLoadSurah(s, a, true);
        return;
      }
      if (e.target.closest?.('[data-quran-retry-library]')) {
        e.preventDefault();
        window.rudRenderQuran();
        return;
      }
    },
    true,
  );
  rudQuranSearchTimer = 0;
  document.addEventListener('input', (e) => {
    if (e.target?.id === 'rudQuranSurahFilter') {
      const value = e.target.value;
      clearTimeout(rudQuranSearchTimer);
      rudQuranSearchTimer = setTimeout(() => rudQuranRenderSurahList(value), 120);
      return;
    }
    if (e.target?.matches?.('[data-quran-seek]')) {
      const audio = rudQuranAudio;
      if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      audio.currentTime = (audio.duration * (Number(e.target.value) || 0)) / 1000;
      rudQuranSyncPlayerUi();
      return;
    }
    const range = e.target?.closest?.('[data-quran-setting-range]');
    if (range) {
      const prefs = rudQuranReadingPrefs(),
        values = ['small', 'normal', 'large', 'xl'];
      prefs[range.dataset.quranSettingRange] = values[Math.max(0, Math.min(3, Number(range.value) || 0))];
      rudQuranSaveReadingPrefs(prefs);
      return;
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target?.id === 'rudQuranReciter') {
      rudQuranSetReciter(e.target.value);
      rudStopQuranAudio({ clearSession: false });
      rudQuranSurahCache.clear();
      rudQuranData = null;
      rudQuranLoadSurah(rudQuranCurrentSurah, rudQuranCurrentAyah, false);
      rudQuranToast('Reciter changed. Tap Play to start the new recitation.');
      rudQuranCloseSheet();
      return;
    }
    const setting = e.target?.closest?.('[data-quran-setting]');
    if (setting) {
      const prefs = rudQuranReadingPrefs(),
        key = setting.dataset.quranSetting;
      prefs[key] = setting.type === 'checkbox' ? setting.checked : setting.value;
      rudQuranSaveReadingPrefs(prefs);
      if (key === 'translationVisible') rudQuranApplyTranslationVisibility();
      if (key === 'studyMode') rudQuranRenderReader();
      if (key === 'urduVisible') {
        const cached = rudQuranUrduCache.get(rudQuranCurrentSurah);
        if (prefs.urduVisible) {
          if (cached?.text) rudQuranApplyUrduText(cached.text);
          else
            rudQuranEnsureUrdu({ needAudio: false })
              .then((d) => rudQuranApplyUrduText(d.text))
              .catch(() => {});
        } else rudQuranApplyUrduText(cached?.text || null);
      }
      return;
    }
  });
  window.addEventListener(
    'scroll',
    () => {
      if (document.querySelector('.rud-quran-page') && Date.now() > rudQuranAutoScrollUntil)
        rudQuranLastManualScroll = Date.now();
    },
    { passive: true },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        if (document.querySelector('.rud-quran-page.reading') && rudQuranCurrentSurah && rudQuranCurrentAyah)
          rudTrackQuranLocalActivity(`${Number(rudQuranCurrentSurah)}:${Number(rudQuranCurrentAyah)}`);
        rudQuranPersistPlayback(true);
      }
    },
    { passive: true },
  );
}

export {
  rudQuranBookmarks,
  rudQuranCloseSheet,
  rudQuranCurrentAyah,
  rudQuranCurrentSurah,
  rudQuranData,
  rudQuranLast,
  rudQuranMinimizePlayer,
  rudQuranSurahs,
};
