/* App-wide overlays added in V3, mounted once beside the static shell and loaded as a separate chunk
   after the first paint: install / browser guidance and the App Guide. */
import { InstallExperience } from '../../features/pwa/InstallExperience';
import { GuideLayer } from '../../features/onboarding/GuideLayer';
import { rudIsAdminRoute } from '../routing/routeState';

export default function GlobalLayer() {
  // The admin console has its own shell; public onboarding and install prompts never show there.
  if (rudIsAdminRoute()) return null;
  return (
    <>
      <InstallExperience />
      <GuideLayer />
    </>
  );
}
