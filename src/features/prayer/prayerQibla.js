/**
 * Prayer times (API with on-device fallback), live clock, location watch, Qibla compass and nearby masjids.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { openNearbyMasjids } from './NearbyMasjids';
import { showHome } from '../../app/routing/surfaces';
import { featureShowPage, pageHead, setFeatureHash } from '../tools/featurePageShell';
import { busy } from '../../utils/ui';

let KAABA,
  compassHandler,
  qiblaBearing,
  prayerTimer,
  prayerData,
  lastCoords,
  prayerLocationWatchId,
  prayerReloading,
  prayerLoadPromise,
  prayerLoadKey,
  prayerLoadToken,
  sensorTimer,
  sensorReceived,
  sensorQuality,
  smoothedHeading,
  relativeBaseAlpha,
  relativeBaseRotation,
  compassRaf,
  pendingCompassUpdate;

function norm(n) {
  return ((n % 360) + 360) % 360;
}
function signedDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}
function qibla(lat, lng) {
  const p1 = (lat * Math.PI) / 180,
    p2 = (KAABA.lat * Math.PI) / 180,
    d = ((KAABA.lng - lng) * Math.PI) / 180;
  return norm((Math.atan2(Math.sin(d), Math.cos(p1) * Math.tan(p2) - Math.sin(p1) * Math.cos(d)) * 180) / Math.PI);
}
function regionalMethod(tz) {
  tz = String(tz || '');
  if (/Riyadh/.test(tz)) return { id: 4, name: 'Umm Al-Qura University, Makkah', school: 0 };
  if (/Dubai|Muscat|Bahrain/.test(tz)) return { id: 8, name: 'Gulf Region', school: 0 };
  if (/Kuwait/.test(tz)) return { id: 9, name: 'Kuwait', school: 0 };
  if (/Qatar/.test(tz)) return { id: 10, name: 'Qatar', school: 0 };
  if (/Karachi|Kolkata|Dhaka|Colombo/.test(tz))
    return { id: 1, name: 'University of Islamic Sciences, Karachi', school: 0 };
  if (/Cairo/.test(tz)) return { id: 5, name: 'Egyptian General Authority of Survey', school: 0 };
  if (/Istanbul/.test(tz)) return { id: 13, name: 'Diyanet, Turkey', school: 0 };
  if (/Kuala_Lumpur/.test(tz)) return { id: 17, name: 'JAKIM, Malaysia', school: 0 };
  if (/Jakarta/.test(tz)) return { id: 20, name: 'Kementerian Agama, Indonesia', school: 0 };
  return { id: 3, name: 'Muslim World League', school: 0 };
}
function stopPrayerClock() {
  if (prayerTimer) {
    clearInterval(prayerTimer);
    prayerTimer = null;
  }
  if (prayerLocationWatchId != null && navigator.geolocation) {
    try {
      navigator.geolocation.clearWatch(prayerLocationWatchId);
    } catch {}
    prayerLocationWatchId = null;
  }
  prayerReloading = false;
  prayerData = null;
}
function featureShowHome() {
  stopCompass();
  stopPrayerClock();
  if (typeof showHome === 'function') showHome('');
}
function stopCompass() {
  if (compassHandler) {
    window.removeEventListener('deviceorientationabsolute', compassHandler, true);
    window.removeEventListener('deviceorientation', compassHandler, true);
    compassHandler = null;
  }
  if (sensorTimer) {
    clearTimeout(sensorTimer);
    sensorTimer = null;
  }
  if (compassRaf) {
    cancelAnimationFrame(compassRaf);
    compassRaf = null;
  }
  pendingCompassUpdate = null;
  sensorReceived = false;
  sensorQuality = 0;
  smoothedHeading = null;
  relativeBaseAlpha = null;
  relativeBaseRotation = null;
  document.querySelector('.rud-qibla-wrap')?.classList.remove('rud-aligned');
}
function getLocation() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Geolocation is not supported on this browser/device.'));
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      fn(v);
    };
    navigator.geolocation.getCurrentPosition(
      (p) => finish(res, p),
      (e) => finish(rej, e),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 },
    );
    setTimeout(() => {
      if (done) return;
      try {
        navigator.geolocation.getCurrentPosition(
          (p) => finish(res, p),
          (e) => finish(rej, e),
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
        );
      } catch (e) {
        finish(rej, e);
      }
    }, 5000);
  });
}
function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371,
    toRad = (x) => (x * Math.PI) / 180,
    dLat = toRad(b.lat - a.lat),
    dLng = toRad(b.lng - a.lng),
    la1 = toRad(a.lat),
    la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function startPrayerLocationWatch() {
  if (prayerLocationWatchId != null || !navigator.geolocation) return;
  try {
    prayerLocationWatchId = navigator.geolocation.watchPosition(
      async (pos) => {
        if (!document.getElementById('rudPrayerState')) return;
        const lat = Number(pos.coords.latitude),
          lng = Number(pos.coords.longitude),
          acc = Number(pos.coords.accuracy || 0);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const next = { lat, lng };
        if (lastCoords && distanceKm(lastCoords, next) < 5) return;
        if (acc && acc > 1500) return;
        lastCoords = next;
        qiblaBearing = qibla(lat, lng);
        const deg = document.getElementById('rudQiblaDegrees');
        if (deg) deg.textContent = `${qiblaBearing.toFixed(1)}° from true north`;
        if (!prayerReloading) {
          prayerReloading = true;
          try {
            await loadPrayerTimes(lat, lng);
          } finally {
            prayerReloading = false;
          }
        }
      },
      { enableHighAccuracy: true, maximumAge: 300000, timeout: 12000 },
    );
  } catch {}
}
async function initPrayer() {
  const state = document.getElementById('rudPrayerState');
  if (!state) return;

  // Prayer is location-gated by design. Saved coordinates/timings are never
  // displayed as a substitute for the device's current location.
  let locationRequestBusy = false;

  const updateLocationUi = (message, showRetry = true) => {
    const liveState = document.getElementById('rudPrayerState');
    if (!liveState) return;
    liveState.innerHTML = `<div class="rud-status">${message}</div>${showRetry ? '<button class="rud-mini-btn" id="rudPrayerUseLocation" type="button" style="margin-top:12px">Allow Location & Load Timings</button>' : ''}`;
    const retry = document.getElementById('rudPrayerUseLocation');
    if (retry && !retry.dataset.locationBound) {
      retry.dataset.locationBound = '1';
      retry.addEventListener('click', requestLocation, { passive: true });
    }
  };

  const requestLocation = async () => {
    if (locationRequestBusy) return;
    locationRequestBusy = true;
    const action = document.getElementById('rudPrayerUseLocation');
    if (action) busy(action, true, 'Requesting Location…');
    const liveState = document.getElementById('rudPrayerState');
    if (liveState) liveState.innerHTML = '<div class="rud-status">Requesting your device location…</div>';
    try {
      if (!window.isSecureContext && location.protocol !== 'https:') {
        throw new Error(
          'Location access requires a secure HTTPS connection. Reopen the installed app from its secure site.',
        );
      }
      const pos = await getLocation();
      if (!document.getElementById('rudPrayerState')) return;
      const lat = Number(pos.coords.latitude),
        lng = Number(pos.coords.longitude),
        acc = Number(pos.coords.accuracy || 0);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Precise coordinates were not available.');

      lastCoords = { lat, lng };
      qiblaBearing = qibla(lat, lng);
      const deg = document.getElementById('rudQiblaDegrees'),
        text = document.getElementById('rudQiblaText'),
        arrow = document.getElementById('rudQiblaArrow');
      if (deg) deg.textContent = `${qiblaBearing.toFixed(1)}° from true north`;
      if (text) text.textContent = 'Enable the live compass to align your phone';
      if (arrow) arrow.style.transform = `rotate(${qiblaBearing}deg)`;

      const status = document.getElementById('rudPrayerState');
      if (status)
        status.innerHTML = `<div class="rud-status">Location ready${acc ? ` · accuracy about ${Math.round(acc)} m` : ''} · generating today’s local prayer times…</div>`;
      await loadPrayerTimes(lat, lng);
      startPrayerLocationWatch();
    } catch (e) {
      if (!document.getElementById('rudPrayerState')) return;
      let msg =
        'Location access is required to generate your local prayer times. Please allow location access and try again.';
      if (e && e.code === 1)
        msg =
          'Location permission is required for Prayer. Allow Location for Rise Upon Deen in iOS/Android settings, then tap Allow Location & Load Timings.';
      else if (e && e.code === 2)
        msg = 'Your device could not determine your location. Turn on Location Services/GPS and try again.';
      else if (e && e.code === 3)
        msg = 'Location request timed out. Make sure Location Services/GPS is enabled and try again.';
      else if (e && e.message) msg = e.message;
      updateLocationUi(msg, true);
    } finally {
      locationRequestBusy = false;
      const current = document.getElementById('rudPrayerUseLocation');
      if (current) busy(current, false);
    }
  };

  // Never render a saved schedule before location is granted. The installed
  // iOS/Android PWA must obtain the device location first, then fetch timings.
  updateLocationUi(
    'Location access is required to calculate today’s prayer times and Qibla. Requesting your location…',
    false,
  );
  requestLocation();
}
function cleanTime(v) {
  const m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  return m ? { h: +m[1], m: +m[2], sec: +m[1] * 3600 + +m[2] * 60 } : null;
}
function tzNow(tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((x) => x.type === t)?.value || 0);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), m: get('minute'), s: get('second') };
}
function fmtPrayer(v) {
  const p = cleanTime(v);
  if (!p) return '—';
  const d = new Date(2000, 0, 1, p.h, p.m);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
}
function updatePrayerClock() {
  if (!prayerData || !document.getElementById('rudPrayerTimes')) return;
  const { t, tz, names, stamp } = prayerData;
  const currentStamp = prayerDateStamp(tz);
  if (stamp && currentStamp !== stamp && lastCoords && !prayerReloading) {
    prayerReloading = true;
    loadPrayerTimes(lastCoords.lat, lastCoords.lng).finally(() => {
      prayerReloading = false;
    });
    return;
  }
  const n = tzNow(tz),
    nowSec = n.h * 3600 + n.m * 60 + n.s;
  let nextName = null,
    nextDelta = Infinity;
  for (const name of names) {
    if (name === 'Sunrise') continue;
    const p = cleanTime(t[name]);
    if (!p) continue;
    let delta = p.sec - nowSec;
    if (delta <= 0) delta += 86400;
    if (delta < nextDelta) {
      nextDelta = delta;
      nextName = name;
    }
  }
  document
    .querySelectorAll('.rud-prayer-row')
    .forEach((row) => row.classList.toggle('next', row.dataset.prayer === nextName));
  const nextEl = document.getElementById('rudNextPrayer');
  if (nextEl && nextName) {
    const hrs = Math.floor(nextDelta / 3600),
      mins = Math.floor((nextDelta % 3600) / 60),
      secs = Math.floor(nextDelta % 60),
      count = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    nextEl.classList.remove('rud-hidden');
    nextEl.innerHTML = `<div><small>Next Prayer</small><strong>${nextName} · ${fmtPrayer(t[nextName])}</strong></div><div class="rud-next-countdown">${count} remaining</div>`;
  }
}
function prayerDateStamp(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (k) => parts.find((x) => x.type === k)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function prayerApiDate(stamp) {
  const match = String(stamp || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(stamp || '');
}
function renderPrayerTimes(t, tz, stamp, m, lat, lng, readable = '') {
  const required = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  if (required.some((name) => !cleanTime(t[name]))) throw new Error('Incomplete prayer-time data');
  if (typeof window.rudCacheResolvedPrayerTimes !== 'function') throw new Error('Prayer cache is not ready');
  window.rudCacheResolvedPrayerTimes(t, tz, stamp, { method: m.id, school: m.school, lat, lng });
  const host = document.getElementById('rudPrayerTimes');
  if (!host) return true;
  const names = ['Fajr', ...(cleanTime(t.Sunrise) ? ['Sunrise'] : []), 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  const dateEl = document.getElementById('rudPrayerDate');
  if (dateEl) dateEl.textContent = `${readable || stamp} · ${tz}`;
  const prayerUnits = {
    Fajr: ['2 Sunnah', '2 Fard'],
    Dhuhr: ['4 Sunnah', '4 Fard', '2 Sunnah', 'Nafl optional'],
    Asr: ['4 Sunnah before', '4 Fard'],
    Maghrib: ['3 Fard', '2 Sunnah', 'Nafl optional'],
    Isha: ['4 Fard', '2 Sunnah', 'Nafl optional', 'Witr odd'],
  };
  host.innerHTML = names
    .map(
      (name) =>
        `<div class="rud-prayer-row" data-prayer="${name}"><div><strong>${name}</strong>${prayerUnits[name] ? `<div class="rud-prayer-units">${prayerUnits[name].map((unit) => `<span class="rud-prayer-unit">${unit}</span>`).join('')}</div>` : ''}</div><strong>${fmtPrayer(t[name])}</strong></div>`,
    )
    .join('');
  const method = document.getElementById('rudPrayerMethod');
  if (method) {
    const sunrise = cleanTime(t.Sunrise),
      maghrib = cleanTime(t.Maghrib),
      fajr = cleanTime(t.Fajr);
    const clock = (sec) => {
      sec = ((sec % 86400) + 86400) % 86400;
      const h = Math.floor(sec / 3600),
        min = Math.floor((sec % 3600) / 60);
      return fmtPrayer(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    };
    const ishraq = sunrise ? clock(sunrise.sec + 15 * 60) : '—',
      lastThird = maghrib && fajr ? clock(maghrib.sec + ((fajr.sec + 86400 - maghrib.sec) * 2) / 3) : '—',
      finalHour = fajr ? `${clock(fajr.sec - 3600)} – ${fmtPrayer(t.Fajr)}` : '—';
    method.innerHTML = `<div class="rud-prayer-extra-grid"><div class="rud-prayer-extra-card"><span>Ishraq / Duha</span><strong>${ishraq}</strong><small>2+ rak'ahs · after the sun has risen clearly</small></div><div class="rud-prayer-extra-card"><span>Last third of night</span><strong>${lastThird}</strong><small>Tahajjud: 2 by 2 · Witr: odd</small></div><div class="rud-prayer-extra-card"><span>Final hour before Fajr</span><strong>${finalHour}</strong><small>A simple late-night worship window</small></div><div class="rud-prayer-extra-card"><span>Avoid after Fajr</span><strong>After Fajr prayer → about ${ishraq}</strong><small>Fajr ${fmtPrayer(t.Fajr)} · Sunrise ${fmtPrayer(t.Sunrise)} · wait until the sun has risen clearly</small></div><div class="rud-prayer-extra-card"><span>Avoid at solar zenith</span><strong>Immediately before Dhuhr → ${fmtPrayer(t.Dhuhr)}</strong><small>Brief period while the sun is at its highest point; exact start varies by solar position</small></div><div class="rud-prayer-extra-card"><span>Avoid after Asr</span><strong>After Asr prayer → ${fmtPrayer(t.Maghrib)}</strong><small>Asr ${fmtPrayer(t.Asr)} · Maghrib ${fmtPrayer(t.Maghrib)} · avoid general voluntary prayer until sunset</small></div></div><div class="rud-prayer-reference">Regular Sunnah: Tirmidhi 415 · Before Asr: Tirmidhi 430 · Duha: Muslim 720 · Night prayer/Witr: Muslim 749 · Prohibited times: Muslim 826a, 831</div><div class="rud-prayer-method-line">${m.name} · Standard Asr · Times from your current coordinates; local schedules may differ slightly.</div>`;
  }
  prayerData = { t, tz, names, stamp, lat, lng, method: m.id, school: m.school };
  updatePrayerClock();
  if (prayerTimer) clearInterval(prayerTimer);
  prayerTimer = setInterval(updatePrayerClock, 1000);
  return true;
}
function rudTzOffsetMinutes(date, tz) {
  try {
    const d = new Date(date.getTime());
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const n = (k) => Number(parts.find((x) => x.type === k)?.value || 0);
    return (Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - d.getTime()) / 60000;
  } catch {
    return 0;
  }
}
function rudLocalPrayerTimes(lat, lng, tz, methodId, stamp) {
  const date = new Date(`${stamp}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid prayer date');
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const N = Math.floor((date - start) / 86400000);
  const g = ((2 * Math.PI) / 365) * (N - 1);
  const eq =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const tzOff = rudTzOffsetMinutes(date, tz),
    solarNoon = 720 - 4 * Number(lng) - eq + tzOff;
  const rad = Math.PI / 180,
    phi = Number(lat) * rad;
  const haForAlt = (alt) => {
    const x = (Math.sin(alt * rad) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
    if (x <= -1) return 12 * 60;
    if (x >= 1) return 0;
    return (Math.acos(x) / rad) * 4;
  };
  const fmt = (min) => {
    min = ((min % 1440) + 1440) % 1440;
    const h = Math.floor(min / 60),
      m = Math.round(min % 60);
    return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const sunrise = haForAlt(-0.833),
    fajrAngle = Number(methodId) === 4 ? 18.5 : 18,
    ishaAngle = Number(methodId) === 4 ? 18 : 18;
  const fajr = haForAlt(-fajrAngle),
    isha = haForAlt(-ishaAngle);
  const asrAlt = Math.atan(1 / (1 + Math.tan(Math.abs(phi - decl)))) / rad;
  const asr = haForAlt(asrAlt);
  const maghrib = sunrise;
  let fajrMin = solarNoon - fajr,
    sunriseMin = solarNoon - sunrise,
    dhuhrMin = solarNoon + 1,
    asrMin = solarNoon + asr,
    maghribMin = solarNoon + maghrib,
    ishaMin = solarNoon + isha;
  if (Number(methodId) === 4) {
    ishaMin = maghribMin + 90;
  }
  return {
    Fajr: fmt(fajrMin),
    Sunrise: fmt(sunriseMin),
    Dhuhr: fmt(dhuhrMin),
    Asr: fmt(asrMin),
    Maghrib: fmt(maghribMin),
    Isha: fmt(ishaMin),
  };
}
async function loadPrayerTimes(lat, lng) {
  lat = Number(lat);
  lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    baseStamp = prayerDateStamp(browserTz),
    key = `${Math.round(lat * 1000)}:${Math.round(lng * 1000)}:${baseStamp}`;
  if (prayerLoadPromise && prayerLoadKey === key) return prayerLoadPromise;
  const token = ++prayerLoadToken;
  prayerLoadKey = key;
  const task = (async () => {
    async function request(tzHint, stamp) {
      const m = regionalMethod(tzHint || browserTz),
        url = `https://api.aladhan.com/v1/timings/${prayerApiDate(stamp)}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&method=${m.id}&school=${m.school}`;
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 9000);
      try {
        const r = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!r.ok) throw new Error('Prayer-time service unavailable');
        const j = await r.json();
        if (j.code !== 200 || !j.data || !j.data.timings) throw new Error('Prayer-time data unavailable');
        return { j, m };
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      let stamp = baseStamp,
        { j, m } = await request(browserTz, baseStamp),
        apiTz = j.data.meta?.timezone || browserTz,
        locationStamp = prayerDateStamp(apiTz),
        regional = regionalMethod(apiTz);
      if (locationStamp !== stamp || regional.id !== m.id || regional.school !== m.school) {
        stamp = locationStamp;
        ({ j, m } = await request(apiTz, stamp));
        apiTz = j.data.meta?.timezone || apiTz;
      }
      if (token !== prayerLoadToken) return false;
      const t = j.data.timings,
        meta = j.data.meta || {},
        tz = meta.timezone || apiTz;
      return renderPrayerTimes(t, tz, stamp, m, lat, lng, j.data.date?.readable || stamp);
    } catch (apiError) {
      if (token !== prayerLoadToken) return false;
      const tz = browserTz,
        stamp = baseStamp,
        m = regionalMethod(tz),
        t = rudLocalPrayerTimes(lat, lng, tz, m.id, stamp);
      const ok = renderPrayerTimes(t, tz, stamp, m, lat, lng, `${stamp} · Calculated on device`);
      const note = document.getElementById('rudPrayerState');
      if (note) note.textContent = 'Prayer times ready · calculated on this device';
      const method = document.getElementById('rudPrayerMethod');
      if (method)
        method.innerHTML += `<div class="rud-prayer-method-line">Offline/local calculation used because the online prayer-time service was unavailable.</div>`;
      return ok;
    }
  })();
  prayerLoadPromise = task;
  try {
    return await task;
  } catch (e) {
    if (token === prayerLoadToken && document.getElementById('rudPrayerTimes') && !prayerData) {
      const el = document.getElementById('rudPrayerTimes');
      if (el)
        el.innerHTML = `<div class="rud-error">Prayer times could not be loaded. Check location and try again.</div><button class="rud-mini-btn" id="rudPrayerRetry" type="button" style="margin-top:10px">Try Again</button>`;
    }
    return false;
  } finally {
    if (prayerLoadPromise === task) {
      prayerLoadPromise = null;
      prayerLoadKey = '';
    }
  }
}
function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}
function readHeading(e) {
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading))
    return {
      kind: 'absolute',
      heading: norm(e.webkitCompassHeading),
      source: 'Device compass',
      accuracy: Number.isFinite(e.webkitCompassAccuracy) ? Math.abs(e.webkitCompassAccuracy) : null,
    };
  if (typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
    const absolute = e.absolute === true || e.type === 'deviceorientationabsolute';
    if (absolute) {
      const a = norm(e.alpha),
        angle = screenAngle();
      let heading = norm(360 - a);
      if (angle === 90) heading = norm(heading + 90);
      else if (angle === 270) heading = norm(heading - 90);
      else if (angle === 180) heading = norm(heading + 180);
      return { kind: 'absolute', heading, source: 'Device absolute compass', accuracy: null };
    }
    return { kind: 'relative', alpha: norm(e.alpha), source: 'Relative orientation' };
  }
  return { kind: 'none' };
}
function smoothHeading(next) {
  if (smoothedHeading == null) {
    smoothedHeading = next;
    return next;
  }
  smoothedHeading = norm(smoothedHeading + signedDelta(smoothedHeading, next) * 0.28);
  return smoothedHeading;
}
function renderAbsoluteHeading(raw) {
  const heading = smoothHeading(raw.heading),
    rel = norm(qiblaBearing - heading),
    arrow = document.getElementById('rudQiblaArrow'),
    wrap = document.querySelector('.rud-qibla-wrap'),
    text = document.getElementById('rudQiblaText'),
    status = document.getElementById('rudCompassStatus'),
    badge = document.getElementById('rudSensorBadge'),
    cal = document.getElementById('rudCalibration');
  if (arrow) arrow.style.transform = `rotate(${rel}deg)`;
  const delta = Math.min(rel, 360 - rel),
    aligned = delta <= 4;
  if (wrap) wrap.classList.toggle('rud-aligned', aligned);
  if (text) text.textContent = aligned ? 'Facing Qibla' : 'Rotate your phone until the Qibla marker points straight up';
  if (status)
    status.innerHTML = aligned
      ? '<strong>Facing Qibla</strong>'
      : `Live heading ${heading.toFixed(0)}° · Qibla ${qiblaBearing.toFixed(1)}°`;
  if (badge) badge.textContent = `Full compass · ${raw.source}`;
  if (cal) {
    const poor = raw.accuracy != null && raw.accuracy > 15;
    cal.classList.toggle('show', poor);
    if (poor) cal.textContent = 'Move your phone in a figure-eight motion to improve compass accuracy.';
  }
}
function renderRelative(raw) {
  const arrow = document.getElementById('rudQiblaArrow'),
    wrap = document.querySelector('.rud-qibla-wrap'),
    text = document.getElementById('rudQiblaText'),
    status = document.getElementById('rudCompassStatus'),
    badge = document.getElementById('rudSensorBadge');
  if (relativeBaseAlpha == null) {
    relativeBaseAlpha = raw.alpha;
    relativeBaseRotation = qiblaBearing;
  }
  const moved = signedDelta(relativeBaseAlpha, raw.alpha),
    rotation = norm(relativeBaseRotation - moved);
  if (arrow) arrow.style.transform = `rotate(${rotation}deg)`;
  if (wrap) wrap.classList.remove('rud-aligned');
  if (text) text.textContent = 'Relative motion detected — reliable Qibla alignment cannot be confirmed';
  if (status)
    status.textContent = `Qibla bearing is ${qiblaBearing.toFixed(1)}° from true north. This browser is not supplying an absolute north heading.`;
  if (badge) badge.textContent = 'Reduced precision · relative orientation';
}
async function enableCompass() {
  const text = document.getElementById('rudQiblaText'),
    status = document.getElementById('rudCompassStatus'),
    badge = document.getElementById('rudSensorBadge'),
    cal = document.getElementById('rudCalibration');
  if (qiblaBearing == null) {
    if (text) text.textContent = 'Location is required first';
    return;
  }
  if (!window.isSecureContext && location.protocol !== 'file:') {
    if (status) status.textContent = 'Live compass requires HTTPS in supported browsers.';
    return;
  }
  if (typeof window.DeviceOrientationEvent === 'undefined') {
    if (status)
      status.textContent = `Compass sensor is unavailable. Qibla is ${qiblaBearing.toFixed(1)}° from true north.`;
    if (badge) badge.textContent = 'Compass unavailable';
    return;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      let p = await DeviceOrientationEvent.requestPermission();
      if (p !== 'granted') throw new Error('Compass permission denied');
    }
    stopCompass();
    sensorReceived = false;
    sensorQuality = 0;
    relativeBaseAlpha = null;
    relativeBaseRotation = null;
    smoothedHeading = null;
    if (cal) cal.classList.remove('show');
    if (status) status.textContent = 'Starting live compass… keep the phone flat for a moment';
    if (badge) badge.textContent = 'Waiting for compass sensor';
    compassHandler = (e) => {
      const raw = readHeading(e);
      if (raw.kind === 'none') return;
      sensorReceived = true;
      if (sensorTimer) {
        clearTimeout(sensorTimer);
        sensorTimer = null;
      }
      pendingCompassUpdate = raw;
      if (compassRaf) return;
      compassRaf = requestAnimationFrame(() => {
        compassRaf = null;
        const latest = pendingCompassUpdate;
        pendingCompassUpdate = null;
        if (!latest) return;
        if (latest.kind === 'absolute') {
          sensorQuality = 2;
          renderAbsoluteHeading(latest);
          return;
        }
        if (latest.kind === 'relative' && sensorQuality < 2) {
          sensorQuality = 1;
          renderRelative(latest);
        }
      });
    };
    window.addEventListener('deviceorientationabsolute', compassHandler, true);
    window.addEventListener('deviceorientation', compassHandler, true);
    sensorTimer = setTimeout(() => {
      if (sensorReceived) return;
      if (status)
        status.textContent = `No absolute compass data received. Try rotating the phone once or enable Motion & Orientation access in browser settings. Qibla: ${qiblaBearing.toFixed(1)}° from north.`;
      if (badge) badge.textContent = 'Waiting for compass permission/data';
      if (text) text.textContent = 'Calculated Qibla bearing remains available';
      if (cal) cal.classList.remove('show');
    }, 8000);
  } catch (e) {
    if (status)
      status.textContent = `Compass access was not granted. Enable motion/orientation access and try again. Qibla: ${qiblaBearing.toFixed(1)}° from north.`;
    if (badge) badge.textContent = 'Compass permission unavailable';
    if (text) text.textContent = 'Calculated Qibla bearing remains available';
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  KAABA = { lat: 21.422487, lng: 39.826206 };
  compassHandler = null;
  qiblaBearing = null;
  prayerTimer = null;
  prayerData = null;
  lastCoords = null;
  prayerLocationWatchId = null;
  prayerReloading = false;
  prayerLoadPromise = null;
  prayerLoadKey = '';
  prayerLoadToken = 0;
  sensorTimer = null;
  sensorReceived = false;
  sensorQuality = 0;
  smoothedHeading = null;
  relativeBaseAlpha = null;
  relativeBaseRotation = null;
  compassRaf = null;
  pendingCompassUpdate = null;
  window.rudRenderPrayer = function () {
    stopCompass();
    stopPrayerClock();
    if (
      !featureShowPage(
        `<section class="rud-feature-page rud-prayer-page">${pageHead('Prayer', 'Prayer & Qibla', 'Stay oriented to every Salah with local prayer times, Qibla direction and clear daily prayer guidance.')}<div id="rudPrayerState" class="rud-status">Requesting precise location…</div><div class="rud-feature-grid" style="margin-top:18px"><section class="rud-feature-card"><span class="rud-card-kicker">Qibla Direction</span><div class="rud-qibla-wrap"><div class="rud-compass-shell"><div class="rud-compass"><div class="rud-compass-cardinals"><span class="e">E</span><span class="s">S</span><span class="w">W</span></div><div class="rud-qibla-arrow" id="rudQiblaArrow"><span class="rud-kaaba-marker" aria-hidden="true"></span></div><div class="rud-compass-center"></div></div></div><div class="rud-qibla-readout"><strong id="rudQiblaDegrees">—</strong><span id="rudQiblaText">Waiting for location</span></div><div class="rud-compass-status" id="rudCompassStatus">The live compass starts only after you enable sensor access.</div><div class="rud-calibration" id="rudCalibration">Move your phone in a figure-eight motion to improve compass accuracy.</div><div class="rud-sensor-badge" id="rudSensorBadge">Compass not started</div><button class="rud-mini-btn rud-compass-enable" id="rudEnableCompass" type="button">Enable Live Compass</button></div></section><section class="rud-feature-card"><span class="rud-card-kicker">Today’s Prayer Times</span><div class="rud-nearby-masjid-fresh" aria-label="Nearby Masjids"><div class="rud-nearby-masjid-fresh-head"><div><div class="rud-nearby-masjid-fresh-title">Nearby Masjids</div><p class="rud-nearby-masjid-fresh-copy">Find mosques around your current location instantly.</p></div><button id="rudNearbyMasjidBtn" class="rud-nearby-masjid-fresh-btn" type="button" aria-label="Open Rise Upon Deen Map and find nearby masjids"><span class="map-pin" aria-hidden="true">⌖</span><span>Find Nearby</span></button></div><div class="rud-nearby-masjid-fresh-foot">Lists masjids near you from the free OpenStreetMap directory, with directions.</div></div><div id="rudPrayerDate" class="rud-status" style="margin-top:10px">Waiting for location…</div><div id="rudNextPrayer" class="rud-next-prayer rud-hidden"></div><div id="rudPrayerTimes" class="rud-prayer-list"></div><div id="rudPrayerMethod" class="rud-method-note"></div></section></div></section>`,
        'Prayer & Qibla | Rise Upon Deen',
      )
    )
      return;
    const masjidBtn = document.getElementById('rudNearbyMasjidBtn');
    if (masjidBtn) {
      /* Opens the in-app Nearby Masjids finder (features/prayer/NearbyMasjids.tsx). V1 called a
         window.rudOpenRiseUponDeenMap that no longer existed, so it always fell back to a redirect. */
      masjidBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNearbyMasjids();
      };
    }
    setFeatureHash('#prayer');
    setTimeout(initPrayer, 0);
  };
  window.rudRefreshPrayerCacheIfStale = async function () {
    if (window.rudResolvedPrayerSchedule?.() || !navigator.onLine) return false;
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(window.RUD_PRAYER_RESOLVED_KEY || 'rud_prayer_resolved_v1') || 'null');
    } catch {}
    const lat = Number(raw?.lat),
      lng = Number(raw?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return loadPrayerTimes(lat, lng);
  };
  /* Prayer page buttons (this delegated handler previously lived in the Hajj & Umrah guide script). */
  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest('#rudEnableCompass')) {
        e.preventDefault();
        enableCompass();
        return;
      }
      if (e.target.closest('#rudPrayerRetry')) {
        e.preventDefault();
        const b = e.target.closest('#rudPrayerRetry');
        b.disabled = true;
        loadPrayerTimes(lastCoords?.lat, lastCoords?.lng).finally(() => {
          b.disabled = false;
        });
        return;
      }
    },
    true,
  );
}

/** The coordinates the Prayer page last resolved (used by Nearby Masjids). @returns {{ lat: number, lng: number } | null} */
function getLastCoords() {
  return lastCoords || null;
}

export { enableCompass, getLastCoords, lastCoords, loadPrayerTimes, stopCompass, stopPrayerClock };
