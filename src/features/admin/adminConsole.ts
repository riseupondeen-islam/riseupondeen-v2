/* Admin console bundle — loaded on demand (see adminLoader.ts) only when the admin route is
 * opened, so public visitors never download or run the console code or its stylesheet.
 * Controllers are started once, in their original relative order.
 */
import './styles/admin-console.css';
import * as adminPersistence from './adminPersistence';
import * as adminAuth from './adminAuth';
import * as adminRouter from './adminRouter';
import * as analyticsView from './views/analyticsView';
import * as scheduledView from './views/scheduledView';
import * as trashView from './views/trashView';
import * as notificationsView from './views/notificationsView';
import * as broadcastView from './views/broadcastView';
import * as maintenanceView from './views/maintenanceView';
import * as deenFriendsAdminView from './views/deenFriendsAdminView';
import * as adminViews from './adminViews';
import * as contentEditor from './views/contentEditor';
import * as bulkUpload from './views/bulkUpload';
import * as contentManager from './views/contentManager';
import * as contentPreview from './views/contentPreview';
import * as contentTrash from './contentTrash';
import * as siteContent from './views/siteContent';
import * as adminTableKit from './adminTableKit';

export { renderAdminRoute, setAdminDrawer, showAdminDashboard, showAdminLogin } from './adminRouter';

const CONTROLLERS: ReadonlyArray<readonly [string, { init: () => void }]> = [
  ['adminPersistence', adminPersistence],
  ['adminAuth', adminAuth],
  ['adminRouter', adminRouter],
  ['analyticsView', analyticsView],
  ['scheduledView', scheduledView],
  ['trashView', trashView],
  ['notificationsView', notificationsView],
  ['broadcastView', broadcastView],
  ['maintenanceView', maintenanceView],
  ['deenFriendsAdminView', deenFriendsAdminView],
  ['adminViews', adminViews],
  ['contentEditor', contentEditor],
  ['bulkUpload', bulkUpload],
  ['contentManager', contentManager],
  ['contentPreview', contentPreview],
  ['contentTrash', contentTrash],
  ['siteContent', siteContent],
  ['adminTableKit', adminTableKit],
];

let started = false;

export function startAdminConsole(): void {
  if (started) return;
  started = true;
  for (const [name, controller] of CONTROLLERS) {
    try {
      controller.init();
    } catch (error) {
      console.error(`[Rise Upon Deen] admin ${name} failed to start`, error);
    }
  }
}
