/**
 * SpriteEffects -- pixel-level sprite manipulation for battle animations.
 *
 * All functions operate on Uint8Array BMP data (1-bit monochrome format
 * matching the Even G2 SDK's ImageRawDataUpdate expectations).
 */

import { invertBmp, emptyBmp } from '../sprites/SpriteBmpEncoder.js';

/**
 * Invert a BMP sprite (flip all pixel bits in pixel data section).
 * Used for the "flash" inversion effect on damage hits.
 */
export function invertSprite(bmpData: Uint8Array): Uint8Array {
  return invertBmp(bmpData);
}

/**
 * Create a blank (all black) BMP sprite.
 * Used to "hide" a sprite during blank flash frames and faint removal.
 */
export function blankSprite(): Uint8Array {
  return emptyBmp();
}
