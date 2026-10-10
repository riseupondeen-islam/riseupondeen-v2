/* Draws a built avatar from its configuration. Shared SVG parts, no images, no faces.
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
  cloth: string;
  clothHi: string;
  accent: string;
  head: string;
  line: string;
}

function Figure({ kind, p }: { kind: AvatarConfig['figure']; p: Paint }) {
  if (kind === 'none') return null;
  const shoulders = (
    <>
      <path d="M12 72v-6c0-11.5 10-18 24-18s24 6.5 24 18v6Z" fill={p.cloth} />
      <path d="M16 60c3-6 9-9.6 15-10.6" fill="none" stroke={p.clothHi} strokeWidth="1.6" strokeLinecap="round" opacity=".6" />
    </>
  );
  if (kind === 'hijab')
    return (
      <g>
        <path d="M36 13c-10.5 0-16.5 8.8-16.5 18.5 0 5 1.6 9.2 4 12.2-7.2 3-13.5 9.2-15.5 20.3v8h56v-8c-2-11.1-8.3-17.3-15.5-20.3 2.4-3 4-7.2 4-12.2C52.5 21.8 46.5 13 36 13Z" fill={p.cloth} />
        <path d="M24 22c3-5 7-7.6 12-7.6" fill="none" stroke={p.clothHi} strokeWidth="1.8" strokeLinecap="round" opacity=".55" />
        <ellipse cx="36" cy="33" rx="8.2" ry="10" fill={p.head} />
        <path d="M23 44.5c4 4 8.3 6 13 6s9-2 13-6" fill="none" stroke={p.accent} strokeWidth="1.5" opacity=".85" />
        <path d="M14 62c4-5 9-8 14-9.4" fill="none" stroke={p.clothHi} strokeWidth="1.4" strokeLinecap="round" opacity=".45" />
      </g>
    );
  if (kind === 'niqab')
    return (
      <g>
        <path d="M36 12c-11 0-17 9-17 19 0 5.5 1.8 10 4.5 13-7.5 3-14 9.5-16 20v8h57v-8c-2-10.5-8.5-17-16-20 2.7-3 4.5-7.5 4.5-13 0-10-6-19-17-19Z" fill={p.cloth} />
        <path d="M27.5 29.5h17a2.4 2.4 0 0 1 0 4.8h-17a2.4 2.4 0 0 1 0-4.8Z" fill={p.head} />
        <path d="M24 21c3-5 7-7.4 12-7.4" fill="none" stroke={p.clothHi} strokeWidth="1.8" strokeLinecap="round" opacity=".5" />
        <path d="M30 38.5c2 .8 4 1.2 6 1.2s4-.4 6-1.2" fill="none" stroke={p.line} strokeWidth=".8" opacity=".5" />
        <path d="M22.5 46c4 3.6 8.4 5.4 13.5 5.4s9.5-1.8 13.5-5.4" fill="none" stroke={p.accent} strokeWidth="1.4" opacity=".8" />
      </g>
    );
  if (kind === 'kufi')
    return (
      <g>
        {shoulders}
        <path d="M31 49l5 9 5-9" fill="none" stroke={p.accent} strokeWidth="1.4" opacity=".85" />
        <ellipse cx="36" cy="34" rx="10" ry="11.5" fill={p.head} />
        <path d="M26 30.5c0-6.5 4.5-10.5 10-10.5s10 4 10 10.5Z" fill={p.accent} />
        <path d="M27 27.5h18M28 24.5h16" stroke={p.line} strokeWidth="0.7" opacity=".35" />
      </g>
    );
  if (kind === 'ghutra')
    return (
      <g>
        {shoulders}
        <path d="M24 31c0-8 5.2-13.5 12-13.5S48 23 48 31v18c-3 2.5-7 3.5-12 3.5s-9-1-12-3.5Z" fill={p.clothHi} />
        <ellipse cx="36" cy="35" rx="8.6" ry="10.5" fill={p.head} />
        <path d="M24.6 25.8c3-3 7-4.6 11.4-4.6s8.4 1.6 11.4 4.6" fill="none" stroke={p.accent} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M24.6 28.6c3-2.6 7-4 11.4-4s8.4 1.4 11.4 4" fill="none" stroke={p.accent} strokeWidth="1.2" strokeLinecap="round" opacity=".7" />
      </g>
    );
  if (kind === 'turban')
    return (
      <g>
        {shoulders}
        <ellipse cx="36" cy="35" rx="10" ry="11.5" fill={p.head} />
        <path d="M24.5 31c0-8 5-13 11.5-13s11.5 5 11.5 13c-3-2-7-3-11.5-3s-8.5 1-11.5 3Z" fill={p.accent} />
        <path d="M26 25.5c4-2 13-2.5 20 1M25 29c5-2.5 15-2.5 22 .5" fill="none" stroke={p.line} strokeWidth="0.9" opacity=".35" />
      </g>
    );
  return (
    <g>
      {shoulders}
      <path d="M17 57c6-4 12-6 19-6s13 2 19 6l-6 15H23Z" fill={p.accent} opacity=".9" />
      <path d="M22 62c4-2.4 9-3.6 14-3.6" fill="none" stroke={p.line} strokeWidth=".8" opacity=".3" />
      <ellipse cx="36" cy="35" rx="10" ry="11.5" fill={p.head} />
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
  const paint: Paint = {
    cloth: `url(#cl-${id})`,
    clothHi: shade(outfit, 0.32),
    accent: `url(#ac-${id})`,
    head: `url(#hd-${id})`,
    line: dark ? '#000' : '#2a2014',
  };
  const small = size < 40; // tiny avatars skip the fine detail layers
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
        <radialGradient id={`hd-${id}`} cx="0.42" cy="0.35" r="0.7">
          <stop offset="0" stopColor={dark ? '#556660' : '#E9DDC6'} />
          <stop offset="1" stopColor={dark ? '#34433E' : '#CDBB9C'} />
        </radialGradient>
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
