/**
 * Tera confirmation renderer (UI-06) -- confirm Terastallize action.
 */

import type { BattleState } from '../../types/battleState.js';
import type { ListScreen } from '../ScreenState.js';

export function renderTeraConfirm(state: BattleState): ListScreen {
  const mon = state.playerSide.team[state.playerSide.activeIndex]!;
  return {
    items: ['< Back', 'Confirm Terastallize'],
    status: `Tera: ${mon.teraType}`,
  };
}
