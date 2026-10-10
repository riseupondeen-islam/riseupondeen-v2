/* Display order for the Beautiful Names of Allah.
 *
 * Names are published from the admin console and arrive in Firestore order (newest first), which
 * showed the list reversed or shuffled. They are ordered here by their published number (1 → 99);
 * when two items share a number, the one published first is kept (the other is a re-upload). Items without a valid
 * number keep their relative order after the numbered ones. Nothing in the content is changed. */
interface NameLike {
  number?: unknown;
  displayOrder?: unknown;
  createdAt?: unknown;
}

function createdMs(item: NameLike): number {
  const v = item.createdAt as { toMillis?: () => number; seconds?: number } | number | undefined;
  if (typeof v === 'number') return v;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v && typeof v.seconds === 'number') return v.seconds * 1000;
  return Number.MAX_SAFE_INTEGER;
}

export function nameNumber(item: NameLike): number {
  const n = Number(item.number ?? item.displayOrder);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : 0;
}

export function orderNamesForDisplay<T extends NameLike>(items: T[]): T[] {
  const byNumber = new Map<number, T>();
  const unnumbered: T[] = [];
  for (const item of items) {
    const n = nameNumber(item);
    if (!n) {
      unnumbered.push(item);
      continue;
    }
    // Two items with the same number: keep the one published first (the later one is a re-upload).
    const kept = byNumber.get(n);
    if (!kept || createdMs(item) < createdMs(kept)) byNumber.set(n, item);
  }
  const numbered = [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
  return [...numbered, ...unnumbered];
}
