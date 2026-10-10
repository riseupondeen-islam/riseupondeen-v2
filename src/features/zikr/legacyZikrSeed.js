/**
 * One-time migration that seeds the original built-in Zikr list into the content collection.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { COLLECTION } from '../../runtime/core';
import { collection, doc, serverTimestamp, writeBatch } from '../../services/firebase/sdk';
import { toast } from '../../utils/ui';

let zikrSeedAttempted, LEGACY_ZIKR_MIGRATION;

async function ensureLegacyZikrSeed() {
  if (zikrSeedAttempted || !S.firebaseReady || !S.auth?.currentUser) return;
  if (S.adminContent.some((x) => x.type === 'zikr')) {
    zikrSeedAttempted = true;
    return;
  }
  zikrSeedAttempted = true;
  try {
    const batch = writeBatch(S.db);
    LEGACY_ZIKR_MIGRATION.forEach((z, index) => {
      const ref = doc(collection(S.db, COLLECTION));
      batch.set(ref, {
        type: 'zikr',
        ...z,
        reference: '',
        recommendedCount: null,
        category: 'General',
        displayOrder: index + 1,
        featured: false,
        published: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
    toast('Existing Tasbih Zikr migrated to Admin management.');
  } catch (e) {
    console.warn('Zikr migration skipped', e);
    zikrSeedAttempted = false;
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  /* Existing Tasbih options are migrated once into Firestore after an authorized
   admin session sees no Zikr records. The public Tasbih UI never reads this
   migration array; after migration it reads only managed Firestore records. */
  zikrSeedAttempted = false;
  LEGACY_ZIKR_MIGRATION = [
    { title: 'SubhanAllah', arabic: 'سُبْحَانَ اللَّهِ', transliteration: 'SubhanAllah', meaning: 'Glory be to Allah' },
    {
      title: 'Alhamdulillah',
      arabic: 'الْحَمْدُ لِلَّهِ',
      transliteration: 'Alhamdulillah',
      meaning: 'All praise is for Allah',
    },
    {
      title: 'Allahu Akbar',
      arabic: 'اللَّهُ أَكْبَرُ',
      transliteration: 'Allahu Akbar',
      meaning: 'Allah is the Greatest',
    },
    {
      title: 'La ilaha illallah',
      arabic: 'لَا إِلٰهَ إِلَّا اللَّهُ',
      transliteration: 'La ilaha illallah',
      meaning: 'There is no deity worthy of worship except Allah',
    },
    {
      title: 'Astaghfirullah',
      arabic: 'أَسْتَغْفِرُ اللَّهَ',
      transliteration: 'Astaghfirullah',
      meaning: 'I seek Allah’s forgiveness',
    },
    {
      title: 'SubhanAllahi wa bihamdihi',
      arabic: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',
      transliteration: 'SubhanAllahi wa bihamdihi',
      meaning: 'Glory and praise be to Allah',
    },
    {
      title: 'SubhanAllahil Azeem',
      arabic: 'سُبْحَانَ اللَّهِ الْعَظِيمِ',
      transliteration: 'SubhanAllahil Azeem',
      meaning: 'Glory be to Allah, the Magnificent',
    },
    {
      title: 'La hawla wa la quwwata illa billah',
      arabic: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',
      transliteration: 'La hawla wa la quwwata illa billah',
      meaning: 'There is no power nor strength except through Allah',
    },
    {
      title: 'Allahumma salli ala Muhammad ﷺ',
      arabic: 'اللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ',
      transliteration: 'Allahumma salli ala Muhammad ﷺ',
      meaning: 'O Allah, send blessings upon Muhammad ﷺ',
    },
  ];
}

export { ensureLegacyZikrSeed };
