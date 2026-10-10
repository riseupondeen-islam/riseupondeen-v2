/** What the Name details dialog shows for one of the Beautiful Names. */
export interface NameDetails {
  arabic: string;
  name: string;
  meaning: string;
  reflection: string;
  when: string;
}

export const NAME_REFLECTION_FALLBACK = 'A reflection for this Name will be added here.';
export const NAME_WHEN_FALLBACK = 'Remember this Name when its meaning speaks to what your heart is carrying.';

/** Name cards are rendered by the home/library controllers; their data-* attributes carry the details. */
export const NAME_CARD_SELECTOR = '#namesGrid .name-card, #namesPageGrid .name-card';

/** Reads a card exactly as the original controller did (data attributes first, then visible text). */
export function readNameCard(card: Element): NameDetails {
  const text = (selector: string) => card.querySelector(selector)?.textContent || '';
  return {
    arabic: card.getAttribute('data-arabic') || text('.arabic, .name-arabic, .arabic-name'),
    name: card.getAttribute('data-name') || text('h3, .translit'),
    meaning: card.getAttribute('data-meaning') || text('.meaning, p'),
    reflection:
      card.getAttribute('data-reflection') || card.getAttribute('data-description') || NAME_REFLECTION_FALLBACK,
    when: card.getAttribute('data-when') || NAME_WHEN_FALLBACK,
  };
}
