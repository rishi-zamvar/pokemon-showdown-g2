/**
 * Main menu renderer (UI-01) -- entry point screen.
 */

import type { ListScreen } from '../ScreenState.js';
import { SpeedConfig } from '../../config/SpeedConfig.js';

/**
 * ONE row, and it must stay one row (D-05, D-06).
 *
 * The simulator omits `currentSelectItemIndex` when the selection is 0 -- the
 * same zero-dropping quirk the app already documents for `CLICK_EVENT` -- so
 * `mapEventToGesture` hands ScreenController `listIndex: undefined` and
 * `onTap` falls back to `this.state.cursorIndex`. With a single selectable
 * item `cursorIndex` never leaves 0 and that fallback is always right.
 *
 * With three rows it was not: `handleMainMenu` case 1 cycled the battle speed
 * and left `cursorIndex: 1`, so after ONE speed change every further click
 * re-cycled the speed and "Enter Battle" became permanently unreachable
 * (harness-01, verified live). Battle Speed and About now live in the root
 * context menu, which removes the state instead of special-casing the index.
 *
 * The speed preset moved to the status line -- already rendered, so it costs
 * no extra host call. The string is well inside `DISPLAY_BUDGET.LINE_WIDTH`
 * (64); if a future preset name pushes it over, shorten the branding, not the
 * speed. No "Sprite Refresh" row: SPRITE_REFRESH was already unreachable
 * before this change, and D-04 fixes the menu at three items.
 */
export function renderMainMenu(): ListScreen {
  return {
    items: ['Enter Battle'],
    status: `Pokemon Showdown G2  ·  Speed: ${SpeedConfig.current()}`,
  };
}
