/* Built avatars (Section 10): modest, faceless, illustrated — never photographs or generated faces.
 *
 * Only a tiny configuration is stored on the profile (deens_users.avatarConfig, ~150 bytes, validated
 * by firestore.rules); every avatar is drawn from shared SVG parts at render time, so no image is
 * generated, uploaded or stored per user. Colours are chosen from fixed palettes (no free input). */
import type { AvatarConfig } from '../../features/deen-friends/types';

export const AVATAR_SHAPES = ['circle', 'arch', 'octagon', 'star'] as const;
export const AVATAR_PATTERNS = ['none', 'stars', 'girih', 'arches', 'dots', 'mashrabiya', 'rays'] as const;
export const AVATAR_FIGURES = ['none', 'hijab', 'niqab', 'kufi', 'ghutra', 'turban', 'shawl'] as const;
/** Figures grouped for the builder (V3.2): clearly brothers' and sisters' styles. */
export const MEN_FIGURES = ['kufi', 'ghutra', 'turban'] as const;
export const WOMEN_FIGURES = ['hijab', 'niqab', 'shawl'] as const;
export const AVATAR_MOTIFS = ['none', 'crescent', 'lantern', 'mosque', 'kaaba', 'book', 'tasbih', 'star'] as const;

export const BACKGROUNDS: Record<string, string> = {
  cream: '#F4EAD5',
  sage: '#E1ECE3',
  sand: '#EAD8BA',
  sky: '#DCE7F0',
  rose: '#F1DDD8',
  lilac: '#E6DDEB',
  pearl: '#F7F2E8',
  saffron: '#F0D7A2',
  night: '#14251F',
  ink: '#1A2233',
  midnight: '#0E1830',
  dusk: '#3A2D47',
};
export const OUTFITS: Record<string, string> = {
  emerald: '#2F6B53',
  navy: '#22395C',
  maroon: '#6E2B36',
  charcoal: '#30343A',
  sand: '#B48A55',
  teal: '#2C6C72',
  plum: '#5B3F6C',
  ivory: '#EFE8D8',
  olive: '#5B6440',
  black: '#1F1F24',
};
export const ACCENTS: Record<string, string> = {
  gold: '#C9A04E',
  silver: '#AEB8C0',
  rosegold: '#C48D7B',
  emerald: '#3F9473',
  ivory: '#F3EBD9',
  bronze: '#A8743A',
  pearl: '#E9E2D4',
};

export const LABELS = {
  shape: { circle: 'Circle', arch: 'Arch', octagon: 'Octagon', star: 'Eight-point star' },
  pattern: { none: 'Plain', stars: 'Stars', girih: 'Girih', arches: 'Arches', dots: 'Dots', mashrabiya: 'Mashrabiya', rays: 'Light rays' },
  figure: { none: 'Motif only', hijab: 'Hijab', niqab: 'Niqab', kufi: 'Kufi', ghutra: 'Ghutra', turban: 'Imamah', shawl: 'Khimar' },
  motif: { none: 'None', crescent: 'Crescent', lantern: 'Lantern', mosque: 'Masjid', kaaba: 'Kaaba', book: 'Qur’an', tasbih: 'Tasbih', star: 'Star' },
} as const;

export const DEFAULT_AVATAR_CONFIG: AvatarConfig = {
  v: 1,
  shape: 'circle',
  background: 'cream',
  pattern: 'stars',
  figure: 'none',
  outfit: 'emerald',
  accent: 'gold',
  motif: 'crescent',
  initials: false,
};

/** A few tasteful starting points. */
export const AVATAR_PRESETS: Array<{ name: string; config: AvatarConfig }> = [
  { name: 'Noor', config: DEFAULT_AVATAR_CONFIG },
  { name: 'Sakinah', config: { ...DEFAULT_AVATAR_CONFIG, shape: 'arch', background: 'sage', pattern: 'arches', figure: 'hijab', outfit: 'emerald', accent: 'gold', motif: 'none' } },
  { name: 'Qamar', config: { ...DEFAULT_AVATAR_CONFIG, shape: 'circle', background: 'night', pattern: 'stars', figure: 'kufi', outfit: 'ivory', accent: 'gold', motif: 'none' } },
  { name: 'Rihla', config: { ...DEFAULT_AVATAR_CONFIG, shape: 'octagon', background: 'sand', pattern: 'girih', figure: 'turban', outfit: 'navy', accent: 'ivory', motif: 'none' } },
  { name: 'Rahma', config: { ...DEFAULT_AVATAR_CONFIG, shape: 'star', background: 'rose', pattern: 'dots', figure: 'shawl', outfit: 'maroon', accent: 'rosegold', motif: 'none' } },
  { name: 'Misbah', config: { ...DEFAULT_AVATAR_CONFIG, shape: 'arch', background: 'ink', pattern: 'girih', figure: 'none', outfit: 'teal', accent: 'gold', motif: 'lantern' } },
  { name: 'Haya', config: { ...DEFAULT_AVATAR_CONFIG, shape: 'circle', background: 'dusk', pattern: 'mashrabiya', figure: 'niqab', outfit: 'black', accent: 'gold', motif: 'none' } },
  { name: 'Safar', config: { ...DEFAULT_AVATAR_CONFIG, shape: 'octagon', background: 'saffron', pattern: 'rays', figure: 'ghutra', outfit: 'ivory', accent: 'bronze', motif: 'none' } },
  { name: 'Ka‘bah', config: { ...DEFAULT_AVATAR_CONFIG, shape: 'arch', background: 'midnight', pattern: 'stars', figure: 'none', outfit: 'black', accent: 'gold', motif: 'kaaba' } },
];

const pick = <T extends string>(value: unknown, list: readonly T[], fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;
const pickKey = (value: unknown, map: Record<string, string>, fallback: string) =>
  typeof value === 'string' && value in map ? value : fallback;

/** Firestore value → a safe config (unknown or tampered values fall back to defaults). */
export function readAvatarConfig(value: unknown): AvatarConfig | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const d = DEFAULT_AVATAR_CONFIG;
  return {
    v: 1,
    shape: pick(v.shape, AVATAR_SHAPES, d.shape),
    background: pickKey(v.background, BACKGROUNDS, d.background),
    pattern: pick(v.pattern, AVATAR_PATTERNS, d.pattern),
    figure: pick(v.figure, AVATAR_FIGURES, d.figure),
    outfit: pickKey(v.outfit, OUTFITS, d.outfit),
    accent: pickKey(v.accent, ACCENTS, d.accent),
    motif: pick(v.motif, AVATAR_MOTIFS, d.motif),
    initials: v.initials === true,
  };
}

/** The exact object written to Firestore (must match firestore.rules validAvatarConfig). */
export function avatarConfigForStorage(config: AvatarConfig): AvatarConfig {
  return readAvatarConfig(config) || DEFAULT_AVATAR_CONFIG;
}

export function isDarkBackground(key: string): boolean {
  return key === 'night' || key === 'ink' || key === 'midnight' || key === 'dusk';
}
