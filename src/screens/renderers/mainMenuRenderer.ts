/**
 * Main menu renderer (UI-01) -- entry point screen.
 */

import type { ListScreen } from '../ScreenState.js';

export function renderMainMenu(): ListScreen {
  return {
    items: ['Enter Battle'],
    status: 'Pokemon Showdown G2',
  };
}
