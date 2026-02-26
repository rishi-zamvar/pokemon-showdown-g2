/**
 * ScreenController — the screen state machine that routes gestures to
 * screen transitions and battle engine calls.
 *
 * This is the brain of the UI layer. It holds screen state (which screen,
 * cursor, battleState), maps gestures to actions, calls renderers to get
 * content, and pushes content to the glass display.
 *
 * Navigation graph:
 *   MAIN_MENU -> BATTLE_HUD -> ACTION_MENU -> ATTACK_SELECT
 *                                           -> SWITCH_SELECT
 *                                           -> TERA_CONFIRM -> ATTACK_SELECT
 *   TURN_RESULT -> BATTLE_HUD | SWITCH_SELECT (forced) | END_SCREEN
 *   END_SCREEN -> MAIN_MENU | BATTLE_HUD (new battle)
 */

import type { GlassAdapter, GestureEvent } from '../types/contracts.js';
import type { BattleState, TurnLogEntry, PlayerAction } from '../types/battleState.js';
import type { ScreenState } from './ScreenState.js';
import { BattleEngine } from '../battle/BattleEngine.js';
import { AIOpponent } from '../battle/AIOpponent.js';
import { DataLoader } from '../data/DataLoader.js';
import { renderMainMenu } from './renderers/mainMenuRenderer.js';
import { renderBattleHud } from './renderers/battleHudRenderer.js';
import { renderActionMenu } from './renderers/actionMenuRenderer.js';
import { renderAttackSelect } from './renderers/attackSelectRenderer.js';
import { renderSwitchSelect } from './renderers/switchSelectRenderer.js';
import { renderTeraConfirm } from './renderers/teraConfirmRenderer.js';
import { renderTurnResult } from './renderers/turnResultRenderer.js';
import { renderEndScreen } from './renderers/endScreenRenderer.js';

export class ScreenController {
  private readonly glass: GlassAdapter;
  private state: ScreenState;
  private lastTurnLog: TurnLogEntry[] = [];
  private switchIndexMap: number[] = [];
  private forcedSwitch = false;
  private teraQueued = false;

  constructor(glass: GlassAdapter) {
    this.glass = glass;
    this.state = {
      screen: 'MAIN_MENU',
      cursorIndex: 0,
      battleState: null,
    };
  }

  /** Render the main menu on glasses. Called once after construction. */
  async init(): Promise<void> {
    await this.render();
  }

  /** Main gesture entry point. Routes based on event kind. */
  async handleGesture(event: GestureEvent): Promise<void> {
    switch (event.kind) {
      case 'TAP':
        await this.onTap(event.listIndex);
        break;
      case 'FOREGROUND_ENTER':
        await this.render();
        break;
      case 'SCROLL_FWD':
      case 'SCROLL_BACK':
      case 'FOREGROUND_EXIT':
        // No-ops — scroll on text screens must not trigger rebuild
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Core routing logic
  // ---------------------------------------------------------------------------

  private async onTap(listIndex?: number): Promise<void> {
    const idx = listIndex ?? this.state.cursorIndex;

    switch (this.state.screen) {
      case 'MAIN_MENU':
        await this.startNewBattle();
        break;

      case 'BATTLE_HUD':
        // Any tap on HUD opens action menu
        this.state = { ...this.state, screen: 'ACTION_MENU', cursorIndex: 0 };
        await this.render();
        break;

      case 'ACTION_MENU':
        await this.handleActionMenu(idx);
        break;

      case 'ATTACK_SELECT':
        await this.handleAttackSelect(idx);
        break;

      case 'SWITCH_SELECT':
        await this.handleSwitchSelect(idx);
        break;

      case 'TERA_CONFIRM':
        await this.handleTeraConfirm(idx);
        break;

      case 'TURN_RESULT':
        await this.handleTurnResult();
        break;

      case 'END_SCREEN':
        await this.handleEndScreen(idx);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Screen-specific tap handlers
  // ---------------------------------------------------------------------------

  private async handleActionMenu(idx: number): Promise<void> {
    switch (idx) {
      case 0: // "< Back"
        this.state = { ...this.state, screen: 'BATTLE_HUD', cursorIndex: 0 };
        await this.render();
        break;
      case 1: // "Attack"
        this.teraQueued = false;
        this.state = { ...this.state, screen: 'ATTACK_SELECT', cursorIndex: 0 };
        await this.render();
        break;
      case 2: // "Switch"
        this.forcedSwitch = false;
        this.state = { ...this.state, screen: 'SWITCH_SELECT', cursorIndex: 0 };
        await this.render();
        break;
      case 3: // "Terastallize"
        if (this.state.battleState?.playerSide.teraUsed) {
          // Already used — ignore tap
          return;
        }
        this.state = { ...this.state, screen: 'TERA_CONFIRM', cursorIndex: 0 };
        await this.render();
        break;
    }
  }

  private async handleAttackSelect(idx: number): Promise<void> {
    if (idx === 0) {
      // "< Back"
      this.teraQueued = false;
      this.state = { ...this.state, screen: 'ACTION_MENU', cursorIndex: 0 };
      await this.render();
      return;
    }

    // Move indices 1-4 map to moves[0]-moves[3]
    const bs = this.state.battleState!;
    const moveIndex = idx - 1;
    const mon = bs.playerSide.team[bs.playerSide.activeIndex]!;
    const moveSlug = mon.moves[moveIndex];
    if (!moveSlug) return;

    const actionType = this.teraQueued ? 'TERA_ATTACK' : 'ATTACK';
    this.teraQueued = false;

    const action: PlayerAction = actionType === 'TERA_ATTACK'
      ? { type: 'TERA_ATTACK', moveSlug }
      : { type: 'ATTACK', moveSlug };

    await this.resolveTurn(action);
  }

  private async handleSwitchSelect(idx: number): Promise<void> {
    if (idx === 0) {
      // "< Back" — blocked on forced switch
      if (this.forcedSwitch) return;
      this.state = { ...this.state, screen: 'ACTION_MENU', cursorIndex: 0 };
      await this.render();
      return;
    }

    // Map display index to team index
    const toIndex = this.switchIndexMap[idx - 1];
    if (toIndex === undefined) return;

    if (this.forcedSwitch) {
      await this.resolveSwitch(toIndex);
    } else {
      await this.resolveTurn({ type: 'SWITCH', toIndex });
    }
  }

  private async handleTeraConfirm(idx: number): Promise<void> {
    if (idx === 0) {
      // "< Back"
      this.teraQueued = false;
      this.state = { ...this.state, screen: 'ACTION_MENU', cursorIndex: 0 };
      await this.render();
      return;
    }

    if (idx === 1) {
      // "Confirm" — queue tera and navigate to attack select
      this.teraQueued = true;
      this.state = { ...this.state, screen: 'ATTACK_SELECT', cursorIndex: 0 };
      await this.render();
    }
  }

  private async handleTurnResult(): Promise<void> {
    const bs = this.state.battleState!;

    switch (bs.phase) {
      case 'WAITING_FOR_ACTION':
        this.state = { ...this.state, screen: 'BATTLE_HUD', cursorIndex: 0 };
        await this.render();
        break;
      case 'WAITING_FOR_SWITCH':
        this.forcedSwitch = true;
        this.state = { ...this.state, screen: 'SWITCH_SELECT', cursorIndex: 0 };
        await this.render();
        break;
      case 'BATTLE_OVER':
        this.state = { ...this.state, screen: 'END_SCREEN', cursorIndex: 0 };
        await this.render();
        break;
    }
  }

  private async handleEndScreen(idx: number): Promise<void> {
    switch (idx) {
      case 0: // "New Battle"
        await this.startNewBattle();
        break;
      case 1: // "Main Menu"
        DataLoader.clearMatchData();
        this.state = {
          screen: 'MAIN_MENU',
          cursorIndex: 0,
          battleState: null,
        };
        await this.render();
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Battle flow
  // ---------------------------------------------------------------------------

  private async startNewBattle(): Promise<void> {
    await this.glass.showMessage('Generating teams...');

    const battleState = BattleEngine.startBattle();
    this.state = {
      screen: 'BATTLE_HUD',
      cursorIndex: 0,
      battleState,
    };

    // Collect all 12 species slugs from both teams for match data loading
    const allSlugs = [
      ...battleState.playerSide.team,
      ...battleState.opponentSide.team,
    ].map(mon => mon.species.toLowerCase());

    await DataLoader.loadMatchData(allSlugs);

    await this.render();
  }

  private async resolveTurn(playerAction: PlayerAction): Promise<void> {
    const bs = this.state.battleState!;
    const aiAction = AIOpponent.pickAction(bs);
    const result = BattleEngine.submitAction(bs, playerAction, aiAction);

    this.lastTurnLog = result.log;
    this.state = {
      ...this.state,
      screen: 'TURN_RESULT',
      cursorIndex: 0,
      battleState: result.nextState,
    };

    await this.render();
  }

  /**
   * Handle forced switch after a faint.
   * Also auto-switches the opponent if their active is fainted (double faint).
   */
  private async resolveSwitch(toIndex: number): Promise<void> {
    let bs = this.state.battleState!;
    const log: TurnLogEntry[] = [];

    // Check if opponent's active is also fainted (double faint) — auto-switch AI
    const opponentSide = bs.opponentSide;
    const opponentActive = opponentSide.team[opponentSide.activeIndex]!;
    if (opponentActive.fainted) {
      // Find first alive non-active opponent Pokemon
      const aiSwitchIndex = opponentSide.team.findIndex(
        (mon, i) => i !== opponentSide.activeIndex && !mon.fainted,
      );
      if (aiSwitchIndex !== -1) {
        const aiResult = BattleEngine.submitSwitch(bs, 'opponent', aiSwitchIndex);
        log.push(...aiResult.log);
        bs = aiResult.nextState;
      }
    }

    // Now submit the player's forced switch
    const result = BattleEngine.submitSwitch(bs, 'player', toIndex);
    log.push(...result.log);
    const nextState = result.nextState;

    this.lastTurnLog = log;
    this.state = {
      ...this.state,
      battleState: nextState,
      cursorIndex: 0,
    };

    // Determine next screen based on resulting phase
    switch (nextState.phase) {
      case 'WAITING_FOR_ACTION':
        this.state = { ...this.state, screen: 'BATTLE_HUD' };
        break;
      case 'WAITING_FOR_SWITCH':
        // Still more switches needed — stay on switch screen
        this.state = { ...this.state, screen: 'SWITCH_SELECT' };
        break;
      case 'BATTLE_OVER':
        this.state = { ...this.state, screen: 'END_SCREEN' };
        break;
    }

    await this.render();
  }

  // ---------------------------------------------------------------------------
  // Render dispatch
  // ---------------------------------------------------------------------------

  private async render(): Promise<void> {
    switch (this.state.screen) {
      case 'MAIN_MENU': {
        const result = renderMainMenu();
        await this.glass.showList(result.items, result.status);
        break;
      }
      case 'BATTLE_HUD': {
        const result = renderBattleHud(this.state.battleState!);
        await this.glass.showText(result.text, result.status);
        break;
      }
      case 'ACTION_MENU': {
        const bs = this.state.battleState!;
        const result = renderActionMenu({ teraUsed: bs.playerSide.teraUsed });
        await this.glass.showList(result.items, result.status);
        break;
      }
      case 'ATTACK_SELECT': {
        const result = renderAttackSelect(this.state.battleState!);
        await this.glass.showList(result.items, result.status);
        break;
      }
      case 'SWITCH_SELECT': {
        const result = renderSwitchSelect(this.state.battleState!, this.forcedSwitch);
        this.switchIndexMap = result.indexMap;
        await this.glass.showList(result.items, result.status);
        break;
      }
      case 'TERA_CONFIRM': {
        const result = renderTeraConfirm(this.state.battleState!);
        await this.glass.showList(result.items, result.status);
        break;
      }
      case 'TURN_RESULT': {
        const result = renderTurnResult(this.lastTurnLog);
        await this.glass.showText(result.text, result.status);
        break;
      }
      case 'END_SCREEN': {
        const result = renderEndScreen(this.state.battleState!.winner!);
        await this.glass.showList(result.items, result.status);
        break;
      }
    }
  }
}
