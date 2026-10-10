import type { GuideType } from './guidesData';

/* Journey Mode progress — same localStorage keys as before (rud_umrah_journey_v2 / rud_hajj_journey_v2). */
const key = (type: GuideType) => `rud_${type}_journey_v2`;

export function readJourneyStep(type: GuideType, max: number): number {
  let saved = 0;
  try {
    saved = Number(localStorage.getItem(key(type))) || 0;
  } catch {
    /* storage unavailable */
  }
  return Math.max(0, Math.min(max - 1, saved));
}

/** Clamps, persists and returns the step index. */
export function saveJourneyStep(type: GuideType, index: number, max: number): number {
  const at = Math.max(0, Math.min(max - 1, Number(index) || 0));
  try {
    localStorage.setItem(key(type), String(at));
  } catch {
    /* storage unavailable */
  }
  return at;
}
