import { createElement } from 'react';
import { showReactPage } from '../../app/routing/surfaces';
import { setFeatureHash } from '../tools/featurePageShell';
import { SadaqahPage } from './SadaqahPage';

/** #sadaqah route (the router calls window.rudRenderSadaqah). Uses the current published-content snapshot. */
export function renderSadaqah(): void {
  const content = (window as unknown as { RUD_PUBLIC_CONTENT?: unknown }).RUD_PUBLIC_CONTENT;
  if (!showReactPage(createElement(SadaqahPage, { content }), 'Sadaqah | Rise Upon Deen')) return;
  setFeatureHash('#sadaqah');
}

export function init(): void {
  (window as unknown as { rudRenderSadaqah: () => void }).rudRenderSadaqah = renderSadaqah;
}
