import { createElement } from 'react';
import { showReactPage } from '../../app/routing/surfaces';
import { HajjUmrahPage } from './HajjUmrahPage';

/** #umrah / #hajj route (the router calls window.rudRenderUmrah). */
export function renderHajjUmrah(): void {
  showReactPage(createElement(HajjUmrahPage), 'Hajj & Umrah | Rise Upon Deen');
}

export function init(): void {
  (window as unknown as { rudRenderUmrah: () => void }).rudRenderUmrah = renderHajjUmrah;
}
