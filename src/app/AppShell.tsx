/* The static application shell, in the exact element order of the original <body>.
   Whitespace text nodes between elements are kept so inline layout is unchanged. */
import { AppHeader } from '../components/layout/AppHeader';
import { WelcomeIntro } from '../features/visitor/WelcomeIntro';
import { BroadcastOverlay } from '../features/broadcast/BroadcastOverlay';
import { MeccaBackgroundLite } from '../components/background/MeccaBackgroundLite';
import { GlobalMeccaBackground } from '../components/background/GlobalMeccaBackground';
import { SiteAtmosphere } from '../components/background/SiteAtmosphere';
import { HomePage } from '../features/home/HomePage';
import { SiteFooter } from '../components/layout/SiteFooter';
import { BackToTopButton } from '../components/controls/BackToTopButton';
import { ScrollProgress } from '../components/controls/ScrollProgress';
import { BackLane } from '../components/navigation/BackLane';
import { LibraryCloseButton } from '../components/navigation/LibraryCloseButton';
import { ExploreDrawer } from '../components/navigation/ExploreDrawer';
import { DynamicPage } from '../components/layout/DynamicPage';
import { AskRiseOverlay } from '../features/ask-rise/AskRiseOverlay';
import { DeleteConfirmOverlay } from '../features/admin/components/DeleteConfirmOverlay';
import { AdminApp } from '../features/admin/components/AdminApp';
import { ToastStack } from '../components/feedback/ToastStack';
import { NameModal } from '../features/names/components/NameModal';
import { AllNamesModal } from '../features/names/components/AllNamesModal';

export function AppShell() {
  return (
    <>
      {'\n'}
      {'\n'}
      <AppHeader />
      {'\n'}
      <WelcomeIntro />
      {'\n'}
      <BroadcastOverlay />
      {'\n'}
      <MeccaBackgroundLite />
      {'\n'}
      <GlobalMeccaBackground />
      <SiteAtmosphere />
      <HomePage />
      <SiteFooter />
      <BackToTopButton />
      <ScrollProgress />
      {'\n'}
      <BackLane />
      {'\n'}
      <LibraryCloseButton />
      {'\n'}
      <ExploreDrawer />
      <DynamicPage />
      <AskRiseOverlay />
      <DeleteConfirmOverlay />
      <AdminApp />
      <ToastStack />
      <NameModal />
      <AllNamesModal />
    </>
  );
}
