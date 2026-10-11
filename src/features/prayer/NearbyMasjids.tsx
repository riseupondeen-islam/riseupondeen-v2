/* Nearby Masjids — the in-app finder behind the Prayer page's "Find Nearby" button.
 *
 * ROOT CAUSE OF THE BROKEN BUTTON: the button calls window.rudOpenRiseUponDeenMap(), but that
 * function (the "Rise map" overlay, whose styles still exist as .rud-free-map-*) was lost when the
 * single-file app was split into modules. Every tap therefore fell through to a raw Google Maps
 * redirect, which also navigated an installed PWA away from the app.
 *
 * This restores the overlay with the existing styles and the page's existing location flow:
 *  - location: the coordinates the Prayer page already resolved, else one geolocation request;
 *  - masjids: the free OpenStreetMap Overpass API (no key, no billing), nearest first — hedged across
 *    mirrors with time limits and a short in-memory cache (see below);
 *  - directions: opens the device's maps app for the chosen masjid in a new tab/window;
 *  - denied / unavailable location or no network: clear options, the page keeps working. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getLastCoords } from './prayerQibla';
import { lockPageScroll } from '../../services/ui/scrollLock';

interface Masjid {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distanceKm: number;
  address: string;
}

type Status =
  | { kind: 'locating' }
  | { kind: 'denied' }
  | { kind: 'no-location'; message: string }
  | { kind: 'searching'; lat: number; lng: number }
  | { kind: 'results'; lat: number; lng: number; masjids: Masjid[]; radiusKm: number }
  | { kind: 'error'; lat: number; lng: number };

/* Free OpenStreetMap Overpass mirrors (no key, no billing). V3.5 reliability: the public servers are
 * often overloaded, and a slow one used to keep the spinner going for 20–60 s before the next was
 * tried. Now the next mirror starts if the current one has not answered within HEDGE_MS (or at once
 * if it fails), the first good answer wins and the others are cancelled, and the whole search gives
 * up after TOTAL_MS with a "Try again" state. */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const HEDGE_MS = 2500;
const TOTAL_MS = 12000;
/* Results are reused for 15 minutes for the same ~1 km area — in memory only, so the visitor's
 * location is never written to the device. */
const CACHE_MS = 15 * 60 * 1000;
const resultCache = new Map<string, { at: number; masjids: Masjid[]; radiusKm: number }>();
const cacheKey = (lat: number, lng: number) => `${lat.toFixed(2)},${lng.toFixed(2)}`;

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

interface OverpassElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** One mirror. A 200 answer whose `remark` reports a server-side timeout or error is a failure —
 *  previously it looked like "no masjids nearby". */
async function queryMirror(endpoint: string, q: string, signal: AbortSignal): Promise<OverpassElement[]> {
  const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ data: q }), signal });
  if (!response.ok) throw new Error(`Overpass ${response.status}`);
  const json = (await response.json()) as { elements?: OverpassElement[]; remark?: string };
  if (json.remark && /error|time(d)? ?out|timeout|rate limit|too many/i.test(json.remark)) throw new Error('Overpass: incomplete answer');
  if (!Array.isArray(json.elements)) throw new Error('Overpass: malformed answer');
  return json.elements;
}

/** Hedged request across the mirrors (see HEDGE_MS / TOTAL_MS). Rejects with AbortError when the
 *  caller cancels; every in-flight request is cancelled once a result is settled. */
function hedgedQuery(q: string, signal: AbortSignal): Promise<OverpassElement[]> {
  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = [];
    let next = 0;
    let failed = 0;
    let done = false;
    let hedgeTimer = 0;
    let lastError: unknown = null;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer);
      clearTimeout(totalTimer);
      signal.removeEventListener('abort', onAbort);
      controllers.forEach((c) => c.abort());
      settle();
    };
    const launch = () => {
      if (done || next >= OVERPASS_ENDPOINTS.length) return;
      clearTimeout(hedgeTimer);
      const controller = new AbortController();
      controllers.push(controller);
      const endpoint = OVERPASS_ENDPOINTS[next++];
      queryMirror(endpoint, q, controller.signal).then(
        (elements) => finish(() => resolve(elements)),
        (error) => {
          if (done) return;
          lastError = error;
          failed++;
          if (failed >= OVERPASS_ENDPOINTS.length) finish(() => reject(lastError));
          else launch(); // a failed mirror hands over at once
        },
      );
      if (next < OVERPASS_ENDPOINTS.length) hedgeTimer = window.setTimeout(launch, HEDGE_MS);
    };
    const onAbort = () => finish(() => reject(new DOMException('Cancelled', 'AbortError')));
    const totalTimer = window.setTimeout(() => finish(() => reject(lastError || new Error('Overpass: no answer in time'))), TOTAL_MS);
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    launch();
  });
}

async function searchOverpass(lat: number, lng: number, radiusM: number, signal: AbortSignal): Promise<Masjid[]> {
  const around = `(around:${radiusM},${lat.toFixed(5)},${lng.toFixed(5)})`;
  const q = `[out:json][timeout:10];(nwr["amenity"="place_of_worship"]["religion"="muslim"]${around};);out center 60;`;
  const elements = await hedgedQuery(q, signal);
  return elements
    .map((el) => {
      const pLat = el.lat ?? el.center?.lat;
      const pLng = el.lon ?? el.center?.lon;
      if (typeof pLat !== 'number' || typeof pLng !== 'number') return null;
      const tags = el.tags || {};
      const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'] || tags['addr:suburb']]
        .filter(Boolean)
        .join(' ');
      return {
        id: `${el.type}/${el.id}`,
        name: tags['name:en'] || tags.name || 'Masjid',
        lat: pLat,
        lng: pLng,
        distanceKm: distanceKm(lat, lng, pLat, pLng),
        address,
      };
    })
    .filter((m): m is Masjid => !!m)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function directionsUrl(lat: number, lng: number, name: string): string {
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  return isApple
    ? `https://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** Google Maps searching "masjids near me" (opens the Maps app on phones; it uses the device's own
 *  location, so it works even when this site has no location permission). */
function mapSearchUrl(): string {
  return 'https://www.google.com/maps/search/?api=1&query=masjids%20near%20me';
}

function distanceLabel(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/** Walking time at ~5 km/h, shown for nearby places. */
function walkLabel(km: number): string {
  const min = Math.max(1, Math.round((km / 5) * 60));
  return min <= 45 ? `${min} min walk` : '';
}

const DomeIcon = ({ size = 26 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20V12.5c1.6-3.8 4.6-5.9 8-5.9s6.4 2.1 8 5.9V20Z" />
    <path d="M12 2.6v2.4M2.5 20h19M9.6 20v-4a2.4 2.4 0 0 1 4.8 0v4" />
  </svg>
);
const PinIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </svg>
);
const RouteIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11.5 21 3l-8.5 18-2-7.5Z" />
  </svg>
);

function openExternal(url: string) {
  // A new tab/window keeps the installed app (and its state) open behind the map.
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.assign(url);
}

function NearbyMasjidsOverlay({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: 'locating' });
  const [filter, setFilter] = useState('');
  const [attempt, setAttempt] = useState(0);

  const search = useCallback(async (lat: number, lng: number, signal: AbortSignal) => {
    const key = cacheKey(lat, lng);
    const hit = resultCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setStatus({ kind: 'results', lat, lng, masjids: hit.masjids, radiusKm: hit.radiusKm });
      return;
    }
    setStatus({ kind: 'searching', lat, lng });
    try {
      let radiusKm = 3;
      let masjids = await searchOverpass(lat, lng, radiusKm * 1000, signal);
      if (masjids.length < 3) {
        radiusKm = 10;
        masjids = await searchOverpass(lat, lng, radiusKm * 1000, signal);
      }
      if (signal.aborted) return;
      resultCache.set(key, { at: Date.now(), masjids, radiusKm });
      setStatus({ kind: 'results', lat, lng, masjids, radiusKm });
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') setStatus({ kind: 'error', lat, lng });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const known = getLastCoords();
    if (known && Number.isFinite(known.lat) && Number.isFinite(known.lng)) {
      void search(Number(known.lat), Number(known.lng), controller.signal);
      return () => controller.abort();
    }
    if (!('geolocation' in navigator)) {
      setStatus({ kind: 'no-location', message: 'This browser cannot share your location.' });
      return () => controller.abort();
    }
    setStatus({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!controller.signal.aborted) void search(pos.coords.latitude, pos.coords.longitude, controller.signal);
      },
      (err) => {
        if (controller.signal.aborted) return;
        if (err.code === err.PERMISSION_DENIED) setStatus({ kind: 'denied' });
        else setStatus({ kind: 'no-location', message: 'Your location could not be found right now.' });
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
    );
    return () => controller.abort();
  }, [search, attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('rud-masjid-open');
    const release = lockPageScroll();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('rud-masjid-open');
      release();
    };
  }, [onClose]);

  const shown = useMemo(() => {
    if (status.kind !== 'results') return [];
    const q = filter.trim().toLowerCase();
    return status.masjids.filter((m) => !q || `${m.name} ${m.address}`.toLowerCase().includes(q)).slice(0, 30);
  }, [status, filter]);

  const coords = 'lat' in status ? { lat: status.lat, lng: status.lng } : null;

  const busy = status.kind === 'locating' || status.kind === 'searching';
  return (
    <div id="rudRiseMapOverlay" className="open rud-mq" role="dialog" aria-modal="true" aria-label="Nearby masjids">
      <div className="rud-mq-shell">
        <header className="rud-mq-head">
          <button type="button" className="rud-mq-icon-btn" onClick={onClose} aria-label="Close nearby masjids">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 5-7 7 7 7" />
            </svg>
          </button>
          <div className="rud-mq-title">
            <span className="rud-mq-kicker">NEARBY</span>
            <h2>Masjids near you</h2>
          </div>
          <button type="button" className="rud-mq-maps" onClick={() => openExternal(mapSearchUrl())} aria-label="Search masjids near me in Google Maps">
            <PinIcon />
            <span>Google Maps</span>
          </button>
        </header>

        {status.kind === 'results' && status.masjids.length ? (
          <label className="rud-mq-search">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name" aria-label="Filter masjids by name" />
          </label>
        ) : null}

        <div className="rud-mq-body rud-masjid-main">
          {busy ? (
            <div className="rud-mq-loading" aria-live="polite">
              <p className="rud-mq-summary">{status.kind === 'locating' ? 'Finding your location…' : 'Looking for masjids around you…'}</p>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rud-mq-skel" style={{ animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
          ) : status.kind === 'results' && status.masjids.length ? (
            <div className="rud-masjid-results">
              <p className="rud-mq-summary rud-masjid-summary">
                {status.masjids.length} masjid{status.masjids.length === 1 ? '' : 's'} within {status.radiusKm} km · nearest first
              </p>
              <ul className="rud-mq-list rud-masjid-list">
                {shown.map((m, i) => (
                  <li key={m.id} className="rud-mq-item rud-masjid-item" style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}>
                    <span className="rud-mq-badge" aria-hidden="true">
                      <DomeIcon size={20} />
                    </span>
                    <span className="rud-mq-copy rud-masjid-copy">
                      <strong>{m.name}</strong>
                      <small>
                        <b>{distanceLabel(m.distanceKm)}</b>
                        {walkLabel(m.distanceKm) ? ` · ${walkLabel(m.distanceKm)}` : ''}
                        {m.address ? ` · ${m.address}` : ''}
                      </small>
                    </span>
                    <button type="button" className="rud-mq-go" onClick={() => openExternal(directionsUrl(m.lat, m.lng, m.name))}>
                      <RouteIcon />
                      <span>Directions</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!shown.length ? <p className="rud-mq-summary">No masjid matches that name.</p> : null}
            </div>
          ) : (
            <div className="rud-mq-state">
              <span className="rud-mq-medallion">
                <DomeIcon />
              </span>
              {status.kind === 'denied' ? (
                <>
                  <h3>Location access is off</h3>
                  <p>Allow location for this site in your browser or phone settings, then try again — or search in Google Maps.</p>
                </>
              ) : null}
              {status.kind === 'no-location' ? (
                <>
                  <h3>Location unavailable</h3>
                  <p>{status.message} Check that location services are on, then try again.</p>
                </>
              ) : null}
              {status.kind === 'error' ? (
                <>
                  <h3>Masjid search is unavailable</h3>
                  <p>The free masjid directory could not be reached. Check your connection, or search in Google Maps.</p>
                </>
              ) : null}
              {status.kind === 'results' ? (
                <>
                  <h3>No masjids listed nearby</h3>
                  <p>Nothing is listed within {status.radiusKm} km in the free directory. Google Maps may know more.</p>
                </>
              ) : null}
              <div className="rud-mq-actions">
                <button type="button" className="rud-mq-btn is-primary" onClick={() => openExternal(mapSearchUrl())}>
                  Open map search
                </button>
                <button type="button" className="rud-mq-btn" onClick={() => setAttempt((a) => a + 1)}>
                  Try again
                </button>
              </div>
            </div>
          )}
        </div>
        <footer className="rud-mq-foot">
          {coords ? (
            <span className="rud-mq-loc">
              <i /> Near {coords.lat.toFixed(3)}, {coords.lng.toFixed(3)}
            </span>
          ) : (
            <span />
          )}
          <span>© OpenStreetMap contributors</span>
        </footer>
      </div>
    </div>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

export function closeNearbyMasjids(): void {
  window.removeEventListener('hashchange', closeNearbyMasjids);
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}

export function openNearbyMasjids(): void {
  closeNearbyMasjids();
  window.addEventListener('hashchange', closeNearbyMasjids, { once: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<NearbyMasjidsOverlay onClose={closeNearbyMasjids} />);
}
