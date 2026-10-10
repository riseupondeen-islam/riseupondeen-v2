/* App Guide / first-run walkthrough configuration (Sections 13 and 23).
 *
 * One configuration-driven engine runs every tour. Admins edit the configuration in the admin console
 * (Admin → App Guide); the published copy lives in Firestore at rud_app_guides/published and is
 * readable by everyone. When it is missing or unreadable, DEFAULT_GUIDE below is used.
 *
 * Every step targets a real control by CSS selector. Steps whose control is not on screen (hidden on
 * this layout, signed out, still loading) are shown as a centred explanation instead, so a tour can
 * never get stuck. */

export type GuideLayout = 'all' | 'mobile' | 'desktop';
export type GuideAction = 'none' | 'open-explore' | 'close-explore' | 'open-install';

export interface GuideStep {
  id: string;
  /** Hash route the step belongs to ('' = stay on the current page). */
  route: string;
  /** CSS selector of the control to highlight ('' = a centred card). */
  target: string;
  title: string;
  body: string;
  layout: GuideLayout;
  action: GuideAction;
}

export interface GuideTour {
  id: string;
  title: string;
  summary: string;
  enabled: boolean;
  layout: GuideLayout;
  steps: GuideStep[];
}

export interface GuideConfig {
  /** Master switch for the first-run walkthrough (the App Guide in Explore stays available). */
  enabled: boolean;
  /** Bumped on every publish; first-run shows again only if `reshowOnVersion` is raised. */
  version: number;
  firstRunTourId: string;
  /** Users who completed first-run before this version see it again (admin choice). */
  reshowOnVersion: number;
  tours: GuideTour[];
}

const s = (id: string, route: string, target: string, title: string, body: string, extra: Partial<GuideStep> = {}): GuideStep => ({
  id,
  route,
  target,
  title,
  body,
  layout: 'all',
  action: 'none',
  ...extra,
});

export const DEFAULT_GUIDE: GuideConfig = {
  enabled: true,
  version: 1,
  firstRunTourId: 'start',
  reshowOnVersion: 1,
  tours: [
    {
      id: 'start',
      title: 'Getting started',
      summary: 'Home, navigation, Ask Rise and where everything lives.',
      enabled: true,
      layout: 'all',
      steps: [
        s('welcome', '#home', '', 'Assalamu alaikum, welcome to Rise Upon Deen', 'A calm space for the Qur’an, prayer, remembrance and growing together. This short tour shows you around — you can skip at any time.'),
        s('quick', '#home', '.rud-quick-actions, .hero .rud-circle-action', 'Your daily tools', 'Qur’an, Prayer & Qibla, Tasbih, Zakat, Hajj & Umrah and Sadaqah are one tap away.'),
        s('ask', '#home', '#heroMoodSearch', 'Ask Rise', 'Describe how you feel or what you need and Ask Rise finds duas, hadith and reminders that RISE has published.'),
        s('nav-home', '', '[data-tour="nav-home"]', 'Home', 'Return here from anywhere.'),
        s('nav-mydeen', '', '[data-tour="nav-my-deen"]', 'My Deen', 'Your private dashboard: daily adhkar, prayer check-ins, reading goals and reminders. It stays on this device.'),
        s('nav-notify', '', '[data-tour="nav-notifications"]', 'Notifications', 'Choose which prayer and Deen reminders reach this device.'),
        s('nav-friends', '', '[data-tour="nav-deen-friends"]', 'Deen Friends', 'Encourage friends, share verses, take on challenges and keep gentle streaks together.'),
        s('nav-theme', '', '#rudThemeToggle', 'Light or dark', 'Switch the look of the whole app at any time.'),
        s('explore', '', '[data-tour="nav-explore"]', 'Explore', 'Every section — libraries, tools, the App Guide and installing the app — lives here.'),
        s('guide', '', '#rudExploreGuide', 'Replay this guide', 'Open the App Guide from Explore whenever you want a refresher on any feature.', { action: 'open-explore' }),
      ],
    },
    {
      id: 'quran',
      title: 'Qur’an',
      summary: 'Reading, recitation, repeat, memorisation, sleep timer, bookmarks and notes.',
      enabled: true,
      layout: 'all',
      steps: [
        s('continue', '#quran', '#rudQuranContinue', 'Continue where you left off', 'Your last surah and ayah are remembered on this device.'),
        s('search', '#quran', '#rudQuranSurahFilter', 'Find a surah', 'Search by name or number. Everything works offline once loaded.'),
        s('bookmarks', '#quran', '#rudQuranBookmarks', 'Saved ayahs', 'Ayahs you bookmark appear here for quick return.'),
        s('play', '#quran/1', '[data-quran-play-from-here]', 'Recitation', 'Play the surah from any ayah. The player keeps going while you move around the app.'),
        s('study', '#quran/1', '[data-quran-study-toggle]', 'Study mode', 'Shows the reading with extra space for reflection.'),
        s('ayah', '#quran/1', '[data-quran-ayah-menu="1"]', 'Bookmarks and notes', 'Each ayah’s menu lets you bookmark it, write a private note, copy or share it.'),
        s('player', '#quran/1', '[data-quran-player-action="expand"]', 'Repeat, memorise and sleep', 'Open the player for Repeat (1–10 times or continuous), Memorise sessions with hidden text, a Sleep timer and reading settings.'),
        s('settings', '#quran/1', '[data-quran-sheet="settings"]', 'Reading settings', 'Adjust Arabic size, translation and display to suit your eyes.'),
      ],
    },
    {
      id: 'prayer',
      title: 'Prayer & Qibla',
      summary: 'Prayer times, live Qibla compass and nearby masjids.',
      enabled: true,
      layout: 'all',
      steps: [
        s('times', '#prayer', '#rudPrayerUseLocation, #rudPrayerTimes', 'Prayer times', 'Allow location once and today’s times are calculated for where you are.'),
        s('qibla', '#prayer', '#rudEnableCompass, #rudQiblaArrow', 'Qibla compass', 'Start the live compass and turn until the arrow points to the Kaaba.'),
        s('masjid', '#prayer', '#rudNearbyMasjidBtn', 'Nearby masjids', 'Find masjids around you, nearest first, with directions.'),
      ],
    },
    {
      id: 'my-deen',
      title: 'My Deen',
      summary: 'Daily adhkar, prayer check-ins, goals, reminders and backup.',
      enabled: true,
      layout: 'all',
      steps: [
        s('journey', '#my-deen', '.rud-journey-item', 'Your journey', 'Gentle progress for Qur’an reading and prayer — private to this device.'),
        s('modes', '#my-deen', '[data-rud-deen-mode]', 'Moments of the day', 'Morning, Night, After Salah and Travel modes gather the adhkar for that moment.'),
        s('reminders', '#my-deen', '#rudOpenReminderSettings', 'Reminders', 'Choose prayer and Deen reminders for this device.'),
        s('backup', '#my-deen', '[data-rud-backup-export]', 'Backup & restore', 'Save your My Deen data to a file and restore it on another device.'),
      ],
    },
    {
      id: 'tasbih',
      title: 'Tasbih',
      summary: 'Digital counter with Zikr, targets and haptic feedback.',
      enabled: true,
      layout: 'all',
      steps: [
        s('tap', '#tasbih', '#rudTasbihTap', 'Tap to count', 'Tap anywhere on the counter. Your count is saved on this device.'),
        s('zikr', '#tasbih', '#rudSelectZikr', 'Choose a Zikr', 'Pick a Zikr to see its Arabic, meaning and recommended count.'),
        s('reset', '#tasbih', '#rudTasbihReset', 'Start again', 'Reset the count when you begin a new round.'),
      ],
    },
    {
      id: 'library',
      title: 'Duas, Hadith & 99 Names',
      summary: 'The libraries RISE publishes, saving and sharing.',
      enabled: true,
      layout: 'all',
      steps: [
        s('duas', '#duas', '#routeGrid', 'Duas', 'Open any dua for its Arabic, transliteration, translation and source. Save it or share it as a poster.'),
        s('hadith', '#hadith', '#routeGrid', 'Hadith', 'Authentic hadith with their references.'),
        s('names', '#names', '.names-route-grid', 'The 99 Names of Allah', 'Each Name with its meaning, reflection and when to remember it.'),
        s('saved', '', '[data-tour="nav-explore"]', 'Your collection', 'Everything you save is under Explore → Collection.'),
      ],
    },
    {
      id: 'deen-friends',
      title: 'Deen Friends',
      summary: 'Friends, suggestions, chats, groups, challenges, streaks and your profile.',
      enabled: true,
      layout: 'all',
      steps: [
        s('intro', '#deen-friends', '.df2-auth, .df2-hero', 'Deen Friends', 'A private space to grow with people you know. Sign in or create an account to begin.'),
        s('profile', '#deen-friends', '.df2-me-chip', 'Profile, avatar & privacy', 'Edit your avatar and profile, preview how others see you, and choose what is public.'),
        s('friends', '#deen-friends', '#df2-tab-friends', 'Friends & suggestions', 'Add friends by username and see gentle suggestions of people you may know.'),
        s('streaks', '#deen-friends', '#df2-tab-streaks', 'Streaks', 'Your challenge streak and the days you and each friend checked in together.'),
        s('chats', '#deen-friends', '#df2-tab-chats', 'Chats & groups', 'One-to-one Deen chats, group circles (4 or more people) and the official RISE chat.'),
        s('challenges', '#deen-friends', '#df2-tab-challenges', 'Challenges & leaderboard', 'Daily Deen Challenges, challenges from friends, and this month’s leaderboard.'),
      ],
    },
    {
      id: 'install',
      title: 'Install the app',
      summary: 'Add Rise Upon Deen to your Home Screen.',
      enabled: true,
      layout: 'all',
      steps: [
        s('install', '', '', 'Install Rise Upon Deen', 'Installing gives you a full-screen app, faster start-up and offline reading. The next screen shows the exact steps for your device and browser.', { action: 'open-install' }),
      ],
    },
  ],
};

/* ---------- validation (configs come from Firestore and are edited by people) ---------- */

const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const LAYOUTS = ['all', 'mobile', 'desktop'] as const;
const ACTIONS = ['none', 'open-explore', 'close-explore', 'open-install'] as const;

export function safeSelector(selector: string): boolean {
  if (!selector) return true;
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeGuide(input: unknown): GuideConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const tours = (Array.isArray(raw.tours) ? raw.tours : []).slice(0, 24).map((t, ti) => {
    const tour = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
    const steps = (Array.isArray(tour.steps) ? tour.steps : []).slice(0, 40).map((x, si) => {
      const step = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      const route = str(step.route, 120).trim();
      const target = str(step.target, 300).trim();
      return {
        id: str(step.id, 60) || `step-${si + 1}`,
        route: route && !route.startsWith('#') ? `#${route}` : route,
        target: safeSelector(target) ? target : '',
        title: str(step.title, 120) || 'Step',
        body: str(step.body, 600),
        layout: oneOf(step.layout, LAYOUTS, 'all'),
        action: oneOf(step.action, ACTIONS, 'none'),
      } satisfies GuideStep;
    });
    return {
      id: str(tour.id, 60).replace(/[^a-z0-9-]/gi, '') || `tour-${ti + 1}`,
      title: str(tour.title, 80) || 'Guide',
      summary: str(tour.summary, 200),
      enabled: tour.enabled !== false,
      layout: oneOf(tour.layout, LAYOUTS, 'all'),
      steps,
    } satisfies GuideTour;
  });
  return {
    enabled: raw.enabled !== false,
    version: Math.max(1, Math.floor(Number(raw.version) || 1)),
    firstRunTourId: str(raw.firstRunTourId, 60) || (tours[0]?.id ?? ''),
    reshowOnVersion: Math.max(1, Math.floor(Number(raw.reshowOnVersion) || 1)),
    tours: tours.length ? tours : DEFAULT_GUIDE.tours,
  };
}

export function currentLayout(): Exclude<GuideLayout, 'all'> {
  try {
    return matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop';
  } catch {
    return 'desktop';
  }
}

export function fitsLayout(layout: GuideLayout): boolean {
  return layout === 'all' || layout === currentLayout();
}
