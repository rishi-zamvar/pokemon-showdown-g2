/**
 * End screen renderer (UI-08) -- victory or defeat terminal screen.
 */

import type { ListScreen } from '../ScreenState.js';

export function renderEndScreen(winner: 'player' | 'opponent'): ListScreen {
  return {
    items: ['New Battle', 'Main Menu'],
    status: winner === 'player' ? 'Victory!' : 'Defeat...',
  };
}
