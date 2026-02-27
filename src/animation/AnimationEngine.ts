/**
 * AnimationEngine -- async sequencer that drives the glass display through
 * Game Boy-style animated turn resolution.
 *
 * Iterates through TurnLogEntry items, playing each with concurrent
 * typewriter text, sprite flash, and HP drain effects using the glass
 * adapter's in-place update methods. Supports tap-to-skip cancellation.
 */

import type {
  TurnLogEntry,
  BattleState,
  ActivePokemon,
} from '../types/battleState.js';
import type { GlassAdapter } from '../types/contracts.js';
import { invertSprite, blankSprite } from './SpriteEffects.js';
import { formatEntry } from '../screens/renderers/turnResultRenderer.js';
import { formatHpBar } from '../screens/renderers/battleHudRenderer.js';
import {
  ANIM,
  CONTAINER_IDS,
  CONTAINER_NAMES,
} from '../config/constants.js';
import { SpriteService } from '../sprites/SpriteService.js';
import { DataLoader } from '../data/DataLoader.js';

type Side = 'player' | 'opponent';
type FlashEffect = 'hit' | 'miss' | 'faint';

/** Get the active Pokemon for a given side. */
function getActiveMon(state: BattleState, side: Side): ActivePokemon {
  const s = side === 'player' ? state.playerSide : state.opponentSide;
  return s.team[s.activeIndex]!;
}

/** Resolve a species slug to its dex number. */
function getDexNum(species: string): number {
  const slug = species.toLowerCase().replace(/[^a-z0-9]/g, '');
  return DataLoader.getPokemon(slug)?.num ?? 0;
}

/** Get the cached sprite base64 for a side's active mon. */
function getSpriteForSide(state: BattleState, side: Side): string | null {
  const mon = getActiveMon(state, side);
  const dexNum = getDexNum(mon.species);
  if (dexNum <= 0) return null;
  // Opponent = front-facing, player = back-facing
  return side === 'opponent'
    ? SpriteService.getBitmapCached(dexNum)
    : SpriteService.getBackBitmapCached(dexNum);
}

export class AnimationEngine {
  private cancelled = false;
  private running = false;

  /** Signal the current animation to end immediately. Idempotent. */
  skip(): void {
    this.cancelled = true;
  }

  /** Returns true while playTurn is executing. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Play an animated sequence for a full turn log.
   *
   * @param log - Ordered events from the resolved turn.
   * @param prevState - BattleState BEFORE the turn (HP "from" values).
   * @param nextState - BattleState AFTER the turn (HP "to" values).
   * @param glass - Glass adapter for display updates.
   */
  async playTurn(
    log: TurnLogEntry[],
    prevState: BattleState,
    nextState: BattleState,
    glass: GlassAdapter,
  ): Promise<void> {
    this.cancelled = false;
    this.running = true;

    try {
      for (let i = 0; i < log.length; i++) {
        if (this.cancelled) break;

        await this.playEntry(log[i]!, prevState, nextState, glass);

        if (this.cancelled) break;

        // Pause between entries (skip pause after last entry)
        if (i < log.length - 1) {
          await this.delay(ANIM.ENTRY_PAUSE_MS);
        }
      }
    } finally {
      this.running = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Entry orchestration
  // ---------------------------------------------------------------------------

  private async playEntry(
    entry: TurnLogEntry,
    prevState: BattleState,
    nextState: BattleState,
    glass: GlassAdapter,
  ): Promise<void> {
    const fullText = formatEntry(entry);

    // Shared mutable state for concurrent text + HP updates
    let currentText = '';
    let hpStatus = '';

    const updateDisplay = async (): Promise<void> => {
      await glass.updateText(currentText, { left: hpStatus, right: '' });
    };

    const tasks: Promise<void>[] = [];

    // Typewriter text -- always runs
    tasks.push(this.typewriterText(fullText, glass, (text) => {
      currentText = text;
    }, () => updateDisplay()));

    if (entry.kind === 'DAMAGE') {
      // Damage: target is the opposite side of the actor
      const targetSide: Side = entry.actor === 'player' ? 'opponent' : 'player';

      tasks.push(this.spriteFlash(targetSide, 'hit', prevState, glass));
      tasks.push(this.hpDrain(
        targetSide, entry, prevState, glass,
        (status) => { hpStatus = status; },
        () => updateDisplay(),
      ));
    } else if (entry.kind === 'MISS') {
      // Miss: attacker flashes (disappear/reappear)
      tasks.push(this.spriteFlash(entry.actor, 'miss', prevState, glass));
    } else if (entry.kind === 'FAINT') {
      // Faint: determine which side fainted by matching pokemon name
      const faintedName = entry.detail.pokemon as string;
      const faintedSide = this.findFaintedSide(faintedName, prevState);
      if (faintedSide) {
        tasks.push(this.spriteFlash(faintedSide, 'faint', prevState, glass));
      }
    }

    await Promise.all(tasks);
  }

  // ---------------------------------------------------------------------------
  // Typewriter text effect
  // ---------------------------------------------------------------------------

  private async typewriterText(
    fullText: string,
    glass: GlassAdapter,
    setText: (text: string) => void,
    triggerUpdate: () => Promise<void>,
  ): Promise<void> {
    for (let i = 1; i <= fullText.length; i++) {
      if (this.cancelled) break;

      setText(fullText.slice(0, i));
      await triggerUpdate();

      // Punctuation gets a longer pause
      const ch = fullText[i - 1];
      const pauseMs = (ch === '.' || ch === '!' || ch === '?')
        ? ANIM.PUNCTUATION_PAUSE_MS
        : ANIM.CHAR_DELAY_MS;

      await this.delay(pauseMs);
    }
  }

  // ---------------------------------------------------------------------------
  // Sprite flash effect
  // ---------------------------------------------------------------------------

  private async spriteFlash(
    side: Side,
    effect: FlashEffect,
    state: BattleState,
    glass: GlassAdapter,
  ): Promise<void> {
    const normal = getSpriteForSide(state, side);
    if (!normal) return; // No sprite cached, skip flash

    const inverted = await invertSprite(normal);
    const blank = blankSprite();

    const containerID = side === 'opponent'
      ? CONTAINER_IDS.oppSprite
      : CONTAINER_IDS.playerSprite;
    const containerName = side === 'opponent'
      ? CONTAINER_NAMES.oppSprite
      : CONTAINER_NAMES.playerSprite;

    const updateImg = async (data: string): Promise<void> => {
      await glass.updateImage(containerID, containerName, data);
    };

    if (effect === 'hit') {
      // 2 cycles: invert -> restore -> blank -> restore
      for (let c = 0; c < ANIM.HIT_FLASH_CYCLES; c++) {
        if (this.cancelled) break;
        await updateImg(inverted);
        await this.delay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(normal);
        await this.delay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(blank);
        await this.delay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(normal);
        await this.delay(ANIM.FLASH_FRAME_MS);
      }
    } else if (effect === 'miss') {
      // 1 cycle: blank -> restore
      if (!this.cancelled) {
        await updateImg(blank);
        await this.delay(ANIM.FLASH_FRAME_MS);
      }
      if (!this.cancelled) {
        await updateImg(normal);
        await this.delay(ANIM.FLASH_FRAME_MS);
      }
    } else if (effect === 'faint') {
      // 3 cycles same as hit, then permanent blank
      for (let c = 0; c < ANIM.FAINT_FLASH_CYCLES; c++) {
        if (this.cancelled) break;
        await updateImg(inverted);
        await this.delay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(normal);
        await this.delay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(blank);
        await this.delay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(normal);
        await this.delay(ANIM.FLASH_FRAME_MS);
      }
      // Final blank -- sprite removed permanently
      await updateImg(blank);
    }
  }

  // ---------------------------------------------------------------------------
  // HP drain effect
  // ---------------------------------------------------------------------------

  private async hpDrain(
    side: Side,
    entry: TurnLogEntry,
    prevState: BattleState,
    glass: GlassAdapter,
    setHpStatus: (status: string) => void,
    triggerUpdate: () => Promise<void>,
  ): Promise<void> {
    const damage = entry.detail.damage as number;
    if (typeof damage !== 'number' || damage <= 0) return;

    const mon = getActiveMon(prevState, side);
    const startHp = mon.currentHp;
    const endHp = Math.max(0, startHp - damage);
    const actualDamage = startHp - endHp;
    const steps = Math.min(actualDamage, ANIM.MAX_HP_STEPS);

    if (steps <= 0) return;

    for (let i = 0; i <= steps; i++) {
      if (this.cancelled) break;

      const currentHp = Math.round(startHp - (actualDamage * i / steps));

      // Create a temporary mon with interpolated HP for formatHpBar
      const tempMon: ActivePokemon = {
        ...mon,
        currentHp,
        fainted: currentHp <= 0,
      };

      setHpStatus(formatHpBar(tempMon));
      await triggerUpdate();
      await this.delay(ANIM.HP_FRAME_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Find which side a fainted Pokemon belongs to by name match. */
  private findFaintedSide(pokemonName: string, state: BattleState): Side | null {
    const playerMon = getActiveMon(state, 'player');
    if (playerMon.name === pokemonName) return 'player';

    const oppMon = getActiveMon(state, 'opponent');
    if (oppMon.name === pokemonName) return 'opponent';

    return null;
  }

  /** Cancellation-aware delay. Resolves immediately if cancelled. */
  private delay(ms: number): Promise<void> {
    return new Promise((r) => {
      if (this.cancelled) { r(); return; }
      setTimeout(r, ms);
    });
  }
}
