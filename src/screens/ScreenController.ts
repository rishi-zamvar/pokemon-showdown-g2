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
import { AnimationEngine } from '../animation/AnimationEngine.js';
import { renderMainMenu } from './renderers/mainMenuRenderer.js';
import { renderBattleHud } from './renderers/battleHudRenderer.js';
import { renderActionMenu } from './renderers/actionMenuRenderer.js';
import { renderAttackSelect } from './renderers/attackSelectRenderer.js';
import { renderSwitchSelect } from './renderers/switchSelectRenderer.js';
import { renderTeraConfirm } from './renderers/teraConfirmRenderer.js';
import { renderTurnResult } from './renderers/turnResultRenderer.js';
import { renderEndScreen } from './renderers/endScreenRenderer.js';
import { renderSpriteRefresh } from './renderers/spriteRefreshRenderer.js';
import { SpriteService } from '../sprites/SpriteService.js';
import { ANIM } from '../config/constants.js';

export class ScreenController {
  private readonly glass: GlassAdapter;
  private readonly animationEngine = new AnimationEngine();
  private state: ScreenState;
  private lastTurnLog: TurnLogEntry[] = [];
  private switchIndexMap: number[] = [];
  private forcedSwitch = false;
  private teraQueued = false;
  private playerDexNums: number[] = [];
  private opponentDexNums: number[] = [];

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
    // Animation gesture blocking (ANIM-05, ANIM-06)
    if (this.animationEngine.isRunning()) {
      if (event.kind === 'TAP') {
        this.animationEngine.skip();
      }
      // All other gestures swallowed during animation
      return;
    }

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
        await this.handleMainMenu(idx);
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

      case 'SPRITE_REFRESH':
        await this.handleSpriteRefresh(idx);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Screen-specific tap handlers
  // ---------------------------------------------------------------------------

  private async handleMainMenu(idx: number): Promise<void> {
    switch (idx) {
      case 0: // "Enter Battle"
        await this.startNewBattle();
        break;
      case 1: // "Refresh Sprites"
        this.state = { ...this.state, screen: 'SPRITE_REFRESH', cursorIndex: 0 };
        await this.render();
        break;
    }
  }

  private async handleSpriteRefresh(idx: number): Promise<void> {
    switch (idx) {
      case 0: // "< Back"
        this.state = { ...this.state, screen: 'MAIN_MENU', cursorIndex: 0 };
        await this.render();
        break;
      case 1: // "Mine"
        SpriteService.clearBitmapCache(this.playerDexNums);
        await this.glass.showMessage('Player sprites cleared!');
        this.state = { ...this.state, screen: 'MAIN_MENU', cursorIndex: 0 };
        await this.render();
        break;
      case 2: // "Theirs"
        SpriteService.clearBitmapCache(this.opponentDexNums);
        await this.glass.showMessage('Opponent sprites cleared!');
        this.state = { ...this.state, screen: 'MAIN_MENU', cursorIndex: 0 };
        await this.render();
        break;
      case 3: // "Both"
        SpriteService.clearAllBitmapCache();
        await this.glass.showMessage('All sprites cleared!');
        this.state = { ...this.state, screen: 'MAIN_MENU', cursorIndex: 0 };
        await this.render();
        break;
    }
  }

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
    await this.glass.showMessage('Loading sprites...');

    // Collect dex numbers for sprite loading and refresh tracking
    const getDexNum = (species: string): number => {
      const slug = species.toLowerCase().replace(/[^a-z0-9]/g, '');
      const entry = DataLoader.getPokemon(slug);
      return entry?.num ?? 0;
    };

    this.playerDexNums = battleState.playerSide.team
      .map(mon => getDexNum(mon.species))
      .filter(n => n > 0);
    this.opponentDexNums = battleState.opponentSide.team
      .map(mon => getDexNum(mon.species))
      .filter(n => n > 0);

    // Fetch and cache bitmap sprites — front for opponents, back for player
    await SpriteService.fetchAndCacheBitmaps(this.opponentDexNums, this.playerDexNums);

    await this.render();
  }

  private async resolveTurn(playerAction: PlayerAction): Promise<void> {
    const prevState = this.state.battleState!;
    const aiAction = AIOpponent.pickAction(prevState);
    const result = BattleEngine.submitAction(prevState, playerAction, aiAction);

    this.lastTurnLog = result.log;
    this.state = {
      ...this.state,
      screen: 'ANIMATING',
      cursorIndex: 0,
      battleState: result.nextState,
    };

    // Step 1: Show battle HUD layout with sprites (uses PREVIOUS state for current HP display)
    const hudResult = renderBattleHud(prevState);
    await this.glass.showBattleHud(
      hudResult.oppText,
      hudResult.playerText,
      { left: 'Battle', right: '' },
      hudResult.oppSprite,
      hudResult.playerSprite,
    );

    // Step 2: Play animated sequence
    await this.animationEngine.playTurn(
      result.log,
      prevState,
      result.nextState,
      this.glass,
    );

    // Step 3: Write final state to display (cleanup after animation or skip)
    const finalHud = renderBattleHud(result.nextState);
    await this.glass.showBattleHud(
      finalHud.oppText,
      finalHud.playerText,
      finalHud.status,
      finalHud.oppSprite,
      finalHud.playerSprite,
    );

    // Step 4: Brief pause before transition
    await this.delay(ANIM.POST_ANIM_DELAY_MS);

    // Step 5: Auto-transition based on resulting battle phase
    await this.transitionAfterTurn(result.nextState);
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

  private async transitionAfterTurn(nextState: BattleState): Promise<void> {
    switch (nextState.phase) {
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Render dispatch
  // ---------------------------------------------------------------------------

  private async render(): Promise<void> {
    switch (this.state.screen) {
      case 'MAIN_MENU': {
        this.hideCompanion();
        const result = renderMainMenu();
        await this.glass.showList(result.items, result.status);
        break;
      }
      case 'BATTLE_HUD': {
        const result = renderBattleHud(this.state.battleState!);
        await this.glass.showBattleHud(
          result.oppText,
          result.playerText,
          result.status,
          result.oppSprite,
          result.playerSprite,
        );
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
      case 'SPRITE_REFRESH': {
        const result = renderSpriteRefresh();
        await this.glass.showList(result.items, result.status);
        break;
      }
      case 'ANIMATING':
        // Animation engine handles rendering via in-place updates
        break;
    }

    if (this.state.battleState) {
      this.updatePhoneCompanion();
    }
  }

  // ---------------------------------------------------------------------------
  // Phone companion display
  // ---------------------------------------------------------------------------

  /** Hide the companion panel and restore the status screen. */
  private hideCompanion(): void {
    const companion = document.getElementById('battle-companion');
    const status = document.getElementById('status-screen');
    if (companion) companion.classList.add('hidden');
    if (status) status.classList.remove('hidden');
  }

  /** Update the phone's HTML companion display with current battle state. */
  private updatePhoneCompanion(): void {
    const companion = document.getElementById('battle-companion');
    const bs = this.state.battleState;
    if (!companion || !bs) return;

    // Show companion, hide status screen
    companion.classList.remove('hidden');
    const status = document.getElementById('status-screen');
    if (status) status.classList.add('hidden');

    const header = document.getElementById('companion-header');

    // Check for battle end
    if (bs.winner) {
      if (header) header.textContent = bs.winner === 'player' ? 'Victory!' : 'Defeat';
    } else {
      if (header) header.textContent = `Battle — Turn ${bs.turnCount}`;
    }

    // Update opponent Pokemon
    const oppMon = bs.opponentSide.team[bs.opponentSide.activeIndex]!;
    this.updatePokemonSlot(
      oppMon.species,
      oppMon.name,
      oppMon.currentHp,
      oppMon.stats.hp,
      oppMon.fainted,
      'opp',
    );

    // Update player Pokemon
    const playerMon = bs.playerSide.team[bs.playerSide.activeIndex]!;
    this.updatePokemonSlot(
      playerMon.species,
      playerMon.name,
      playerMon.currentHp,
      playerMon.stats.hp,
      playerMon.fainted,
      'player',
    );

    // Update companion log with last turn entries
    const logContainer = document.getElementById('companion-log');
    if (logContainer && this.lastTurnLog.length > 0) {
      logContainer.innerHTML = '';
      for (const entry of this.lastTurnLog) {
        const div = document.createElement('div');
        div.className = 'log-line ' + this.logEntryClass(entry.kind);
        div.textContent = this.logEntryText(entry);
        logContainer.appendChild(div);
      }
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  }

  /** Update a single Pokemon slot (opponent or player) in the companion. */
  private updatePokemonSlot(
    species: string,
    displayName: string,
    currentHp: number,
    maxHp: number,
    fainted: boolean,
    prefix: 'opp' | 'player',
  ): void {
    // Sprite
    const spriteEl = document.getElementById(`${prefix}-sprite`) as HTMLImageElement | null;
    if (spriteEl) {
      const slug = species.toLowerCase().replace(/[^a-z0-9]/g, '');
      const entry = DataLoader.getPokemon(slug);
      const num = entry?.num ?? 0;
      if (num > 0) {
        spriteEl.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${num}.png`;
        spriteEl.alt = displayName;
      }
    }

    // Name
    const nameEl = document.getElementById(`${prefix}-name`);
    if (nameEl) nameEl.textContent = displayName;

    // HP
    const hpPct = fainted ? 0 : Math.max(1, Math.round((currentHp / maxHp) * 100));
    const hpColor = hpPct > 50 ? '#4cd964' : hpPct > 25 ? '#f5a623' : '#ff3b30';

    const hpBar = document.getElementById(`${prefix}-hp-bar`);
    if (hpBar) {
      hpBar.style.width = `${hpPct}%`;
      hpBar.style.background = hpColor;
    }

    const hpText = document.getElementById(`${prefix}-hp-text`);
    if (hpText) hpText.textContent = `${currentHp}/${maxHp} (${hpPct}%)`;
  }

  /** Map log entry kind to CSS class for companion log. */
  private logEntryClass(kind: string): string {
    switch (kind) {
      case 'DAMAGE':
      case 'FAINT':
      case 'LOSS':
        return 'damage';
      case 'STATUS_INFLICT':
      case 'STATUS_TICK':
      case 'MISS':
      case 'PARALYSIS_SKIP':
      case 'FROZEN':
      case 'ASLEEP':
      case 'PP_OUT':
        return 'info';
      case 'SWITCH':
      case 'TERA':
      case 'WIN':
        return 'good';
      default:
        return '';
    }
  }

  /** Format a log entry as human-readable text. */
  private logEntryText(entry: import('../types/battleState.js').TurnLogEntry): string {
    const d = entry.detail;
    const actor = entry.actor === 'player' ? 'You' : 'Foe';
    switch (entry.kind) {
      case 'DAMAGE':
        return `${actor}'s ${String(d['target'] ?? '?')} took ${String(d['damage'] ?? '?')} damage`;
      case 'MISS':
        return `${actor}'s attack missed!`;
      case 'FAINT':
        return `${actor}'s ${String(d['pokemon'] ?? '?')} fainted!`;
      case 'STATUS_INFLICT':
        return `${String(d['pokemon'] ?? '?')} was ${String(d['status'] ?? 'affected')}!`;
      case 'STATUS_TICK':
        return `${String(d['pokemon'] ?? '?')} is hurt by ${String(d['status'] ?? 'status')}`;
      case 'SWITCH':
        return `${actor} sent out ${String(d['pokemon'] ?? '?')}`;
      case 'TERA':
        return `${actor}'s ${String(d['pokemon'] ?? '?')} terastallized to ${String(d['type'] ?? '?')}!`;
      case 'WIN':
        return 'You won the battle!';
      case 'LOSS':
        return 'You lost the battle...';
      case 'PP_OUT':
        return `${String(d['move'] ?? '?')} has no PP left!`;
      case 'PARALYSIS_SKIP':
        return `${String(d['pokemon'] ?? '?')} is paralyzed and can't move!`;
      case 'FROZEN':
        return `${String(d['pokemon'] ?? '?')} is frozen solid!`;
      case 'ASLEEP':
        return `${String(d['pokemon'] ?? '?')} is fast asleep!`;
      default:
        return JSON.stringify(d);
    }
  }
}
