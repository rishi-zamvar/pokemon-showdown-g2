/**
 * AnimationFrames -- programmatic BMP frames for switch-in animation.
 *
 * Three frames play in sequence when a Pokemon switches in:
 *   1. Pokeball (circle outline — represents ball being thrown)
 *   2. Filled square (all white — represents energy burst)
 *   3. Checkbox square (white border with cross — represents materialization)
 *
 * All frames are 96x96 1-bit monochrome BMP, lazily generated and cached.
 * Pixel format: row-major top-down (y=0 is top). encodeBmp handles BMP bottom-up inversion.
 */

import { encodeBmp } from '../sprites/SpriteBmpEncoder.js';
import { SPRITE_CONFIG } from '../config/constants.js';

const SIZE = SPRITE_CONFIG.SIZE; // 96

// ---------------------------------------------------------------------------
// Lazy caches
// ---------------------------------------------------------------------------

let _pokeball: Uint8Array | null = null;
let _filledSquare: Uint8Array | null = null;
let _checkbox: Uint8Array | null = null;

// ---------------------------------------------------------------------------
// Frame generators (private)
// ---------------------------------------------------------------------------

/** Draw a circle outline centered in the frame — pokeball approximation. */
function makePokeballFrame(): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE * 0.35; // ~33px radius
  const thickness = 2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Circle outline
      if (dist >= r - thickness && dist <= r + thickness) {
        pixels[y * SIZE + x] = 1;
      }
      // Horizontal line through center (pokeball seam)
      if (Math.abs(dy) <= 1 && dist <= r) {
        pixels[y * SIZE + x] = 1;
      }
      // Center button circle (small filled circle)
      if (dist <= SIZE * 0.08) {
        pixels[y * SIZE + x] = 1;
      }
    }
  }
  return encodeBmp(pixels, SIZE, SIZE);
}

/** All-white filled square — energy burst effect. */
function makeFilledSquareFrame(): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE).fill(1);
  return encodeBmp(pixels, SIZE, SIZE);
}

/** White border with inner cross pattern — materialization/checkbox effect. */
function makeCheckboxFrame(): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE);
  const border = Math.round(SIZE * 0.1); // ~10px border
  const cx = Math.floor(SIZE / 2);
  const cy = Math.floor(SIZE / 2);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Outer border: white
      if (x < border || x >= SIZE - border || y < border || y >= SIZE - border) {
        pixels[y * SIZE + x] = 1;
      }
      // Inner checkmark: diagonal lines forming a V/tick
      // Left stroke: from (cx-20, cy) to (cx, cy+20)
      // Right stroke: from (cx, cy+20) to (cx+30, cy-15)
      const lx = x - (cx - 20);
      const ly = y - cy;
      if (lx >= 0 && lx <= 20 && Math.abs(ly - lx) <= 2) {
        pixels[y * SIZE + x] = 1;
      }
      const rx = x - cx;
      const ry = y - (cy + 20);
      if (rx >= 0 && rx <= 30 && Math.abs(ry + rx * 35 / 30) <= 2) {
        pixels[y * SIZE + x] = 1;
      }
    }
  }
  return encodeBmp(pixels, SIZE, SIZE);
}

// ---------------------------------------------------------------------------
// Public API — cached getters
// ---------------------------------------------------------------------------

/** Get the pokeball frame BMP (cached after first call). */
export function getPokeballFrame(): Uint8Array {
  if (!_pokeball) _pokeball = makePokeballFrame();
  return _pokeball;
}

/** Get the filled square frame BMP (cached after first call). */
export function getFilledSquareFrame(): Uint8Array {
  if (!_filledSquare) _filledSquare = makeFilledSquareFrame();
  return _filledSquare;
}

/** Get the checkbox frame BMP (cached after first call). */
export function getCheckboxFrame(): Uint8Array {
  if (!_checkbox) _checkbox = makeCheckboxFrame();
  return _checkbox;
}
