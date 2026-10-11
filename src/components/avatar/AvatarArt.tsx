/* Draws a built avatar from its configuration. Shared SVG parts, no images, no faces (V3.5 figures redrawn).
   Figures are abstract silhouettes: the head is a plain, featureless shape.
   V3.1: premium rendering — soft gradient backdrops with a top glow, shaded clothing with fold
   highlights, a metallic accent frame with an inner hairline and a gentle gloss. Still pure SVG,
   drawn at render time from ~150 bytes of stored configuration. */
import { useId } from 'react';
import type { AvatarConfig } from '../../features/deen-friends/types';
import { ACCENTS, BACKGROUNDS, OUTFITS, isDarkBackground } from './avatarConfig';

const SHAPES: Record<AvatarConfig['shape'], string> = {
  circle: 'M36 0a36 36 0 1 1 0 72A36 36 0 0 1 36 0Z',
  arch: 'M6 72V30C6 13.4 19.4 0 36 0s30 13.4 30 30v42Z',
  octagon: 'M21.1 0h29.8L72 21.1v29.8L50.9 72H21.1L0 50.9V21.1Z',
  star: 'M36 0l10.5 10.6H61.4v14.9L72 36 61.4 46.5v14.9H46.5L36 72 25.5 61.4H10.6V46.5L0 36l10.6-10.5V10.6h14.9Z',
};

/** Mixes a #rrggbb colour toward white (t > 0) or black (t < 0). */
function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t)));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function Pattern({ kind, color }: { kind: AvatarConfig['pattern']; color: string }) {
  if (kind === 'none') return null;
  const o = 0.16;
  if (kind === 'stars')
    return (
      <g fill={color} opacity={o + 0.08}>
        {[
          [12, 14, 2.2],
          [58, 10, 1.6],
          [62, 30, 2],
          [10, 40, 1.5],
          [24, 6, 1.2],
          [50, 22, 1.1],
          [66, 50, 1.2],
        ].map(([x, y, r], i) => (
          <path key={i} d={`M${x} ${y - r * 2}l${r * 0.6} ${r * 1.4} ${r * 1.4} ${r * 0.6}-${r * 1.4} ${r * 0.6}-${r * 0.6} ${r * 1.4}-${r * 0.6}-${r * 1.4}-${r * 1.4}-${r * 0.6} ${r * 1.4}-${r * 0.6}Z`} />
        ))}
      </g>
    );
  if (kind === 'dots')
    return (
      <g fill={color} opacity={o}>
        {Array.from({ length: 36 }, (_, i) => (
          <circle key={i} cx={6 + (i % 6) * 12} cy={6 + Math.floor(i / 6) * 12} r={1.2} />
        ))}
      </g>
    );
  if (kind === 'arches')
    return (
      <g fill="none" stroke={color} strokeWidth="1" opacity={o + 0.04}>
        {[4, 22, 40, 58].map((x) => (
          <path key={x} d={`M${x} 72V52a7 7 0 0 1 14 0v20`} />
        ))}
      </g>
    );
  if (kind === 'mashrabiya')
    return (
      <g fill="none" stroke={color} strokeWidth="0.7" opacity={o + 0.02}>
        {Array.from({ length: 16 }, (_, i) => {
          const x = (i % 4) * 18 + 9;
          const y = Math.floor(i / 4) * 18 + 9;
          return <path key={i} d={`M${x} ${y - 7}l7 7-7 7-7-7Z M${x} ${y - 3.5}l3.5 3.5-3.5 3.5-3.5-3.5Z`} />;
        })}
      </g>
    );
  if (kind === 'rays')
    return (
      <g fill={color} opacity={o - 0.04}>
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M36 -6 39 36 33 36Z" transform={`rotate(${i * 30} 36 30)`} />
        ))}
      </g>
    );
  return (
    <g fill="none" stroke={color} strokeWidth="0.9" opacity={o}>
      <path d="M0 18 18 0l18 18L54 0l18 18M0 54l18-18 18 18 18-18 18 18M18 0v72M54 0v72M0 36h72" />
    </g>
  );
}

function Motif({ kind, x, y, s, color, deep }: { kind: AvatarConfig['motif']; x: number; y: number; s: number; color: string; deep: string }) {
  if (kind === 'none') return null;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={color}>
      {kind === 'crescent' ? (
        <>
          <path d="M10 0a12 12 0 1 0 9.8 18.9A9.6 9.6 0 1 1 10 0Z" />
          <path d="M18.5 4.2l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z" />
        </>
      ) : null}
      {kind === 'lantern' ? (
        <>
          <path d="M8 0h6l-1 3H9Z" />
          <path d="M6 3h10l3 6v9H3V9Z" opacity=".95" />
          <path d="M8 8h6v8H8Z" fill="#FFF3CF" opacity=".85" />
          <path d="M5 19h12l-2 3H7Z" />
        </>
      ) : null}
      {kind === 'mosque' ? (
        <>
          <path d="M3 22V13c1.5-4 4.5-6 8-6s6.5 2 8 6v9Z" />
          <path d="M11 0l-2.5 5h5Z" />
          <path d="M0 9h2v13H0Zm20 0h2v13h-2Z" />
        </>
      ) : null}
      {kind === 'kaaba' ? (
        <>
          <path d="M2 6 11 2l9 4v14l-9 3-9-3Z" fill={deep} />
          <path d="M2 6 11 2l9 4-9 3Z" fill={deep} opacity=".75" />
          <path d="M2 9.6 11 12.6l9-3v1.8l-9 3-9-3Z" />
          <path d="M14.6 15.2h2.2v5h-2.2Z" />
        </>
      ) : null}
      {kind === 'book' ? (
        <>
          <path d="M0 4c4-2 7-1.5 10.5 1v15C7 17.5 4 17 0 19Z" />
          <path d="M22 4c-4-2-7-1.5-10.5 1v15c3.5-2.5 6.5-3 10.5-1Z" opacity=".85" />
        </>
      ) : null}
      {kind === 'tasbih' ? (
        <>
          {Array.from({ length: 11 }, (_, i) => {
            const a = (i / 11) * Math.PI * 2;
            return <circle key={i} cx={11 + Math.cos(a) * 8} cy={10 + Math.sin(a) * 8} r={1.7} />;
          })}
          <path d="M10 18h2v5h-2Z" />
        </>
      ) : null}
      {kind === 'star' ? <path d="M11 0l3.2 6.4L22 7.8l-5.4 5 1.6 7.6L11 16.4 3.8 20.4l1.6-7.6L0 7.8l7.8-1.4Z" /> : null}
    </g>
  );
}

interface Paint {
  beard: string;
  cloth: string;
  clothHi: string;
  clothEdge: string;
  accent: string;
  accentDeep: string;
  wrap: string;
  head: string;
  line: string;
  fine: boolean; // false for tiny avatars: fold lines and embroidery are skipped
}

/* V3.5 figures — one consistent bust for every style: a faceless head with a warm skin tone (the same
   on light and dark backgrounds; it used to turn grey-green on dark ones), a neck, and shoulders.
   Brothers wear a thobe with a collar and placket; sisters' coverings frame the face and drape over
   the shoulders. No facial features are ever drawn. */
const HEAD = { cx: 36, cy: 31, rx: 9.2, ry: 11 };

function Head({ p }: { p: Paint }) {
  return (
    <>
      <path d="M32.4 38h7.2v10.5h-7.2Z" fill={p.head} />
      <ellipse cx="36" cy="44.8" rx="5" ry="2" fill="#000" opacity=".14" />
      <ellipse cx={HEAD.cx} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} fill={p.head} />
    </>
  );
}

/** A neat beard along the jaw line (the cheeks and face above stay clear). */
function Beard({ fill }: { fill: string }) {
  return <path d="M26.9 32.6c.4 7.6 4.2 12.6 9.1 12.6s8.7-5 9.1-12.6c-2.1 4-5.2 5.9-9.1 5.9s-7-1.9-9.1-5.9Z" fill={fill} />;
}

/** The thobe: shoulders, round collar, placket with two buttons. */
function Thobe({ p }: { p: Paint }) {
  return (
    <>
      <path d="M8 72v-5.6C8 55.6 18 49.2 30 47.8l6 4.4 6-4.4c12 1.4 22 7.8 22 18.6V72Z" fill={p.cloth} stroke={p.clothEdge} strokeWidth=".6" />
      <path d="M30 47.8c1.4 2.9 3.5 4.4 6 4.4s4.6-1.5 6-4.4" fill="none" stroke={p.clothHi} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M36 52.4V68" stroke={p.clothEdge} strokeWidth=".8" />
      <circle cx="36" cy="56.2" r=".95" fill={p.accent} />
      <circle cx="36" cy="60.6" r=".95" fill={p.accent} />
      {p.fine ? (
        <>
          <path d="M14 63c2.4-5.6 7-9.2 13-11" fill="none" stroke={p.clothHi} strokeWidth="1.3" strokeLinecap="round" opacity=".5" />
          <path d="M58 63c-2.4-5.6-7-9.2-13-11" fill="none" stroke={p.clothEdge} strokeWidth="1" strokeLinecap="round" opacity=".35" />
        </>
      ) : null}
    </>
  );
}

/** Sisters' covering: outer shape (drape over the shoulders) with the face opening drawn on top. */
function Covering({ p, d }: { p: Paint; d: string }) {
  return <path d={d} fill={p.cloth} stroke={p.clothEdge} strokeWidth=".6" />;
}
const HIJAB = 'M36 15c-10.2 0-15.5 8-15.5 17 0 5.2 1.7 9.5 4.5 12.5C16 47 9.5 54 8 64v8h56v-8c-1.5-10-8-17-17-19.5 2.8-3 4.5-7.3 4.5-12.5 0-9-5.3-17-15.5-17Z';
const KHIMAR = 'M36 14.5c-11 0-16.5 8.5-16.5 18 0 5 1.5 9.3 4 12.5C15 49.5 9 57 7 66l-1 6h60l-1-6c-2-9-8-16.5-16.5-21 2.5-3.2 4-7.5 4-12.5 0-9.5-5.5-18-16.5-18Z';

function Figure({ kind, p }: { kind: AvatarConfig['figure']; p: Paint }) {
  if (kind === 'none') return null;
  if (kind === 'kufi')
    return (
      <g>
        <Thobe p={p} />
        <Head p={p} />
        <Beard fill={p.beard} />
        <path d="M26.6 27.6c0-6.8 4.2-10.4 9.4-10.4s9.4 3.6 9.4 10.4Z" fill={p.wrap} stroke="#b9b1a2" strokeWidth=".5" />
        <path d="M26.5 26c3.5-1.2 15.5-1.2 19 0l.1 2.6c-3.6-1-15.6-1-19.2 0Z" fill={p.accentDeep} />
        {p.fine
          ? Array.from({ length: 7 }, (_, i) => <circle key={i} cx={28 + i * 2.67} cy={27.25} r=".42" fill={p.accent} />)
          : null}
        {p.fine ? <path d="M31 20c1.4-1.2 3.1-1.8 5-1.8" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth=".9" strokeLinecap="round" /> : null}
      </g>
    );
  if (kind === 'ghutra')
    return (
      <g>
        <Thobe p={p} />
        <Head p={p} />
        <Beard fill={p.beard} />
        <path
          d="M36 16.5c-8.5 0-13 6-13 14L22 52c-2 3-5 5.5-8.5 7.5L20 61c5-3 7.5-7 8.5-12V33c0-6.5 3-9.8 7.5-9.8s7.5 3.3 7.5 9.8v16c1 5 3.5 9 8.5 12l6.5-1.5c-3.5-2-6.5-4.5-8.5-7.5L49 30.5c0-8-4.5-14-13-14Z"
          fill={p.wrap}
          stroke="#b9b1a2"
          strokeWidth=".5"
        />
        {p.fine ? <path d="M28.5 33v16M43.5 33v16" stroke={p.accent} strokeWidth=".7" opacity=".7" /> : null}
        {/* Agal: two black cords resting on the ghutra (front half only, so they sit on the cloth). */}
        <path d="M25.6 22.6c2.4 2.4 6.2 3.4 10.4 3.4s8-1 10.4-3.4" fill="none" stroke="#1b1b20" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M25 25.4c2.6 2.2 6.4 3.2 11 3.2s8.4-1 11-3.2" fill="none" stroke="#1b1b20" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M25.6 22.6c2.4-2.2 6.2-3.2 10.4-3.2s8 1 10.4 3.2" fill="none" stroke="#1b1b20" strokeWidth="1.2" opacity=".55" />
      </g>
    );
  if (kind === 'turban')
    return (
      <g>
        <path d="M44.4 27.4c2 4.4 2.8 9.2 2.4 14.4l3.4-.6c.4-5.6-.8-10.6-3.6-15.2Z" fill={p.wrap} stroke="#b9b1a2" strokeWidth=".4" />
        <Thobe p={p} />
        <Head p={p} />
        <Beard fill={p.beard} />
        <path d="M25.4 29.4c0-8.6 4.6-13.4 10.6-13.4s10.6 4.8 10.6 13.4c-3-2-6.6-2.9-10.6-2.9s-7.6.9-10.6 2.9Z" fill={p.wrap} stroke="#b9b1a2" strokeWidth=".5" />
        <path d="M26 27.7c5.4-2.8 14.6-2.8 20.2.2l-.2 1.5c-5.6-2.8-14.4-2.8-19.8-.2Z" fill={p.accent} />
        {p.fine ? (
          <path d="M26.4 24.6c4.4-2.6 13-3.2 19.4.6M28.4 20.4c3.6-1.8 9.8-2 14.6.4" fill="none" stroke="#b9b1a2" strokeWidth=".75" />
        ) : null}
      </g>
    );
  if (kind === 'hijab')
    return (
      <g>
        <Covering p={p} d={HIJAB} />
        <ellipse cx="36" cy="32" rx="8" ry="10" fill={p.head} />
        <path d="M27.6 28.4c.9-4.6 4.2-7 8.4-7s7.5 2.4 8.4 7" fill="none" stroke={p.accent} strokeWidth="1" />
        {p.fine ? (
          <>
            <path d="M27 45c3 3 6 4.2 9 4.2s6-1.2 9-4.2" fill="none" stroke={p.clothHi} strokeWidth="1" opacity=".55" />
            <path d="M14 62c3-6.6 8-10.6 14-12.4M58 62c-3-6.6-8-10.6-14-12.4" fill="none" stroke={p.clothHi} strokeWidth="1.2" strokeLinecap="round" opacity=".4" />
            <path d="M24.5 22.5c2.6-4.4 6.6-6.6 11.5-6.6" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" strokeLinecap="round" />
          </>
        ) : null}
        <circle cx="45.2" cy="41.4" r="1.25" fill={p.accent} />
      </g>
    );
  if (kind === 'niqab')
    return (
      <g>
        <Covering p={p} d={HIJAB} />
        <path d="M28 29.4c3-1.3 13-1.3 16 0 .6 1.2.4 2.4-.4 3.2-3 .9-12.2.9-15.2 0-.8-.8-1-2-.4-3.2Z" fill={p.head} />
        <path d="M27.6 27.6c.9-4.2 4.2-6.4 8.4-6.4s7.5 2.2 8.4 6.4" fill="none" stroke={p.accent} strokeWidth="1" />
        {p.fine ? (
          <>
            <path d="M28.6 37.6c2.6 1 12.2 1 14.8 0M29.6 41.6c2.4.8 10.4.8 12.8 0" fill="none" stroke={p.clothHi} strokeWidth=".8" opacity=".45" />
            <path d="M14 62c3-6.6 8-10.6 14-12.4M58 62c-3-6.6-8-10.6-14-12.4" fill="none" stroke={p.clothHi} strokeWidth="1.2" strokeLinecap="round" opacity=".4" />
          </>
        ) : null}
      </g>
    );
  // Khimar: a long covering that drapes over the shoulders like a cape (sisters).
  return (
    <g>
      <Covering p={p} d={KHIMAR} />
      <ellipse cx="36" cy="32.4" rx="8" ry="10" fill={p.head} />
      <path d="M27.6 28.8c.9-4.6 4.2-7 8.4-7s7.5 2.4 8.4 7" fill="none" stroke={p.accent} strokeWidth="1" />
      <path d="M12 71c6.4-8 14-12.2 24-12.2S53.6 63 60 71" fill="none" stroke={p.accent} strokeWidth="1" opacity=".75" />
      {p.fine ? (
        <path d="M26 46.4c3.2 3.2 6.4 4.6 10 4.6s6.8-1.4 10-4.6M18 60c2.6-4.4 6-7.4 10-9M54 60c-2.6-4.4-6-7.4-10-9" fill="none" stroke={p.clothHi} strokeWidth="1" opacity=".45" />
      ) : null}
    </g>
  );
}

export function AvatarArt({ config, name = '', size = 44 }: { config: AvatarConfig; name?: string; size?: number }) {
  const id = useId().replace(/:/g, '');
  const bg = BACKGROUNDS[config.background] || BACKGROUNDS.cream;
  const outfit = OUTFITS[config.outfit] || OUTFITS.emerald;
  const accent = ACCENTS[config.accent] || ACCENTS.gold;
  const dark = isDarkBackground(config.background);
  const patternColor = dark ? '#F3E7C7' : '#6B5326';
  const initials = config.initials
    ? String(name || '')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p.charAt(0))
        .join('')
        .toUpperCase()
    : '';
  const motifOnly = config.figure === 'none';
  const small = size < 40; // tiny avatars skip the fine detail layers
  const paint: Paint = {
    beard: `url(#bd-${id})`,
    cloth: `url(#cl-${id})`,
    clothHi: shade(outfit, 0.38),
    clothEdge: shade(outfit, -0.4),
    accent: `url(#ac-${id})`,
    accentDeep: shade(accent, -0.25),
    wrap: `url(#wr-${id})`,
    head: `url(#hd-${id})`,
    line: dark ? '#000' : '#2a2014',
    fine: !small,
  };
  return (
    <svg viewBox="0 0 72 72" width={size} height={size} role="presentation" aria-hidden="true">
      <defs>
        <clipPath id={`av-${id}`}>
          <path d={SHAPES[config.shape]} />
        </clipPath>
        <linearGradient id={`bg-${id}`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={shade(bg, dark ? 0.12 : 0.35)} />
          <stop offset="1" stopColor={shade(bg, dark ? -0.35 : -0.1)} />
        </linearGradient>
        <radialGradient id={`gl-${id}`} cx="0.5" cy="0.18" r="0.62">
          <stop offset="0" stopColor={dark ? '#F6DC94' : '#FFFFFF'} stopOpacity={dark ? 0.28 : 0.55} />
          <stop offset="1" stopColor={dark ? '#F6DC94' : '#FFFFFF'} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`cl-${id}`} x1="0.1" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={shade(outfit, 0.18)} />
          <stop offset="1" stopColor={shade(outfit, -0.28)} />
        </linearGradient>
        <linearGradient id={`ac-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(accent, 0.45)} />
          <stop offset="0.5" stopColor={accent} />
          <stop offset="1" stopColor={shade(accent, -0.3)} />
        </linearGradient>
        <linearGradient id={`bd-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a3a2c" />
          <stop offset="1" stopColor="#241b14" />
        </linearGradient>
        <radialGradient id={`hd-${id}`} cx="0.4" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#F2D9BE" />
          <stop offset="1" stopColor="#CFA683" />
        </radialGradient>
        {/* Head wraps (kufi, ghutra, imamah): ivory-white cloth; the accent colour is used for bands and trim. */}
        <linearGradient id={`wr-${id}`} x1="0.1" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#FBF8F2" />
          <stop offset="1" stopColor="#D9D2C4" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#av-${id})`}>
        <rect width="72" height="72" fill={`url(#bg-${id})`} />
        <rect width="72" height="72" fill={`url(#gl-${id})`} />
        {small ? null : <Pattern kind={config.pattern} color={patternColor} />}
        <Figure kind={config.figure} p={paint} />
        {motifOnly ? (
          <Motif kind={config.motif === 'none' ? 'crescent' : config.motif} x={22} y={20} s={1.3} color={`url(#ac-${id})`} deep={dark ? '#0b0b0d' : '#1d1d22'} />
        ) : (
          <Motif kind={config.motif} x={52} y={8} s={0.62} color={`url(#ac-${id})`} deep={dark ? '#0b0b0d' : '#1d1d22'} />
        )}
        {small ? null : <ellipse cx="24" cy="10" rx="26" ry="12" fill="#fff" opacity={dark ? 0.06 : 0.14} />}
        {initials ? (
          <>
            <rect x="20" y="56" width="32" height="12" rx="6" fill={dark ? '#F3E7C7' : '#1C2621'} opacity=".85" />
            <text x="36" y="65" textAnchor="middle" fontSize="8" fontWeight="800" fontFamily="Manrope, system-ui, sans-serif" fill={dark ? '#1C2621' : '#F7F1E3'}>
              {initials}
            </text>
          </>
        ) : null}
      </g>
      <path d={SHAPES[config.shape]} fill="none" stroke={`url(#ac-${id})`} strokeWidth="2.2" />
      {small ? null : (
        <path d={SHAPES[config.shape]} fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth=".6" transform="translate(3.6 3.6) scale(.9)" />
      )}
    </svg>
  );
}
