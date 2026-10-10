import { createElement } from 'react';
import { showReactPage } from '../../app/routing/surfaces';
import { setFeatureHash } from '../tools/featurePageShell';
import { ZakatPage } from './ZakatPage';

/** #tracker route (window.rudRenderZakat is what the router calls). */
export function renderZakat(): void {
  if (!showReactPage(createElement(ZakatPage), 'Zakat | Rise Upon Deen')) return;
  setFeatureHash('#tracker');
}

export function init(): void {
  (window as unknown as { rudRenderZakat: () => void }).rudRenderZakat = renderZakat;
}
