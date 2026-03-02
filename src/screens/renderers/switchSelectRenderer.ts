/**
 * Switch selection renderer (UI-05) -- lists eligible team members to switch in.
 *
 * Filters out the current active Pokemon and any fainted Pokemon.
 * Returns an indexMap so the ScreenController can map display selection
 * back to the original team index.
 */

import type { BattleState } from '../../types/battleState.js';
import type { SwitchListScreen } from '../ScreenState.js';

export function renderSwitchSelect(
  state: BattleState,
  forced: boolean,
): SwitchListScreen {
  const side = state.playerSide;
  const items: string[] = [];
  const indexMap: number[] = [];

  for (let i = 0; i < side.team.length; i++) {
    // Skip current active and fainted Pokemon
    if (i === side.activeIndex) continue;
    const mon = side.team[i]!;

    if (mon.fainted) {
      const name = mon.name.slice(0, 12);
      items.push(`${name} 0% (fainted)`);
      indexMap.push(-1); // sentinel: non-selectable
      continue;
    }

    const name = mon.name.slice(0, 12);
    const hpPct = Math.max(1, Math.round((mon.currentHp / mon.stats.hp) * 100));
    items.push(`${name} ${hpPct}%`);
    indexMap.push(i);
  }

  return {
    items,
    indexMap,
    status: forced ? 'Switch in!' : 'Switch to',
  };
}
