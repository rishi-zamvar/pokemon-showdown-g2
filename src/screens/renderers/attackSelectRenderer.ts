/**
 * Attack selection renderer (UI-04) -- lists the active Pokemon's 4 moves.
 *
 * Uses DataLoader.getMove() to resolve move slugs to display names and types.
 * Marks moves with 0 PP as unusable with [--] suffix.
 */

import type { BattleState } from '../../types/battleState.js';
import type { ListScreen } from '../ScreenState.js';
import { DataLoader } from '../../data/DataLoader.js';
import { DISPLAY_BUDGET } from '../../config/constants.js';

export function renderAttackSelect(state: BattleState): ListScreen {
  const mon = state.playerSide.team[state.playerSide.activeIndex]!;
  const items: string[] = [];

  for (const slug of mon.moves) {
    const moveData = DataLoader.getMove(slug);
    const moveName = moveData?.name ?? slug;
    const moveType = moveData?.type ?? '???';
    const maxPp = moveData?.pp ?? 0;
    const used = mon.ppUsed[slug] ?? 0;
    const remaining = Math.max(0, maxPp - used);

    let label = `${moveName} (${moveType}) ${remaining}/${maxPp}`;
    if (remaining === 0) {
      label += ' [--]';
    }

    // Enforce per-line width limit
    if (label.length > DISPLAY_BUDGET.LINE_WIDTH) {
      const truncName = moveName.slice(0, moveName.length - (label.length - DISPLAY_BUDGET.LINE_WIDTH));
      label = `${truncName} (${moveType}) ${remaining}/${maxPp}`;
      if (remaining === 0) {
        label += ' [--]';
      }
    }

    items.push(label);
  }

  return {
    items,
    status: 'Choose move',
  };
}
