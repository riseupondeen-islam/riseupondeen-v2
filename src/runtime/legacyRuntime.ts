/* Starts every migrated feature controller exactly once, in the same order as the original
 * <script> blocks (and the statements inside them) ran in index.html.
 *
 * React renders the static application shell first; this runtime then attaches behaviour to it.
 * Each controller module exports init(), which runs that module's original top-level statements.
 */
import { flushDomContentLoaded, flushWindowLoadWhenReady } from './lifecycle';
import * as homeInteractions from '../features/home/homeInteractions';
import * as dailyHeartReflections from '../features/heart/dailyHeartReflections';
import * as core from '../runtime/core';
import * as maintenance from '../features/maintenance/maintenance';
import * as legacyZikrSeed from '../features/zikr/legacyZikrSeed';
import * as publicContentCache from '../services/content/publicContentCache';
import * as firebaseInit from '../services/firebase/firebaseInit';
import * as ui from '../utils/ui';
import * as visitorAnalytics from '../features/analytics/visitorAnalytics';
import * as broadcast from '../features/broadcast/broadcast';
import * as homeContent from '../features/home/homeContent';
import * as publicContentSync from '../services/content/publicContentSync';
import * as surfaces from '../app/routing/surfaces';
import * as readers from '../features/library/readers';
import * as pushNotifications from '../features/notifications/pushNotifications';
import * as myDeen from '../features/my-deen/myDeen';
import * as exploreDrawer from '../features/navigation/exploreDrawer';
import * as routeState from '../app/routing/routeState';
import * as router from '../app/routing/router';
import * as askRise from '../features/ask-rise/askRise';
import * as quranicNames from '../features/ask-rise/quranicNames';
import * as globalUi from '../app/globalUi';
import * as deenFriends from '../features/deen-friends/deenFriendsRoute';
import * as startup from '../app/startup';
import * as pwaInstall from '../features/pwa/pwaInstall';
import * as uniqueVisitorName from '../features/visitor/uniqueVisitorName';
import * as firstVisitName from '../features/visitor/firstVisitName';
import * as scrollEngine from '../app/scrollEngine';
import * as featurePageShell from '../features/tools/featurePageShell';
import * as prayerQibla from '../features/prayer/prayerQibla';
import * as tasbih from '../features/tasbih/tasbih';
import * as quran from '../features/quran/quran';
import * as zakatRoute from '../features/zakat/zakatRoute';
import * as sadaqahRoute from '../features/sadaqah/sadaqahRoute';
import * as guidesRoute from '../features/hajj-umrah/guidesRoute';
import * as featureRoutes from '../features/tools/featureRoutes';
import { initPageDataControl } from '../features/userData/PageDataControl';

type Controller = { init: () => void };

/** Original execution order. Do not reorder without checking listener-order dependencies.
 *  The admin console controllers are started separately, on demand (features/admin/adminLoader). */
const CONTROLLERS: ReadonlyArray<readonly [string, Controller]> = [
  ['features/home/homeInteractions', homeInteractions],
  ['features/heart/dailyHeartReflections', dailyHeartReflections],
  ['runtime/core', core],
  ['features/maintenance/maintenance', maintenance],
  ['features/zikr/legacyZikrSeed', legacyZikrSeed],
  ['services/content/publicContentCache', publicContentCache],
  ['services/firebase/firebaseInit', firebaseInit],
  ['utils/ui', ui],
  ['features/analytics/visitorAnalytics', visitorAnalytics],
  ['features/broadcast/broadcast', broadcast],
  ['features/home/homeContent', homeContent],
  ['services/content/publicContentSync', publicContentSync],
  ['app/routing/surfaces', surfaces],
  ['features/library/readers', readers],
  ['features/notifications/pushNotifications', pushNotifications],
  ['features/my-deen/myDeen', myDeen],
  ['features/navigation/exploreDrawer', exploreDrawer],
  ['app/routing/routeState', routeState],
  ['app/routing/router', router],
  ['features/ask-rise/askRise', askRise],
  ['features/ask-rise/quranicNames', quranicNames],
  ['app/globalUi', globalUi],
  ['features/deen-friends/deenFriendsRoute', deenFriends],
  ['app/startup', startup],
  ['features/pwa/pwaInstall', pwaInstall],
  ['features/visitor/uniqueVisitorName', uniqueVisitorName],
  ['features/visitor/firstVisitName', firstVisitName],
  ['app/scrollEngine', scrollEngine],
  ['features/tools/featurePageShell', featurePageShell],
  ['features/prayer/prayerQibla', prayerQibla],
  ['features/tasbih/tasbih', tasbih],
  ['features/quran/quran', quran],
  ['features/zakat/zakatRoute', zakatRoute],
  ['features/sadaqah/sadaqahRoute', sadaqahRoute],
  ['features/hajj-umrah/guidesRoute', guidesRoute],
  ['features/tools/featureRoutes', featureRoutes],
  ['features/userData/PageDataControl', { init: initPageDataControl }],
];

let started = false;

export function startLegacyRuntime(): void {
  if (started) return; // React StrictMode runs effects twice in development.
  started = true;
  for (const [name, controller] of CONTROLLERS) {
    try {
      controller.init();
    } catch (error) {
      // In the original page a failing <script> did not stop the other scripts; keep that isolation.
      console.error(`[Rise Upon Deen] ${name} failed to start`, error);
    }
  }
  flushDomContentLoaded();
  flushWindowLoadWhenReady();
}

/* Development only: the controllers attach DOM listeners once, so hot-swapping one of them would
   leave the old listeners behind. Any edit under the runtime triggers a full page reload instead. */
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
