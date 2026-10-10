/* Draws a built avatar from its configuration. Shared SVG parts, no images, no faces.
   Figures are abstract silhouettes: the head is a plain, featureless shape. */
import { useId } from 'react';
import type { AvatarConfig } from '../../features/deen-friends/types';
import { ACCENTS, BACKGROUNDS, OUTFITS, isDarkBackground } from './avatarConfig';

const SHAPES: Record<AvatarConfig['shape'], string> = {
  circle: 'M36 0a36 36 0 1 1 0 72A36 36 0 0 1 36 0Z',
  arch: 'M6 72V30C6 13.4 19.4 0 36 0s30 13.4 30 30v42Z',
  octagon: 'M21.1 0h29.8L72 21.1v29.8L50.9 72H21.1L0 50.9V21.1Z',
  star: 'M36 0l10.5 10.6H61.4v14.9L72 36 61.4 46.5v14.9H46.5L36 72 25.5 61.4H10.6V46.5L0 36l10.6-10.5V10.6h14.9Z',
};

function Pattern({ kind, color }: { kind: AvatarConfig['pattern']; color: string }) {
  if (kind === 'none') return null;
  const o = 0.16;
  if (kind === 'stars')
    return (
      <g fill={color} opacity={o + 0.06}>
        {[
          [12, 14, 2.2],
          [58, 10, 1.6],
          [62, 30, 2],
          [10, 40, 1.5],
          [24, 6, 1.2],
          [50, 22, 1.1],
        ].map(([x, y, r], i) => (
          <path key={i} d={`M${x} ${y - r * 2}l${r * 0.6} ${r * 1.4} ${r * 1.4} ${r * 0.6}-${r * 1.4} ${r * 0.6}-${r * 0.6} ${r * 1.4}-${r * 0.6}-${r * 1.4}-${r * 1.4}-${r * 0.6} ${r * 1.4}-${r * 0.6}Z`} />
        ))}
      </g>
    );
  if (kind === 'dots')
    return (
      <g fill={color} opacity={o}>
        {Array.from({ length: 36 }, (_, i) => (
          <circle key={i} cx={6 + (i % 6) * 12} cy={6 + Math.floor(i / 6) * 12} r={1.3} />
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
  return (
    <g fill="none" stroke={color} strokeWidth="0.9" opacity={o}>
      <path d="M0 18 18 0l18 18L54 0l18 18M0 54l18-18 18 18 18-18 18 18M18 0v72M54 0v72M0 36h72" />
    </g>
  );
}

function Motif({ kind, x, y, s, color }: { kind: AvatarConfig['motif']; x: number; y: number; s: number; color: string }) {
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
          <path d="M6 3h10l3 6v9H3V9Z" opacity=".9" />
          <path d="M8 8h6v8H8Z" fill="#FFF3CF" opacity=".8" />
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
      {kind === 'book' ? (
        <>
          <path d="M0 4c4-2 7-1.5 10.5 1v15C7 17.5 4 17 0 19Z" />
          <path d="M22 4c-4-2-7-1.5-10.5 1v15c3.5-2.5 6.5-3 10.5-1Z" opacity=".85" />
        </>
      ) : null}
      {kind === 'tasbih' ? (
        <>
          {Array.from({ length: 9 }, (_, i) => {
            const a = (i / 9) * Math.PI * 2;
            return <circle key={i} cx={11 + Math.cos(a) * 8} cy={10 + Math.sin(a) * 8} r={1.8} />;
          })}
          <path d="M10 18h2v5h-2Z" />
        </>
      ) : null}
    </g>
  );
}

function Figure({ kind, outfit, accent, head }: { kind: AvatarConfig['figure']; outfit: string; accent: string; head: string }) {
  if (kind === 'none') return null;
  if (kind === 'hijab')
    return (
      <g>
        <path d="M36 14c-10 0-16 8.5-16 18 0 5 1.6 9 4 12-7 3-13 9-15 20v8h54v-8c-2-11-8-17-15-20 2.4-3 4-7 4-12 0-9.5-6-18-16-18Z" fill={outfit} />
        <ellipse cx="36" cy="33" rx="8.2" ry="10" fill={head} />
        <path d="M23 44c4 4 8.3 6 13 6s9-2 13-6" fill="none" stroke={accent} strokeWidth="1.4" opacity=".75" />
      </g>
    );
  if (kind === 'kufi')
    return (
      <g>
        <path d="M14 72v-6c0-11 9-17 22-17s22 6 22 17v6Z" fill={outfit} />
        <path d="M31 49l5 9 5-9" fill="none" stroke={accent} strokeWidth="1.3" opacity=".8" />
        <ellipse cx="36" cy="34" rx="10" ry="11.5" fill={head} />
        <path d="M26 30.5c0-6.5 4.5-10.5 10-10.5s10 4 10 10.5Z" fill={accent} />
        <path d="M27 27.5h18" stroke={outfit} strokeWidth="0.9" opacity=".45" />
      </g>
    );
  if (kind === 'turban')
    return (
      <g>
        <path d="M14 72v-6c0-11 9-17 22-17s22 6 22 17v6Z" fill={outfit} />
        <ellipse cx="36" cy="35" rx="10" ry="11.5" fill={head} />
        <path d="M24.5 31c0-8 5-13 11.5-13s11.5 5 11.5 13c-3-2-7-3-11.5-3s-8.5 1-11.5 3Z" fill={accent} />
        <path d="M26 25.5c4-2 13-2.5 20 1M25 29c5-2.5 15-2.5 22 .5" fill="none" stroke={outfit} strokeWidth="0.9" opacity=".35" />
      </g>
    );
  return (
    <g>
      <path d="M12 72v-5c0-12 10-18.5 24-18.5S60 55 60 67v5Z" fill={outfit} />
      <path d="M17 57c6-4 12-6 19-6s13 2 19 6l-6 15H23Z" fill={accent} opacity=".85" />
      <ellipse cx="36" cy="35" rx="10" ry="11.5" fill={head} />
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
  const head = dark ? '#3A4A44' : '#D8C9AE';
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
  return (
    <svg viewBox="0 0 72 72" width={size} height={size} role="presentation" aria-hidden="true">
      <defs>
        <clipPath id={`av-${id}`}>
          <path d={SHAPES[config.shape]} />
        </clipPath>
      </defs>
      <g clipPath={`url(#av-${id})`}>
        <rect width="72" height="72" fill={bg} />
        <Pattern kind={config.pattern} color={patternColor} />
        <Figure kind={config.figure} outfit={outfit} accent={accent} head={head} />
        {motifOnly ? (
          <Motif kind={config.motif === 'none' ? 'crescent' : config.motif} x={22} y={20} s={1.3} color={accent} />
        ) : (
          <Motif kind={config.motif} x={52} y={8} s={0.62} color={accent} />
        )}
        {initials ? (
          <>
            <rect x="20" y="56" width="32" height="12" rx="6" fill={dark ? '#F3E7C7' : '#1C2621'} opacity=".82" />
            <text x="36" y="65" textAnchor="middle" fontSize="8" fontWeight="800" fontFamily="Manrope, system-ui, sans-serif" fill={dark ? '#1C2621' : '#F7F1E3'}>
              {initials}
            </text>
          </>
        ) : null}
      </g>
      <path d={SHAPES[config.shape]} fill="none" stroke={accent} strokeOpacity=".55" strokeWidth="1.4" />
    </svg>
  );
}
