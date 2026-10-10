/* DAILY HEART REFLECTION
   Verified Qur'an translations/references only.
   Rotation is deterministic by calendar day, so it changes once per day. */

export interface DailyHeartReflection {
  reference: string;
  quote: string;
  reflection: string;
}

export const DAILY_HEART_REFLECTIONS: readonly DailyHeartReflection[] = [
  {
    reference: "QUR'AN · 13:28",
    quote: '“Surely in the remembrance of Allah do hearts find comfort.”',
    reflection: 'Return to Allah before searching for peace everywhere else.',
  },
  {
    reference: "QUR'AN · 94:5–6",
    quote: '“With hardship comes ease.”',
    reflection: 'Difficulty is not the end of the story. Keep turning to Allah.',
  },
  {
    reference: "QUR'AN · 2:286",
    quote: '“Allah does not burden a soul beyond what it can bear.”',
    reflection: 'Meet today with faith. Allah knows the strength He placed within you.',
  },
  {
    reference: "QUR'AN · 39:53",
    quote: '“Do not lose hope in Allah’s mercy.”',
    reflection: 'However far you feel, the door of repentance remains open.',
  },
  {
    reference: "QUR'AN · 65:3",
    quote: '“Whoever puts their trust in Allah, then He is sufficient for them.”',
    reflection: 'Do what you can, then place what you cannot control with Allah.',
  },
  {
    reference: "QUR'AN · 3:139",
    quote: '“Do not falter or grieve.”',
    reflection: 'Faith gives the heart a reason to rise even through difficult days.',
  },
  {
    reference: "QUR'AN · 50:16",
    quote: '“We are closer to them than their jugular vein.”',
    reflection: 'You are never beyond Allah’s knowledge. Turn to Him with sincerity.',
  },
];

export function getDailyHeartIndex(now: Date = new Date()): number {
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return (day - 1 + DAILY_HEART_REFLECTIONS.length) % DAILY_HEART_REFLECTIONS.length;
}

/** Original script published these on window; the reflection reader still reads them there. */
export function init(): void {
  const w = window as unknown as Record<string, unknown>;
  w.RUD_DAILY_HEART_REFLECTIONS = DAILY_HEART_REFLECTIONS;
  w.RUD_getDailyHeartIndex = getDailyHeartIndex;
}
