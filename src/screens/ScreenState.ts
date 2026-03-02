/**
 * ScreenState types -- screen names, cursor state, and renderer return types.
 *
 * Every screen in the G2 battle UI is either a TextScreen (static text content)
 * or a ListScreen (selectable items). Renderers are pure functions that return
 * one of these types.
 */

import type { BattleState } from '../types/battleState.js';

// ---------------------------------------------------------------------------
// Screen names -- every distinct UI screen in the game
// ---------------------------------------------------------------------------

export type ScreenName =
  | 'MAIN_MENU'
  | 'BATTLE_HUD'
  | 'ATTACK_SELECT'
  | 'SWITCH_SELECT'
  | 'TURN_RESULT'
  | 'END_SCREEN'
  | 'SPRITE_REFRESH'
  | 'ANIMATING';

// ---------------------------------------------------------------------------
// ScreenState -- current screen + cursor position + battle context
// ---------------------------------------------------------------------------

export interface ScreenState {
  screen: ScreenName;
  cursorIndex: number;
  battleState: BattleState | null;
}

// ---------------------------------------------------------------------------
// Renderer return types
// ---------------------------------------------------------------------------

/** Battle HUD screen -- opponent and player info with optional BMP sprite data. */
export interface BattleHudScreen {
  oppText: string;
  playerText: string;
  status: { left: string; right: string };
  oppSprite?: Uint8Array;
  playerSprite?: Uint8Array;
}

/** Text screen -- static content with a two-part status bar. */
export interface TextScreen {
  text: string;
  status: { left: string; right: string };
}

/** List screen -- selectable items with a single status string. */
export interface ListScreen {
  items: string[];
  status: string;
}

/**
 * Extended list screen that maps display index to team index.
 * indexMap[displayIndex] = team index (direct mapping, no offset)
 */
export interface SwitchListScreen extends ListScreen {
  indexMap: number[];
}
