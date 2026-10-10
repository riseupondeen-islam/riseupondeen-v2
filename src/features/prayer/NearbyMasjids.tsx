/* Nearby Masjids — the in-app finder behind the Prayer page's "Find Nearby" button.
 *
 * ROOT CAUSE OF THE BROKEN BUTTON: the button calls window.rudOpenRiseUponDeenMap(), but that
 * function (the "Rise map" overlay, whose styles still exist as .rud-free-map-*) was lost when the
 * single-file app was split into modules. Every tap therefore fell through to a raw Google Maps
 * redirect, which also navigated an installed PWA away from the app.
 *
 * This restores the overlay with the existing styles and the page's existing location flow:
 *  - location: the coordinates the Prayer page already resolved, else one geolocation request;
 *  - masjids: the free OpenStreetMap Overpass API (no key, no billing), nearest first;
 *  - directions: opens the device's maps app for the chosen masjid in a new tab/window;
 *  - denied / unavailable location or no network: clear options, the page keeps working. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getLastCoords } from './prayerQibla';

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

const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

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

async function searchOverpass(lat: number, lng: number, radiusM: number, signal: AbortSignal): Promise<Masjid[]> {
  const around = `(around:${radiusM},${lat.toFixed(5)},${lng.toFixed(5)})`;
  const q = `[out:json][timeout:20];(nwr["amenity"="place_of_worship"]["religion"="muslim"]${around};);out center 60;`;
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: q }),
        signal,
      });
      if (!response.ok) throw new Error(`Overpass ${response.status}`);
      const json = (await response.json()) as { elements?: OverpassElement[] };
      return (json.elements || [])
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
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('Overpass unavailable');
}

function directionsUrl(lat: number, lng: number, name: string): string {
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  return isApple
    ? `https://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function mapSearchUrl(lat?: number, lng?: number): string {
  return typeof lat === 'number' && typeof lng === 'number'
    ? `https://www.google.com/maps/search/masjid/@${lat},${lng},14z`
    : 'https://www.google.com/maps/search/?api=1&query=masjid%20near%20me';
}

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
    setStatus({ kind: 'searching', lat, lng });
    try {
      let radiusKm = 3;
      let masjids = await searchOverpass(lat, lng, radiusKm * 1000, signal);
      if (masjids.length < 3) {
        radiusKm = 10;
        masjids = await searchOverpass(lat, lng, radiusKm * 1000, signal);
      }
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
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
    return () => controller.abort();
  }, [search, attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('rud-masjid-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('rud-masjid-open');
    };
  }, [onClose]);

  const shown = useMemo(() => {
    if (status.kind !== 'results') return [];
    const q = filter.trim().toLowerCase();
    return status.masjids.filter((m) => !q || `${m.name} ${m.address}`.toLowerCase().includes(q)).slice(0, 30);
  }, [status, filter]);

  const coords = 'lat' in status ? { lat: status.lat, lng: status.lng } : null;

  return (
    <div id="rudRiseMapOverlay" className="open" role="dialog" aria-modal="true" aria-label="Nearby masjids">
      <div className="rud-free-map-shell">
        <div className="rud-free-map-head">
          <button type="button" className="rud-free-map-back" onClick={onClose} aria-label="Close nearby masjids">
            ‹
          </button>
          <label className="rud-free-map-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter masjids by name"
              aria-label="Filter masjids by name"
            />
          </label>
          <span className="rud-free-map-pill">
            <i />
            NEARBY MASJIDS
          </span>
        </div>
        <div className="rud-free-map-main rud-masjid-main">
          {status.kind === 'results' && status.masjids.length ? (
            <div className="rud-masjid-results">
              <p className="rud-masjid-summary">
                {status.masjids.length} masjid{status.masjids.length === 1 ? '' : 's'} within {status.radiusKm} km ·
                nearest first
              </p>
              <ul className="rud-masjid-list">
                {shown.map((m) => (
                  <li key={m.id} className="rud-masjid-item">
                    <span className="rud-masjid-copy">
                      <strong>{m.name}</strong>
                      <small>
                        {m.distanceKm < 1 ? `${Math.round(m.distanceKm * 1000)} m` : `${m.distanceKm.toFixed(1)} km`}
                        {m.address ? ` · ${m.address}` : ''}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="rud-free-map-action primary"
                      onClick={() => openExternal(directionsUrl(m.lat, m.lng, m.name))}
                    >
                      Directions
                    </button>
                  </li>
                ))}
              </ul>
              {!shown.length ? <p className="rud-masjid-summary">No masjid matches that name.</p> : null}
            </div>
          ) : (
            <div className="rud-free-map-card">
              <div className="rud-free-map-icon" aria-hidden="true">
                🕌
              </div>
              {status.kind === 'locating' ? (
                <>
                  <h2>Finding your location…</h2>
                  <p>Allow location access when your browser asks, so we can list masjids near you.</p>
                </>
              ) : null}
              {status.kind === 'searching' ? (
                <>
                  <h2>Looking for nearby masjids…</h2>
                  <p>Searching around your current location.</p>
                </>
              ) : null}
              {status.kind === 'denied' ? (
                <>
                  <h2>Location access is off</h2>
                  <p>
                    To list masjids near you, allow location for this site in your browser or phone settings, then try
                    again. You can also search the map yourself.
                  </p>
                </>
              ) : null}
              {status.kind === 'no-location' ? (
                <>
                  <h2>Location unavailable</h2>
                  <p>{status.message} Check that location services are on, then try again.</p>
                </>
              ) : null}
              {status.kind === 'error' ? (
                <>
                  <h2>Masjid search is unavailable</h2>
                  <p>
                    The free masjid directory could not be reached. Check your connection and try again, or open the map
                    search.
                  </p>
                </>
              ) : null}
              {status.kind === 'results' ? (
                <>
                  <h2>No masjids found nearby</h2>
                  <p>
                    Nothing is listed within {status.radiusKm} km in the free OpenStreetMap directory. Try the map
                    search instead.
                  </p>
                </>
              ) : null}
              {coords ? (
                <div className="rud-free-map-location">
                  <span className="rud-free-map-dot" />
                  {coords.lat.toFixed(3)}, {coords.lng.toFixed(3)}
                </div>
              ) : null}
              {status.kind !== 'locating' && status.kind !== 'searching' ? (
                <div className="rud-free-map-actions">
                  <button
                    type="button"
                    className="rud-free-map-action primary"
                    onClick={() => setAttempt((a) => a + 1)}
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    className="rud-free-map-action secondary"
                    onClick={() => openExternal(mapSearchUrl(coords?.lat, coords?.lng))}
                  >
                    Open map search
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="rud-free-map-bottom">
          <span>
            Masjid data © <strong>OpenStreetMap</strong> contributors · free directory, may be incomplete
          </span>
          <button type="button" className="rud-free-map-close-link" onClick={onClose}>
            Close
          </button>
        </div>
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
