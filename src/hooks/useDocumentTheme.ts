import { useSyncExternalStore } from 'react';
import { currentTheme, type Theme } from '../services/theme/theme';

/* The theme lives on <html class="light-mode"> and is also switched by the intro preloader, so
   the source of truth is the DOM itself; this hook re-renders whenever that class changes. */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

export function useDocumentTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'light' as Theme);
}
