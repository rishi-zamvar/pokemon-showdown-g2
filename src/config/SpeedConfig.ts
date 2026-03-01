/**
 * SpeedConfig — mutable module-level singleton for battle animation speed.
 *
 * Players can cycle through four presets from the main menu.
 * Speed persists across battles within the session (resets to Normal on app restart).
 *
 * Used by AnimationEngine (Phase 8) to scale animation durations.
 */

export type SpeedPreset = 'Slow' | 'Normal' | 'Fast' | 'Instant';

const PRESETS: readonly SpeedPreset[] = ['Normal', 'Fast', 'Instant', 'Slow'];

// Module-level mutable state — resets to Normal on every app open
let currentPreset: SpeedPreset = 'Normal';

export const SpeedConfig = {
  /** Returns the current speed preset name. */
  current(): SpeedPreset {
    return currentPreset;
  },

  /**
   * Advances to the next preset in the cycle:
   * Normal -> Fast -> Instant -> Slow -> Normal
   * Returns the NEW preset after cycling.
   */
  cycle(): SpeedPreset {
    const idx = PRESETS.indexOf(currentPreset);
    const nextIdx = (idx + 1) % PRESETS.length;
    currentPreset = PRESETS[nextIdx]!;
    return currentPreset;
  },

  /**
   * Returns the timing multiplier for the current preset.
   * - Slow:    2.0  (animations take 2x longer)
   * - Normal:  1.0  (baseline)
   * - Fast:    0.5  (half duration)
   * - Instant: 0    (skip all animation — caller checks for 0 to skip entirely)
   */
  multiplier(): number {
    switch (currentPreset) {
      case 'Slow':    return 2.0;
      case 'Normal':  return 1.0;
      case 'Fast':    return 0.5;
      case 'Instant': return 0;
    }
  },

  /** Convenience check — true when animations should be skipped entirely. */
  isInstant(): boolean {
    return currentPreset === 'Instant';
  },

  /** Resets preset to Normal. Used in tests or explicit reset flows. */
  reset(): void {
    currentPreset = 'Normal';
  },
};
