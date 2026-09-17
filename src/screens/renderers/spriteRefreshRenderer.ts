/**
 * Sprite refresh renderer — "Refresh Sprites" sub-menu.
 *
 * Options: < Back, Mine, Theirs, Both
 * Selecting an option clears the relevant localStorage sprite cache.
 */

import type { ListScreen } from '../ScreenState.js';

export function renderSpriteRefresh(): ListScreen {
  return {
    items: ['< Back', 'Mine', 'Theirs', 'Both'],
    status: 'Refresh Sprites',
  };
}
