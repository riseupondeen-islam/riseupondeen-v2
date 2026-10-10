/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */
/* Public home surface (original <main>): hero, daily reflection, guidance, names, final reflection. */
import { HeroSection } from './sections/HeroSection';
import { DailyReflectionSection } from './sections/DailyReflectionSection';
import { GuidanceSection } from './sections/GuidanceSection';
import { NamesSection } from './sections/NamesSection';
import { FinalReflectionSection } from './sections/FinalReflectionSection';

export function HomePage() {
  return (
    <main>
      <HeroSection />
      <DailyReflectionSection />
      <GuidanceSection />
      <NamesSection />
      <FinalReflectionSection />
    </main>
  );
}
