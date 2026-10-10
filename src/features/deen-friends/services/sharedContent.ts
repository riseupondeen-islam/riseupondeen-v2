/* Shared Islamic content in chats — complete text, never cut in half (Section 21).
 *
 * V2 stored a 300-character `preview` (and cut Arabic at 1,200), so long duas, hadith and ayahs
 * arrived truncated. V3 stores the complete Arabic, transliteration, translation, reference and
 * source exactly as published (within Firestore's limits, see MAX_* below), and when an older,
 * truncated message is displayed it is completed from the app's own verified sources — the content
 * RISE publishes and the bundled Qur'an text. Nothing is generated: a field the source does not have
 * (for example a transliteration of an ayah) is simply not shown. */
import { combinedPublicContent } from '../../ask-rise/askRise';
import { loadQuranText } from '../../quran/quranText';
import type { SharedContent } from '../types';

/** Generous limits (the longest published hadith/dua fit comfortably; a document may hold 1 MiB). */
export const MAX_ARABIC = 8000;
export const MAX_TRANSLATION = 8000;
export const MAX_TRANSLITERATION = 6000;

const keepText = (value: unknown, max: number) =>
  String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .slice(0, max);

/** The exact object written with a message (firestore.rules validContentMsg / validGroupContent). */
export function sharedContentForStorage(content: SharedContent): SharedContent {
  const translation = keepText(content.translation ?? content.preview, MAX_TRANSLATION);
  const out: SharedContent = {
    id: String(content.id).slice(0, 200),
    type: content.type,
    title: keepText(content.title || 'Shared reminder', 200),
    // `preview` stays for older app versions, which only know this field.
    preview: translation.replace(/\s+/g, ' ').slice(0, 300),
    reference: keepText(content.reference, 200),
    arabic: keepText(content.arabic, MAX_ARABIC),
    translation,
  };
  const transliteration = keepText(content.transliteration, MAX_TRANSLITERATION);
  if (transliteration) out.transliteration = transliteration;
  const source = keepText(content.source, 200);
  if (source) out.source = source;
  return out;
}

/** Published item (duas, hadith, zikr, reminders) → complete shareable content. */
export function contentFromPublished(x: Record<string, unknown>, type: SharedContent['type']): SharedContent {
  const translation = String(x.translation || x.meaning || x.content || x.description || x.reflection || '');
  return {
    id: String(x.id),
    type,
    title: String(x.title || x.name || x.heading || x.reference || 'Beneficial reminder'),
    arabic: String(x.arabic || ''),
    transliteration: String(x.transliteration || ''),
    translation,
    preview: translation,
    reference: String(x.reference || ''),
    source: String(x.source || ''),
  };
}

const QURAN_ID = /^quran-(\d{1,3})-(\d{1,3})$/;

/**
 * Fills fields that an older message stored truncated (or without) from the app's verified sources.
 * Returns the stored content unchanged when no source matches.
 */
export async function completeSharedContent(stored: SharedContent): Promise<SharedContent> {
  const quran = stored.id.match(QURAN_ID);
  if (stored.type === 'quran' && quran) {
    try {
      const [surah, ayah] = [Number(quran[1]), Number(quran[2])];
      const text = await loadQuranText();
      const chapter = text[surah - 1];
      const arabic = chapter?.arabic.ayahs.find((a) => a.numberInSurah === ayah)?.text || '';
      const translation = chapter?.translation.ayahs.find((a) => a.numberInSurah === ayah)?.text || '';
      return {
        ...stored,
        arabic: arabic.length > (stored.arabic || '').length ? arabic : stored.arabic,
        translation: translation.length > (stored.translation || stored.preview || '').length ? translation : stored.translation || stored.preview,
      };
    } catch {
      return stored;
    }
  }
  const items = (combinedPublicContent() || []) as Array<Record<string, unknown>>;
  const match = items.find((x) => String(x.id) === stored.id);
  if (!match) return stored;
  const full = contentFromPublished(match, stored.type);
  const longer = (a?: string, b?: string) => ((b || '').length > (a || '').length ? b : a);
  return {
    ...stored,
    arabic: longer(stored.arabic, full.arabic),
    transliteration: longer(stored.transliteration, full.transliteration),
    translation: longer(stored.translation || stored.preview, full.translation),
    reference: stored.reference || full.reference,
    source: stored.source || full.source,
  };
}

/** True when the message looks cut (V2 limits) and is worth completing from local sources. */
export function looksTruncated(c: SharedContent): boolean {
  return !c.translation && ((c.preview || '').length >= 295 || (c.arabic || '').length >= 1195 || !c.preview);
}
