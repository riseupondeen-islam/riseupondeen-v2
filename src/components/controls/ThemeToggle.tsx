import { useEffect } from 'react';
import { applyTheme, currentTheme, subscribeToStoredTheme } from '../../services/theme/theme';
import { useDocumentTheme } from '../../hooks/useDocumentTheme';

/**
 * Light/Dark toggle in the app header (#rudThemeToggle).
 * Its accessible label always reflects the theme actually on screen — previously it was set once
 * at start-up and could be left stale after the intro preloader switched to the saved theme.
 */
export function ThemeToggle() {
  const light = useDocumentTheme() === 'light';

  useEffect(() => {
    applyTheme(currentTheme(), false);
    return subscribeToStoredTheme((theme) => applyTheme(theme, false));
  }, []);

  return (
    <button
      aria-label={light ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
      aria-pressed={light ? 'true' : 'false'}
      className="rud-theme-toggle"
      id="rudThemeToggle"
      title={light ? 'Dark Mode' : 'Light Mode'}
      type="button"
      onClick={() => applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true)}
    />
  );
}
