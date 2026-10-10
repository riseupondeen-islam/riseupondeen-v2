/* Lazy loader for the bundled Qur'an text (Arabic + Saheeh International translation for all
   114 surahs). It used to be parsed inline on every page load; now it is a separate, hashed JSON
   file (served gzip-compressed by Hosting) that is only downloaded when the Qur'an reader needs it,
   and precached by the service worker for offline reading. The content is the exact dataset from
   the original index.html. */
import quranTextUrl from './data/quranText.json?url';

export interface QuranAyahText {
  numberInSurah: number;
  text: string;
  [key: string]: unknown;
}
export interface QuranEditionText {
  number: number;
  name: string;
  englishName: string;
  numberOfAyahs: number;
  ayahs: QuranAyahText[];
  [key: string]: unknown;
}
export interface QuranSurahText {
  arabic: QuranEditionText;
  translation: QuranEditionText;
}

let pending: Promise<QuranSurahText[]> | null = null;

export function loadQuranText(): Promise<QuranSurahText[]> {
  if (!pending) {
    pending = fetch(quranTextUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Qur'an text request failed (${response.status})`);
        return response.json() as Promise<QuranSurahText[]>;
      })
      .catch((error: unknown) => {
        pending = null; // allow a retry (e.g. after reconnecting)
        throw error;
      });
  }
  return pending;
}
