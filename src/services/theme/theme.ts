/* Light/Dark theme — same behaviour as the original theme controller:
   html.light-mode marks the light theme, the choice is stored in localStorage("theme"),
   and the browser chrome colours (theme-color / color-scheme) follow it. */
export type Theme = 'light' | 'dark';

const THEME_KEY = 'theme';
let switchFrame = 0;

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('light-mode') ? 'light' : 'dark';
}

export function applyTheme(theme: Theme, persist = false): void {
  const root = document.documentElement;
  const light = theme === 'light';
  const changed = root.classList.contains('light-mode') !== light;
  if (changed) {
    // Suppresses colour transitions for one frame so the whole page switches at once.
    root.classList.add('rud-theme-switching');
    root.classList.toggle('light-mode', light);
  }
  root.style.backgroundColor = light ? '#ffffff' : '#050505';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#ffffff' : '#050505');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', light ? 'light' : 'dark');
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, light ? 'light' : 'dark');
    } catch {
      /* storage unavailable (private mode) — theme still applies for this page */
    }
  }
  if (changed) {
    cancelAnimationFrame(switchFrame);
    switchFrame = requestAnimationFrame(() => root.classList.remove('rud-theme-switching'));
  }
}

/** Keeps other open tabs in sync when the theme is changed in one of them. */
export function subscribeToStoredTheme(onTheme: (theme: Theme) => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) onTheme(e.newValue);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
