/* Light/Dark switch for the Admin Console (login page and top bar).
 * Uses the public site's own theme mechanism unchanged — html.light-mode and the stored "theme"
 * preference (services/theme/theme.ts) — so the console and the website always share one choice. */
import { applyTheme, currentTheme } from '../../../services/theme/theme';
import { useDocumentTheme } from '../../../hooks/useDocumentTheme';
import { AdminIcon } from './AdminIcon';

export function AdminThemeToggle({ id }: { id: string }) {
  const light = useDocumentTheme() === 'light';
  return (
    <button
      aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
      aria-pressed={light ? 'false' : 'true'}
      className="rad-icon-btn rad-theme-toggle"
      id={id}
      title={light ? 'Dark theme' : 'Light theme'}
      type="button"
      onClick={() => applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true)}
    >
      <AdminIcon name={light ? 'moon' : 'sun'} />
      <span className="rad-theme-label">{light ? 'Dark' : 'Light'}</span>
    </button>
  );
}
