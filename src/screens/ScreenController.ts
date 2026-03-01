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
import { SimBattleAdapter } from '../battle/SimBattleAdapter.js';
import { SimAIOpponent } from '../battle/SimAIOpponent.js';
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
import { blankSprite } from '../animation/SpriteEffects.js';
import { ANIM } from '../config/constants.js';
import { SpeedConfig } from '../config/SpeedConfig.js';

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
    // Bootstrap startup page with minimal single text container
    await this.glass.bootstrapStartup();
    // Now render the actual main menu (uses rebuildPageContainer)
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
      case 1: // "Battle Speed" — cycle preset inline, re-render with cursor at 1
        SpeedConfig.cycle();
        this.state = { ...this.state, screen: 'MAIN_MENU', cursorIndex: 1 };
        await this.render();
        break;
      case 2: // "About/Credits" — show credits text, tap anywhere returns to menu
        await this.glass.showText(
          'Pokemon Showdown G2\nGen 9 Random Battles\non Even Realities G2\n\nBuilt with @pkmn/sim\n\nTap to return',
          { left: 'About', right: '' },
        );
        // State stays MAIN_MENU — next tap re-renders the menu
        this.state = { ...this.state, screen: 'MAIN_MENU', cursorIndex: 0 };
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
    if (toIndex === undefined || toIndex < 0) return;

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
    try {
      await this.startNewBattleInner();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error('[BATTLE] startNewBattle failed:', err);
      console.error('[BATTLE] Stack:', err.stack);
      const stackLines = (err.stack ?? '').split('\n').slice(0, 5).join('\n');
      await this.glass.showMessage(`Error:\n${err.message}\n${stackLines}`);
    }
  }

  private async startNewBattleInner(): Promise<void> {
    await this.glass.showMessage('Generating teams...');

    console.log('[BATTLE] Step 1: calling SimBattleAdapter.startBattle()...');
    let battleState: BattleState;
    let initialLog: TurnLogEntry[] = [];
    try {
      const result = SimBattleAdapter.startBattle();
      battleState = result.state;
      initialLog = result.initialLog;
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error('[BATTLE] startBattle() threw:', err);
      console.error('[BATTLE] Stack:', err.stack);
      // Show truncated stack on glasses for debugging
      const stackLines = (err.stack ?? '').split('\n').slice(0, 6).join('\n');
      await this.glass.showMessage(`TeamGen:\n${err.message}\n${stackLines}`);
      return; // Don't rethrow — we've already shown the error
    }
    console.log('[BATTLE] Step 2: teams generated OK');
    console.log('[BATTLE] Teams generated:', battleState.playerSide.team.map(m => m.name), 'vs', battleState.opponentSide.team.map(m => m.name));
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

    console.log('[BATTLE] Step 3: loading match data for:', allSlugs);
    try {
      await DataLoader.loadMatchData(allSlugs);
    } catch (e) {
      console.error('[BATTLE] loadMatchData threw:', e);
      throw new Error(`Match data failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log('[BATTLE] Step 4: match data loaded, showing sprites msg...');
    await this.glass.showMessage('Loading sprites...');

    // Collect dex numbers for sprite loading and refresh tracking
    // Handles forme variants (e.g. "Gastrodon-East") via baseSpecies fallback
    const getDexNum = (species: string): number => {
      const slug = species.toLowerCase().replace(/[^a-z0-9]/g, '');
      const exact = DataLoader.getPokemon(slug);
      if (exact?.num) return exact.num;

      // Fallback: strip forme suffix (everything after first hyphen)
      const hyphenIdx = species.indexOf('-');
      if (hyphenIdx > 0) {
        const baseSlug = species.slice(0, hyphenIdx).toLowerCase().replace(/[^a-z0-9]/g, '');
        const base = DataLoader.getPokemon(baseSlug);
        if (base?.num) return base.num;
      }

      return 0;
    };

    this.playerDexNums = battleState.playerSide.team
      .map(mon => getDexNum(mon.species))
      .filter(n => n > 0);
    this.opponentDexNums = battleState.opponentSide.team
      .map(mon => getDexNum(mon.species))
      .filter(n => n > 0);

    // Fetch and cache bitmap sprites — front for opponents, back for player
    console.log('[SPRITES] Fetching sprites for opp:', this.opponentDexNums, 'player:', this.playerDexNums);
    try {
      await SpriteService.fetchAndCacheBitmaps(this.opponentDexNums, this.playerDexNums);
    } catch (e) {
      console.error('[SPRITES] fetchAndCacheBitmaps threw:', e);
      // Continue without sprites — battle still works
    }

    // Debug: check what was cached
    for (const num of this.opponentDexNums) {
      const cached = SpriteService.getBitmapCached(num);
      console.log(`[SPRITES] opp dex=${num} cached=${cached ? cached.length + ' bytes BMP' : 'NULL'}`);
    }
    for (const num of this.playerDexNums) {
      const cached = SpriteService.getBackBitmapCached(num);
      console.log(`[SPRITES] player dex=${num} back cached=${cached ? cached.length + ' bytes BMP' : 'NULL'}`);
    }

    // Step 5: Play opening intro scene
    //   Order: player switch-in → opponent switch-in → abilities/weather/terrain
    if (initialLog.length > 0 && !SpeedConfig.isInstant()) {
      console.log('[BATTLE] Step 5: playing opening intro:', initialLog.length, 'entries');

      // Partition and reorder: player switches, opponent switches, then everything else
      const playerSwitches = initialLog.filter(e => e.kind === 'SWITCH' && e.actor === 'player');
      const oppSwitches = initialLog.filter(e => e.kind === 'SWITCH' && e.actor === 'opponent');
      const rest = initialLog.filter(e => e.kind !== 'SWITCH');
      const orderedLog = [...playerSwitches, ...oppSwitches, ...rest];

      // Set up battle HUD layout with blank text and blank sprites — image
      // containers must exist for switch animations to target via updateImage().
      const blank = blankSprite();
      await this.glass.showBattleHud('', '', { left: '', right: '' }, blank, blank);

      await this.animationEngine.playTurn(
        orderedLog,
        battleState,
        battleState,
        this.glass,
      );
      await this.delay(ANIM.POST_ANIM_DELAY_MS);
    }

    // Step 6: Now show the interactive battle HUD with sprites
    console.log('[BATTLE] Step 6: rendering battle HUD...');
    await this.render();
    console.log('[BATTLE] Step 7: render complete!');
  }

  private async resolveTurn(playerAction: PlayerAction): Promise<void> {
    const prevState = this.state.battleState!;
    const battle = SimBattleAdapter.getBattle()!;
    const aiAction = SimAIOpponent.pickAction(battle);
    const result = SimBattleAdapter.submitAction(prevState, playerAction, aiAction);

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

    // Step 2: Play animated sequence (completes instantly when SpeedConfig.isInstant())
    await this.animationEngine.playTurn(
      result.log,
      prevState,
      result.nextState,
      this.glass,
    );

    // Instant mode: show turn result text, wait for tap to advance
    if (SpeedConfig.isInstant()) {
      const turnResult = renderTurnResult(result.log, result.nextState);
      await this.glass.showText(turnResult.text, turnResult.status);
      this.state = { ...this.state, screen: 'TURN_RESULT', cursorIndex: 0 };
      return;
    }

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
   * Mirrors resolveTurn's animation pattern: prevState HUD -> playTurn -> nextState HUD.
   */
  private async resolveSwitch(toIndex: number): Promise<void> {
    const prevState = this.state.battleState!;
    const log: TurnLogEntry[] = [];
    const battle = SimBattleAdapter.getBattle()!;

    let bs: BattleState;

    // Check if opponent's active is also fainted (double faint)
    const opponentSide = prevState.opponentSide;
    const opponentActive = opponentSide.team[opponentSide.activeIndex]!;
    if (opponentActive.fainted) {
      // AI picks its switch target
      const aiSwitchIndex = SimAIOpponent.pickSwitch(battle);
      // Submit both switches together via the aiSwitchIndex parameter
      const result = SimBattleAdapter.submitSwitch(prevState, 'player', toIndex, aiSwitchIndex);
      log.push(...result.log);
      bs = result.nextState;
    } else {
      // Only player needs to switch
      const result = SimBattleAdapter.submitSwitch(prevState, 'player', toIndex);
      log.push(...result.log);
      bs = result.nextState;
    }

    this.lastTurnLog = log;
    this.state = {
      ...this.state,
      screen: 'ANIMATING',
      battleState: bs,
      cursorIndex: 0,
    };

    // Step 1: Show HUD with prevState (animation drains from correct starting HP)
    const prevHud = renderBattleHud(prevState);
    await this.glass.showBattleHud(
      prevHud.oppText, prevHud.playerText, prevHud.status,
      prevHud.oppSprite, prevHud.playerSprite,
    );

    // Step 2: Play switch animation (completes instantly when SpeedConfig.isInstant())
    await this.animationEngine.playTurn(log, prevState, bs, this.glass);

    // Instant mode: show switch log text, wait for tap to advance
    if (SpeedConfig.isInstant()) {
      const turnResult = renderTurnResult(log, bs);
      await this.glass.showText(turnResult.text, turnResult.status);
      this.state = { ...this.state, screen: 'TURN_RESULT', cursorIndex: 0 };
      return;
    }

    // Step 3: Show HUD with final state
    const finalHud = renderBattleHud(bs);
    await this.glass.showBattleHud(
      finalHud.oppText, finalHud.playerText, finalHud.status,
      finalHud.oppSprite, finalHud.playerSprite,
    );

    // Step 4: Brief pause then transition
    await this.delay(ANIM.POST_ANIM_DELAY_MS);
    await this.transitionAfterTurn(bs);
  }

  private async transitionAfterTurn(nextState: BattleState): Promise<void> {
    switch (nextState.phase) {
      case 'WAITING_FOR_ACTION':
        this.state = { ...this.state, screen: 'BATTLE_HUD', cursorIndex: 0 };
        await this.render();
        break;
      case 'WAITING_FOR_SWITCH': {
        // Check which side(s) actually need to switch
        const battle = SimBattleAdapter.getBattle()!;
        const p1NeedsSwitch = battle.sides[0]?.activeRequest?.forceSwitch?.some(Boolean);
        const p2NeedsSwitch = battle.sides[1]?.activeRequest?.forceSwitch?.some(Boolean);

        if (p1NeedsSwitch) {
          // Player needs to switch — show switch menu
          this.forcedSwitch = true;
          this.state = { ...this.state, screen: 'SWITCH_SELECT', cursorIndex: 0 };
          await this.render();
        } else if (p2NeedsSwitch) {
          // Only opponent needs to switch — auto-handle with AI
          const aiSwitchIndex = SimAIOpponent.pickSwitch(battle);
          const result = SimBattleAdapter.submitSwitch(nextState, 'opponent', aiSwitchIndex);
          this.lastTurnLog = result.log;
          this.state = {
            ...this.state,
            battleState: result.nextState,
            cursorIndex: 0,
          };

          // Play switch animation for opponent
          const prevHud = renderBattleHud(nextState);
          await this.glass.showBattleHud(
            prevHud.oppText, prevHud.playerText, prevHud.status,
            prevHud.oppSprite, prevHud.playerSprite,
          );
          await this.animationEngine.playTurn(result.log, nextState, result.nextState, this.glass);
          const finalHud = renderBattleHud(result.nextState);
          await this.glass.showBattleHud(
            finalHud.oppText, finalHud.playerText, finalHud.status,
            finalHud.oppSprite, finalHud.playerSprite,
          );
          await this.delay(ANIM.POST_ANIM_DELAY_MS);

          // Recurse — the new state might need further transitions
          await this.transitionAfterTurn(result.nextState);
        }
        break;
      }
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
        console.log('[RENDER] BATTLE_HUD oppSprite:', result.oppSprite ? `${result.oppSprite.length} bytes BMP` : 'NONE');
        console.log('[RENDER] BATTLE_HUD playerSprite:', result.playerSprite ? `${result.playerSprite.length} bytes BMP` : 'NONE');
        try {
          await this.glass.showBattleHud(
            result.oppText,
            result.playerText,
            result.status,
            result.oppSprite,
            result.playerSprite,
          );
        } catch (e: unknown) {
          console.error('[RENDER] showBattleHud threw:', e);
          // Retry without sprites to see if sprites are the issue
          console.log('[RENDER] Retrying WITHOUT sprites...');
          await this.glass.showBattleHud(
            result.oppText,
            result.playerText,
            result.status,
          );
        }
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
        const result = renderTurnResult(this.lastTurnLog, this.state.battleState ?? undefined);
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
    // Sprite — with baseSpecies fallback for forme variants
    const spriteEl = document.getElementById(`${prefix}-sprite`) as HTMLImageElement | null;
    if (spriteEl) {
      const slug = species.toLowerCase().replace(/[^a-z0-9]/g, '');
      let entry = DataLoader.getPokemon(slug);
      if (!entry?.num) {
        const hyphenIdx = species.indexOf('-');
        if (hyphenIdx > 0) {
          const baseSlug = species.slice(0, hyphenIdx).toLowerCase().replace(/[^a-z0-9]/g, '');
          entry = DataLoader.getPokemon(baseSlug);
        }
      }
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
      case 'MOVE_USE':
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
      case 'MOVE_USE':
        return `${actor}'s ${String(d['pokemon'] ?? '?')} used ${String(d['move'] ?? '?')}`;
      case 'DAMAGE':
        return `${String(d['damage'] ?? '?')} damage`;
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
