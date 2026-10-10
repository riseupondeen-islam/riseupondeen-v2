/* Islamic content that can be shared with a friend.
 *
 * Nothing here is generated: items come from the content RISE publishes through the admin console
 * (the same index Ask Rise searches) and from the bundled Qur'an text (Arabic + Saheeh International).
 * Every item carries its reference so the recipient sees where it comes from. */
import { combinedPublicContent } from '../../ask-rise/askRise';
import { loadQuranText } from '../../quran/quranText';
import type { SharedContent, SharedContentType } from '../types';

export interface ShareItem extends SharedContent {
  searchText: string;
}

const TYPE_MAP: Record<string, SharedContentType> = {
  dua: 'dua',
  zikr: 'zikr',
  adhkar: 'zikr',
  hadith: 'hadith',
  reminder: 'reminder',
  quran: 'quran',
  ayah: 'quran',
};

function clean(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Published Duas, Zikr, Hadith and reminders (Ask Rise's index). */
export function publishedShareItems(): ShareItem[] {
  const source = (combinedPublicContent() || []) as Array<Record<string, unknown>>;
  const items: ShareItem[] = [];
  for (const x of source) {
    const type = TYPE_MAP[String(x.type || '').toLowerCase()];
    if (!type || !x.id) continue;
    const title = clean(x.title || x.name || x.heading || x.reference || 'Beneficial reminder', 200);
    const preview = clean(x.translation || x.meaning || x.content || x.description || x.reflection || '', 300);
    const reference = clean(x.reference || x.source || '', 200);
    const arabic = clean(x.arabic || '', 1200);
    items.push({
      id: String(x.id),
      type,
      title,
      preview,
      reference,
      arabic,
      searchText: `${title} ${preview} ${reference} ${String(x.category || '')}`.toLowerCase(),
    });
  }
  return items;
}

/** Parses "2:255", "2 255" or "Al-Baqarah 255" style references to [surah, ayah]. */
export function parseAyahReference(input: string, surahNames: string[] = []): [number, number] | null {
  const text = input.trim();
  const numeric = text.match(/^(\d{1,3})\s*[:.\s]\s*(\d{1,3})$/);
  if (numeric) return [Number(numeric[1]), Number(numeric[2])];
  const named = text.match(/^(.+?)\s+(\d{1,3})$/);
  if (named && surahNames.length) {
    const wanted = named[1].toLowerCase().replace(/[^a-z]/g, '');
    const index = surahNames.findIndex((n) => n.toLowerCase().replace(/[^a-z]/g, '') === wanted);
    if (index >= 0) return [index + 1, Number(named[2])];
  }
  return null;
}

/** Looks up one ayah from the bundled Qur'an text. */
export async function quranShareItem(surah: number, ayah: number): Promise<ShareItem | null> {
  if (!(surah >= 1 && surah <= 114 && ayah >= 1)) return null;
  const text = await loadQuranText();
  const chapter = text[surah - 1];
  if (!chapter) return null;
  const arabic = chapter.arabic.ayahs.find((a) => a.numberInSurah === ayah)?.text || '';
  const translation = chapter.translation.ayahs.find((a) => a.numberInSurah === ayah)?.text || '';
  if (!arabic && !translation) return null;
  const reference = `Qur’an ${surah}:${ayah} · ${chapter.arabic.englishName} · Translation: Saheeh International`;
  return {
    id: `quran-${surah}-${ayah}`,
    type: 'quran',
    title: `${chapter.arabic.englishName} ${surah}:${ayah}`,
    preview: clean(translation, 300),
    reference: reference.slice(0, 200),
    arabic: clean(arabic, 1200),
    searchText: '',
  };
}

export async function surahEnglishNames(): Promise<string[]> {
  const text = await loadQuranText();
  return text.map((chapter) => String(chapter.arabic.englishName || ''));
}
