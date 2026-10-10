import { useRouteChrome } from '../../hooks/useRouteChrome';

/** × shown on the Dua, Hadith and Saved libraries. Its click is handled by the history/scroll engine. */
export function LibraryCloseButton() {
  const { library } = useRouteChrome();
  return (
    <button
      aria-label="Close library"
      className="rud-library-close"
      hidden={!library}
      id="rudLibraryClose"
      type="button"
    >
      {'×'}
    </button>
  );
}
