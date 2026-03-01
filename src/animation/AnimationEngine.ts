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
  SPRITE_CONFIG,
} from '../config/constants.js';
import { SpriteService } from '../sprites/SpriteService.js';
import { DataLoader } from '../data/DataLoader.js';
import { SpeedConfig } from '../config/SpeedConfig.js';
import {
  getPokeballFrame,
  getFilledSquareFrame,
  getCheckboxFrame,
  getSubstituteFrame,
} from './AnimationFrames.js';
import { encodeBmp } from '../sprites/SpriteBmpEncoder.js';
import { renderTextBox } from './TextBoxRenderer.js';

type Side = 'player' | 'opponent';
type FlashEffect = 'hit' | 'miss' | 'faint';

/** Get the active Pokemon for a given side. */
function getActiveMon(state: BattleState, side: Side): ActivePokemon {
  const s = side === 'player' ? state.playerSide : state.opponentSide;
  return s.team[s.activeIndex]!;
}

/** Resolve a species slug to its dex number.
 *  Handles forme variants like "Gastrodon-East" by falling back to base species.
 *  Priority: exact match > base species (before first hyphen) > 0 (not found).
 */
function getDexNum(species: string): number {
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
}

/** Get the cached sprite BMP Uint8Array for a side's active mon. */
function getSpriteForSide(state: BattleState, side: Side): Uint8Array | null {
  const mon = getActiveMon(state, side);
  const dexNum = getDexNum(mon.species);
  if (dexNum <= 0) return null;
  // Opponent = front-facing, player = back-facing
  return side === 'opponent'
    ? SpriteService.getBitmapCached(dexNum)
    : SpriteService.getBackBitmapCached(dexNum);
}

/**
 * Generate a shifted version of a 1-bit BMP sprite.
 * Reads pixels from the original BMP, shifts them by `offsetX` pixels to the
 * right within the same canvas, then re-encodes to BMP via encodeBmp.
 */
function shiftSpriteBmp(original: Uint8Array, offsetX: number, size: number): Uint8Array {
  const BMP_HEADER = 62;
  const rowStride = Math.ceil(Math.ceil(size / 8) / 4) * 4;

  // Decode BMP pixel data into a row-major pixel array (top-down)
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y; // BMP is bottom-up
    const rowOffset = BMP_HEADER + y * rowStride;
    for (let x = 0; x < size; x++) {
      const byteIdx = rowOffset + Math.floor(x / 8);
      const bitIdx = 7 - (x % 8);
      if (original[byteIdx]! & (1 << bitIdx)) {
        pixels[srcRow * size + x] = 1;
      }
    }
  }

  // Shift pixels right by offsetX
  const shifted = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcX = x - offsetX;
      if (srcX >= 0 && srcX < size) {
        shifted[y * size + x] = pixels[y * size + srcX]!;
      }
    }
  }

  return encodeBmp(shifted, size, size);
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
          await this.scaledDelay(ANIM.ENTRY_PAUSE_MS);
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
    const fullText = formatEntry(entry, prevState);

    // Shared mutable state for concurrent text + HP updates
    let currentText = '';
    let hpStatus = '';

    const updateDisplay = async (): Promise<void> => {
      await glass.updateText(renderTextBox(currentText), { left: hpStatus, right: '' });
    };

    // SWITCH: animation runs BEFORE text (sequential, not concurrent)
    if (entry.kind === 'SWITCH') {
      const switchedSide: Side = entry.actor;
      await this.switchAnimation(switchedSide, nextState, glass);
      await this.typewriterText(fullText, glass, (text) => {
        currentText = text;
      }, () => updateDisplay());
      return;
    }

    // TRANSFORM: flash animation + sprite change, then text
    if (entry.kind === 'TRANSFORM') {
      await this.transformAnimation(entry.actor, entry, nextState, glass);
      await this.typewriterText(fullText, glass, (text) => {
        currentText = text;
      }, () => updateDisplay());
      return;
    }

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
    } else if (entry.kind === 'HEAL') {
      // Heal: reverse HP drain (bar fills up)
      const healSide: Side = entry.actor;
      tasks.push(this.hpHeal(
        healSide, prevState, nextState, glass,
        (status) => { hpStatus = status; },
        () => updateDisplay(),
      ));
    } else if (entry.kind === 'STATUS_TICK') {
      // Status tick damage: flash the affected pokemon
      const tickSide: Side = entry.actor;
      const tickDamage = entry.detail.targetHp as number | undefined;
      if (tickDamage !== undefined && tickDamage >= 0) {
        tasks.push(this.spriteFlash(tickSide, 'hit', prevState, glass));
      }
    } else if (entry.kind === 'VOLATILE_START') {
      const volatile = String(entry.detail.volatile ?? '').toLowerCase();
      if (volatile === 'substitute') {
        tasks.push(this.swapSprite(entry.actor, getSubstituteFrame(), glass));
      }
    } else if (entry.kind === 'VOLATILE_END') {
      const volatile = String(entry.detail.volatile ?? '').toLowerCase();
      if (volatile === 'substitute') {
        // Restore the real sprite
        const realSprite = getSpriteForSide(nextState, entry.actor);
        if (realSprite) {
          tasks.push(this.swapSprite(entry.actor, realSprite, glass));
        }
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

      await this.scaledDelay(pauseMs);
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

    const inverted = invertSprite(normal);
    const blank = blankSprite();

    const containerID = side === 'opponent'
      ? CONTAINER_IDS.oppSprite
      : CONTAINER_IDS.playerSprite;
    const containerName = side === 'opponent'
      ? CONTAINER_NAMES.oppSprite
      : CONTAINER_NAMES.playerSprite;

    const updateImg = async (data: Uint8Array): Promise<void> => {
      await glass.updateImage(containerID, containerName, data);
    };

    if (effect === 'hit') {
      // 2 cycles: invert -> restore -> blank -> restore
      for (let c = 0; c < this.scaledFrameCount(ANIM.HIT_FLASH_CYCLES); c++) {
        if (this.cancelled) break;
        await updateImg(inverted);
        await this.scaledDelay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(normal);
        await this.scaledDelay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(blank);
        await this.scaledDelay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(normal);
        await this.scaledDelay(ANIM.FLASH_FRAME_MS);
      }
    } else if (effect === 'miss') {
      // 1 cycle: blank -> restore
      if (!this.cancelled) {
        await updateImg(blank);
        await this.scaledDelay(ANIM.FLASH_FRAME_MS);
      }
      if (!this.cancelled) {
        await updateImg(normal);
        await this.scaledDelay(ANIM.FLASH_FRAME_MS);
      }
    } else if (effect === 'faint') {
      // 3 cycles same as hit, then permanent blank
      for (let c = 0; c < this.scaledFrameCount(ANIM.FAINT_FLASH_CYCLES); c++) {
        if (this.cancelled) break;
        await updateImg(inverted);
        await this.scaledDelay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(normal);
        await this.scaledDelay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(blank);
        await this.scaledDelay(ANIM.FLASH_FRAME_MS);
        if (this.cancelled) break;
        await updateImg(normal);
        await this.scaledDelay(ANIM.FLASH_FRAME_MS);
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
    const steps = Math.min(actualDamage, this.scaledFrameCount(ANIM.MAX_HP_STEPS));

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
      await this.scaledDelay(ANIM.HP_FRAME_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // Switch-in animation (3-frame pokeball sequence + sprite slide)
  // ---------------------------------------------------------------------------

  /**
   * Play the Game Boy-style switch-in animation:
   *   1. Pokeball frame (ball being thrown)
   *   2. Filled square (energy burst)
   *   3. Checkbox (materialization)
   *   4. Sprite slides in from left via shifted BMP frames
   */
  private async switchAnimation(
    side: Side,
    nextState: BattleState,
    glass: GlassAdapter,
  ): Promise<void> {
    const containerID = side === 'opponent'
      ? CONTAINER_IDS.oppSprite
      : CONTAINER_IDS.playerSprite;
    const containerName = side === 'opponent'
      ? CONTAINER_NAMES.oppSprite
      : CONTAINER_NAMES.playerSprite;

    const updateImg = async (data: Uint8Array): Promise<void> => {
      await glass.updateImage(containerID, containerName, data);
    };

    // Phase 1: 3-frame pokeball sequence
    const frames = [getPokeballFrame(), getFilledSquareFrame(), getCheckboxFrame()];
    for (const frame of frames) {
      if (this.cancelled) return;
      await updateImg(frame);
      await this.scaledDelay(ANIM.SWITCH_FRAME_MS);
    }

    // Phase 2: Sprite slide — shifted BMP frames sliding left-to-right
    const finalSprite = getSpriteForSide(nextState, side);
    if (!finalSprite) return;

    const size = SPRITE_CONFIG.SIZE;
    const totalOffset = ANIM.SWITCH_SLIDE_PX * this.scaledFrameCount(ANIM.SWITCH_SLIDE_FRAMES);

    // Generate slide frames from offset to 0 (right-to-left shift decreasing)
    for (let f = this.scaledFrameCount(ANIM.SWITCH_SLIDE_FRAMES); f >= 1; f--) {
      if (this.cancelled) return;
      const offset = ANIM.SWITCH_SLIDE_PX * f;
      // Negative offset = sprite appears shifted left, sliding right
      const shifted = shiftSpriteBmp(finalSprite, -offset, size);
      await updateImg(shifted);
      await this.scaledDelay(ANIM.SWITCH_FRAME_MS);
    }

    // Final frame: sprite at home position
    if (!this.cancelled) {
      await updateImg(finalSprite);
    }
  }

  // ---------------------------------------------------------------------------
  // Transform animation (flash → green → flash → cross → green → cross + sprite)
  // ---------------------------------------------------------------------------

  /**
   * Play the transform animation when Ditto/Imposter copies the target:
   *   1. blank → filled square → blank → checkbox → filled square → checkbox
   *   2. During frames, ensure target sprite is cached
   *   3. Slide in the new sprite
   */
  private async transformAnimation(
    side: Side,
    entry: TurnLogEntry,
    nextState: BattleState,
    glass: GlassAdapter,
  ): Promise<void> {
    const containerID = side === 'opponent'
      ? CONTAINER_IDS.oppSprite
      : CONTAINER_IDS.playerSprite;
    const containerName = side === 'opponent'
      ? CONTAINER_NAMES.oppSprite
      : CONTAINER_NAMES.playerSprite;

    const updateImg = async (data: Uint8Array): Promise<void> => {
      await glass.updateImage(containerID, containerName, data);
    };

    // Resolve target species dex number and ensure sprite is cached
    const targetSpecies = entry.detail.target as string | undefined;
    const targetMon = getActiveMon(nextState, side);
    const targetDexNum = getDexNum(targetSpecies ?? targetMon.species);
    // Fire off sprite caching in background — will be ready by slide-in phase
    const cachePromise = targetDexNum > 0
      ? SpriteService.ensureCached(targetDexNum)
      : Promise.resolve();

    // Phase 1: Flash sequence — blank → filled → blank → checkbox → filled → checkbox
    const blank = blankSprite();
    const filled = getFilledSquareFrame();
    const checkbox = getCheckboxFrame();

    const frames = [blank, filled, blank, checkbox, filled, checkbox];
    for (const frame of frames) {
      if (this.cancelled) return;
      await updateImg(frame);
      await this.scaledDelay(ANIM.SWITCH_FRAME_MS);
    }

    // Ensure sprite caching finished before slide-in
    await cachePromise;

    // Phase 2: Slide in the new sprite (reuse switch slide logic)
    const finalSprite = getSpriteForSide(nextState, side);
    if (!finalSprite) return;

    const size = SPRITE_CONFIG.SIZE;
    for (let f = this.scaledFrameCount(ANIM.SWITCH_SLIDE_FRAMES); f >= 1; f--) {
      if (this.cancelled) return;
      const offset = ANIM.SWITCH_SLIDE_PX * f;
      const shifted = shiftSpriteBmp(finalSprite, -offset, size);
      await updateImg(shifted);
      await this.scaledDelay(ANIM.SWITCH_FRAME_MS);
    }

    if (!this.cancelled) {
      await updateImg(finalSprite);
    }
  }

  // ---------------------------------------------------------------------------
  // HP heal effect (reverse drain — bar fills up)
  // ---------------------------------------------------------------------------

  /**
   * Animate HP bar filling up from prevState HP to nextState HP.
   * Uses actual state HP values, not entry.detail percentages.
   */
  private async hpHeal(
    side: Side,
    prevState: BattleState,
    nextState: BattleState,
    glass: GlassAdapter,
    setHpStatus: (status: string) => void,
    triggerUpdate: () => Promise<void>,
  ): Promise<void> {
    const prevMon = getActiveMon(prevState, side);
    const nextMon = getActiveMon(nextState, side);

    const startHp = prevMon.currentHp;
    const endHp = nextMon.currentHp;
    const healAmount = endHp - startHp;

    if (healAmount <= 0) return; // No healing occurred

    const steps = Math.min(healAmount, this.scaledFrameCount(ANIM.MAX_HP_STEPS));

    for (let i = 0; i <= steps; i++) {
      if (this.cancelled) break;

      const currentHp = Math.round(startHp + (healAmount * i / steps));

      const tempMon: ActivePokemon = {
        ...prevMon,
        currentHp,
        fainted: false,
      };

      setHpStatus(formatHpBar(tempMon));
      await triggerUpdate();
      await this.scaledDelay(ANIM.HP_FRAME_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Instantly swap a side's sprite to a new image (no animation). */
  private async swapSprite(
    side: Side,
    sprite: Uint8Array,
    glass: GlassAdapter,
  ): Promise<void> {
    const containerID = side === 'opponent'
      ? CONTAINER_IDS.oppSprite
      : CONTAINER_IDS.playerSprite;
    const containerName = side === 'opponent'
      ? CONTAINER_NAMES.oppSprite
      : CONTAINER_NAMES.playerSprite;
    await glass.updateImage(containerID, containerName, sprite);
  }

  /** Find which side a fainted Pokemon belongs to by name match. */
  private findFaintedSide(pokemonName: string, state: BattleState): Side | null {
    const playerMon = getActiveMon(state, 'player');
    if (playerMon.name === pokemonName) return 'player';

    const oppMon = getActiveMon(state, 'opponent');
    if (oppMon.name === pokemonName) return 'opponent';

    return null;
  }

  /** Speed-scaled delay. Multiplies base ms by SpeedConfig.multiplier().
   *  When multiplier is 0 (Instant), resolves immediately. */
  private scaledDelay(baseMs: number): Promise<void> {
    return this.delay(baseMs * SpeedConfig.multiplier());
  }

  /** Speed-scaled frame count. Returns 0 for Instant, rounded for other speeds. */
  private scaledFrameCount(baseCount: number): number {
    const m = SpeedConfig.multiplier();
    if (m === 0) return 0;
    return Math.max(1, Math.round(baseCount * m));
  }

  /** Cancellation-aware delay. Resolves immediately if cancelled. */
  private delay(ms: number): Promise<void> {
    return new Promise((r) => {
      if (this.cancelled) { r(); return; }
      setTimeout(r, ms);
    });
  }
}
