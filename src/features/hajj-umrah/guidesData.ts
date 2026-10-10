/* Hajj & Umrah guide content — extracted verbatim (by evaluating the original data) from the
   previous inline script. Do not edit wording, Arabic, transliteration or references without
   scholarly review. */

export interface GuideDua {
  ar: string;
  trans: string;
  meaning: string;
  ref: string;
}
export interface GuideStep {
  n: string;
  meta: string;
  title: string;
  items: readonly string[];
  dua: GuideDua | null;
}
export type GuideType = 'umrah' | 'hajj';

export const UMRAH_STEPS: readonly GuideStep[] = [
  {
    n: '01',
    meta: 'Before / at the Miqat',
    title: 'Enter Ihram',
    items: [
      'Prepare before reaching the Miqat. Men wear the two Ihram garments; women remain in normal modest clothing.',
      'At the Miqat, make the intention to enter the rites of Umrah and begin the Talbiyah.',
      'Continue the Talbiyah on the journey to Makkah. Follow the rules of Ihram and avoid its prohibitions.',
    ],
    dua: {
      ar: 'لَبَّيْكَ اللَّهُمَّ لَبَّيْكَ، لَبَّيْكَ لَا شَرِيكَ لَكَ لَبَّيْكَ، إِنَّ الْحَمْدَ وَالنِّعْمَةَ لَكَ وَالْمُلْكَ، لَا شَرِيكَ لَكَ',
      trans:
        "Labbayka Allahumma labbayk. Labbayka la sharika laka labbayk. Innal-hamda wan-ni'mata laka wal-mulk. La sharika lak.",
      meaning:
        'Here I am, O Allah, here I am. Here I am; You have no partner. Truly all praise and favour are Yours, and sovereignty. You have no partner.',
      ref: 'Sahih Muslim 1218a',
    },
  },
  {
    n: '02',
    meta: 'Al-Masjid al-Haram',
    title: 'Enter the Sacred Mosque',
    items: [
      'Enter respectfully and use the established general dua for entering a mosque.',
      'Proceed calmly toward the Mataf. Do not push or harm others to reach the Black Stone.',
    ],
    dua: {
      ar: 'اللَّهُمَّ افْتَحْ لِي أَبْوَابَ رَحْمَتِكَ',
      trans: 'Allahumma iftah li abwaba rahmatik.',
      meaning: 'O Allah, open for me the doors of Your mercy.',
      ref: 'Sahih Muslim 713a',
    },
  },
  {
    n: '03',
    meta: 'Kaabah · 7 rounds',
    title: 'Perform Tawaf',
    items: [
      'Begin aligned with the Black Stone, keep the Kaabah on your left and make seven counter-clockwise circuits.',
      'When aligned with the Black Stone, say ‘Allahu Akbar’. If you cannot approach safely, continue without pushing.',
      'Men performing this arrival Tawaf may uncover the right shoulder and walk briskly in the first three circuits when conditions allow.',
      "There is no prescribed dua for every round. Make dhikr and authentic or personal dua. The following Qur'anic dua is reported between the Yemeni Corner and Black Stone.",
    ],
    dua: {
      ar: 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ',
      trans: "Rabbana atina fid-dunya hasanatan wa fil-akhirati hasanatan wa qina 'adhaban-nar.",
      meaning:
        'Our Lord, give us good in this world and good in the Hereafter, and protect us from the punishment of the Fire.',
      ref: "Qur'an 2:201; reported between the Yemeni Corner and Black Stone in Sunan Abi Dawud 1892 (Hasan)",
    },
  },
  {
    n: '04',
    meta: 'After Tawaf',
    title: "Two Rak'ahs & Zamzam",
    items: [
      "After completing seven circuits, pray two rak'ahs with Maqam Ibrahim between you and the Kaabah if this is easy and safe; otherwise pray elsewhere in the mosque.",
      'Drink Zamzam and make dua.',
      "The Prophet ﷺ recited Qur'an 2:125 at Maqam Ibrahim in the detailed Hajj narration.",
    ],
    dua: {
      ar: 'وَاتَّخِذُوا مِنْ مَقَامِ إِبْرَاهِيمَ مُصَلًّى',
      trans: 'Wattakhizhu min maqami Ibrahima musalla.',
      meaning: 'Take the standing-place of Ibrahim as a place of prayer.',
      ref: "Qur'an 2:125; Sahih Muslim 1218a",
    },
  },
  {
    n: '05',
    meta: 'Safa → Marwah · 7 lengths',
    title: "Perform Sa'i",
    items: [
      "Begin at Safa. Qur'an 2:158 identifies Safa and Marwah among Allah’s symbols.",
      'At Safa, face the Qiblah, praise Allah, say the established dhikr below and make personal dua. Repeat the same at Marwah.',
      'Walk from Safa to Marwah; this is one length. Continue until seven lengths are complete, ending at Marwah.',
      'Men jog between the green markers when able; women walk normally.',
    ],
    dua: {
      ar: 'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ، أَنْجَزَ وَعْدَهُ، وَنَصَرَ عَبْدَهُ، وَهَزَمَ الْأَحْزَابَ وَحْدَهُ',
      trans:
        "La ilaha illallahu wahdahu la sharika lah, lahul-mulku wa lahul-hamd, wa huwa 'ala kulli shay'in qadir. La ilaha illallahu wahdah, anjaza wa'dah, wa nasara 'abdah, wa hazamal-ahzaba wahdah.",
      meaning:
        'None has the right to be worshipped but Allah alone, without partner. His is the dominion and praise, and He is powerful over all things. Allah alone fulfilled His promise, helped His servant, and defeated the confederates alone.',
      ref: 'Sahih Muslim 1218a — said at Safa and Marwah, with supplication between repetitions',
    },
  },
  {
    n: '06',
    meta: 'Completion',
    title: 'Shave or Trim',
    items: [
      "After Sa'i, men shave the head or shorten hair from all around the head; shaving carries special virtue in the Sunnah.",
      'Women trim a small amount from the ends of the hair.',
      'After shaving/trimming, Umrah is complete and the restrictions of Ihram end.',
    ],
    dua: {
      ar: 'اللَّهُمَّ ارْحَمِ الْمُحَلِّقِينَ',
      trans: 'Allahummar-hamil-muhalliqin.',
      meaning: 'O Allah, have mercy on those who shave their heads.',
      ref: 'Sahih al-Bukhari 1727',
    },
  },
];

export const HAJJ_STEPS: readonly GuideStep[] = [
  {
    n: '01',
    meta: '8 Dhul Hijjah · Mina',
    title: 'Begin Hajj & go to Mina',
    items: [
      "This page follows the common Hajj Tamattu' sequence. Enter Ihram for Hajj from your place in Makkah and begin the Talbiyah.",
      'Proceed to Mina and spend the day/night in worship. The detailed Hajj narration records the Prophet ﷺ praying there before leaving for Arafah.',
    ],
    dua: {
      ar: 'لَبَّيْكَ اللَّهُمَّ لَبَّيْكَ، لَبَّيْكَ لَا شَرِيكَ لَكَ لَبَّيْكَ، إِنَّ الْحَمْدَ وَالنِّعْمَةَ لَكَ وَالْمُلْكَ، لَا شَرِيكَ لَكَ',
      trans:
        "Labbayka Allahumma labbayk. Labbayka la sharika laka labbayk. Innal-hamda wan-ni'mata laka wal-mulk. La sharika lak.",
      meaning:
        'Here I am, O Allah, here I am. Here I am; You have no partner. Truly all praise and favour are Yours, and sovereignty. You have no partner.',
      ref: 'Sahih Muslim 1218a',
    },
  },
  {
    n: '02',
    meta: '9 Dhul Hijjah · Arafah',
    title: 'Stand at Arafah',
    items: [
      'After sunrise, proceed to Arafah. Standing at Arafah is the central rite of Hajj.',
      "Devote the afternoon to sincere dua, dhikr, repentance and Qur'an until sunset. Do not leave Arafah before sunset when following the Prophetic sequence.",
      'Follow your Hajj group and official movement schedule; crowd-management instructions take priority for safe transport.',
    ],
    dua: {
      ar: 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ',
      trans: "Rabbana atina fid-dunya hasanatan wa fil-akhirati hasanatan wa qina 'adhaban-nar.",
      meaning:
        'Our Lord, give us good in this world and good in the Hereafter, and protect us from the punishment of the Fire.',
      ref: "Qur'an 2:201 — a general Qur'anic dua; not assigned as a fixed Arafah formula",
    },
  },
  {
    n: '03',
    meta: 'Night of 9th · Muzdalifah',
    title: 'Muzdalifah',
    items: [
      'After sunset, travel calmly from Arafah to Muzdalifah.',
      'The Prophetic Hajj combined Maghrib and Isha at Muzdalifah, spent the night there, prayed Fajr, and remembered Allah before moving on.',
      'Prepare for the Jamarat as directed by your authorized Hajj group and official movement plan.',
    ],
    dua: {
      ar: 'فَاذْكُرُوا اللَّهَ عِنْدَ الْمَشْعَرِ الْحَرَامِ',
      trans: "Fazhkurullaha 'indal-mash'aril-haram.",
      meaning: 'Remember Allah at the Sacred Monument.',
      ref: "Qur'an 2:198",
    },
  },
  {
    n: '04',
    meta: '10 Dhul Hijjah · Mina/Makkah',
    title: 'Day of Sacrifice',
    items: [
      'Stone Jamrat al-Aqabah with seven pebbles, saying ‘Allahu Akbar’ with each throw.',
      "For Hajj Tamattu', offer the required Hady (sacrifice) through the authorized arrangement.",
      'Men shave or trim the hair; women trim a small amount.',
      "Perform Tawaf al-Ifadah. A Tamattu' pilgrim then performs Sa'i. The preferred sequence is established, while changing the order of these rites is permitted in recognized cases.",
    ],
    dua: {
      ar: 'اللَّهُ أَكْبَرُ',
      trans: 'Allahu Akbar.',
      meaning: 'Allah is the Greatest.',
      ref: 'Seven pebbles with Takbir: Sahih Muslim 1296a; day-10 sequence also reflected in official Saudi Hajj guidance',
    },
  },
  {
    n: '05',
    meta: '11–12 Dhul Hijjah · Mina',
    title: 'Days of Tashriq',
    items: [
      'Stay in Mina for the nights required by your Hajj plan.',
      'On each stoning day, stone the Small, Middle and Major Jamarat with seven pebbles each, saying ‘Allahu Akbar’ with each pebble.',
      'Observe the official assigned stoning times and routes. Do not oppose crowd-control directions in order to target a preferred time.',
      'Pilgrims may depart after the 12th when completing the permitted early departure; those remaining continue to the 13th.',
    ],
    dua: {
      ar: 'اللَّهُ أَكْبَرُ',
      trans: 'Allahu Akbar.',
      meaning: 'Allah is the Greatest.',
      ref: 'Seven-pebble principle: Sahih Muslim 1300; Takbir with each pebble: Sahih Muslim 1296a',
    },
  },
  {
    n: '06',
    meta: '13 Dhul Hijjah · for those staying',
    title: 'Complete the Jamarat',
    items: [
      'If staying for the 13th, stone the three Jamarat again in the prescribed order, seven pebbles each.',
      "Continue dhikr and gratitude. Qur'an 2:203 commands remembrance of Allah during the numbered days.",
    ],
    dua: {
      ar: 'وَاذْكُرُوا اللَّهَ فِي أَيَّامٍ مَعْدُودَاتٍ',
      trans: "Wazhkurullaha fi ayyamin ma'dudat.",
      meaning: 'Remember Allah during the appointed days.',
      ref: "Qur'an 2:203",
    },
  },
  {
    n: '07',
    meta: 'Before leaving Makkah',
    title: 'Farewell Tawaf',
    items: [
      "When your Hajj rites are complete and you are ready to leave Makkah, make Tawaf al-Wada' your final rite at the House.",
      'Menstruating women are excused from the Farewell Tawaf in the authentic hadith.',
      'Leave with gratitude, avoiding unnecessary delay after the Farewell Tawaf except for genuine needs.',
    ],
    dua: {
      ar: 'رَبَّنَا تَقَبَّلْ مِنَّا إِنَّكَ أَنْتَ السَّمِيعُ الْعَلِيمُ',
      trans: "Rabbana taqabbal minna innaka Antas-Sami'ul-'Alim.",
      meaning: 'Our Lord, accept from us. Indeed, You are the All-Hearing, All-Knowing.',
      ref: "Qur'an 2:127; Farewell Tawaf: Sahih al-Bukhari 1755",
    },
  },
];
