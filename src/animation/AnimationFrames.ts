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
let _substitute: Uint8Array | null = null;

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

/** Substitute doll — classic rounded body with tail, ears, and face. */
function makeSubstituteFrame(): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE);
  const cx = Math.floor(SIZE / 2);
  const cy = Math.floor(SIZE * 0.55); // body center slightly below middle

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;

      // Body: rounded rectangle (wide ellipse)
      const bodyW = SIZE * 0.35;
      const bodyH = SIZE * 0.32;
      const inBody = (dx * dx) / (bodyW * bodyW) + (dy * dy) / (bodyH * bodyH) <= 1;

      // Head: circle on top of body
      const headCy = cy - SIZE * 0.3;
      const headR = SIZE * 0.2;
      const hdx = x - cx;
      const hdy = y - headCy;
      const inHead = (hdx * hdx + hdy * hdy) <= headR * headR;

      // Left ear: small circle
      const earLx = cx - SIZE * 0.15;
      const earLy = headCy - SIZE * 0.18;
      const inEarL = ((x - earLx) ** 2 + (y - earLy) ** 2) <= (SIZE * 0.07) ** 2;

      // Right ear: small circle
      const earRx = cx + SIZE * 0.15;
      const earRy = headCy - SIZE * 0.18;
      const inEarR = ((x - earRx) ** 2 + (y - earRy) ** 2) <= (SIZE * 0.07) ** 2;

      // Tail: small bump on the right side of body
      const tailCx = cx + SIZE * 0.35;
      const tailCy = cy - SIZE * 0.05;
      const inTail = ((x - tailCx) ** 2 + (y - tailCy) ** 2) <= (SIZE * 0.1) ** 2;

      // Outline only — draw if on the edge of any shape
      const isShape = inBody || inHead || inEarL || inEarR || inTail;

      if (isShape) {
        // Check if any neighbor is NOT in a shape (edge detection)
        const step = 2;
        const n1Body = ((dx - step) ** 2) / (bodyW * bodyW) + (dy ** 2) / (bodyH * bodyH) <= 1;
        const n2Body = ((dx + step) ** 2) / (bodyW * bodyW) + (dy ** 2) / (bodyH * bodyH) <= 1;
        const n3Body = (dx ** 2) / (bodyW * bodyW) + ((dy - step) ** 2) / (bodyH * bodyH) <= 1;
        const n4Body = (dx ** 2) / (bodyW * bodyW) + ((dy + step) ** 2) / (bodyH * bodyH) <= 1;

        const n1Head = ((x - step - cx) ** 2 + (y - headCy) ** 2) <= headR * headR;
        const n2Head = ((x + step - cx) ** 2 + (y - headCy) ** 2) <= headR * headR;
        const n3Head = ((x - cx) ** 2 + (y - step - headCy) ** 2) <= headR * headR;
        const n4Head = ((x - cx) ** 2 + (y + step - headCy) ** 2) <= headR * headR;

        const n1 = n1Body || n1Head || ((x - step - earLx) ** 2 + (y - earLy) ** 2) <= (SIZE * 0.07) ** 2 || ((x - step - earRx) ** 2 + (y - earRy) ** 2) <= (SIZE * 0.07) ** 2 || ((x - step - tailCx) ** 2 + (y - tailCy) ** 2) <= (SIZE * 0.1) ** 2;
        const n2 = n2Body || n2Head || ((x + step - earLx) ** 2 + (y - earLy) ** 2) <= (SIZE * 0.07) ** 2 || ((x + step - earRx) ** 2 + (y - earRy) ** 2) <= (SIZE * 0.07) ** 2 || ((x + step - tailCx) ** 2 + (y - tailCy) ** 2) <= (SIZE * 0.1) ** 2;
        const n3 = n3Body || n3Head || ((x - earLx) ** 2 + (y - step - earLy) ** 2) <= (SIZE * 0.07) ** 2 || ((x - earRx) ** 2 + (y - step - earRy) ** 2) <= (SIZE * 0.07) ** 2 || ((x - tailCx) ** 2 + (y - step - tailCy) ** 2) <= (SIZE * 0.1) ** 2;
        const n4 = n4Body || n4Head || ((x - earLx) ** 2 + (y + step - earLy) ** 2) <= (SIZE * 0.07) ** 2 || ((x - earRx) ** 2 + (y + step - earRy) ** 2) <= (SIZE * 0.07) ** 2 || ((x - tailCx) ** 2 + (y + step - tailCy) ** 2) <= (SIZE * 0.1) ** 2;

        if (!n1 || !n2 || !n3 || !n4) {
          pixels[y * SIZE + x] = 1; // Edge pixel
        }
      }

      // Eyes: two small filled dots on the head
      const eyeY = headCy + SIZE * 0.02;
      const eyeSpacing = SIZE * 0.08;
      if (((x - (cx - eyeSpacing)) ** 2 + (y - eyeY) ** 2) <= (SIZE * 0.025) ** 2) {
        pixels[y * SIZE + x] = 1;
      }
      if (((x - (cx + eyeSpacing)) ** 2 + (y - eyeY) ** 2) <= (SIZE * 0.025) ** 2) {
        pixels[y * SIZE + x] = 1;
      }

      // Mouth: short horizontal line below eyes
      if (y >= eyeY + SIZE * 0.06 && y <= eyeY + SIZE * 0.08 &&
          x >= cx - SIZE * 0.06 && x <= cx + SIZE * 0.06) {
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

/** Get the substitute doll frame BMP (cached after first call). */
export function getSubstituteFrame(): Uint8Array {
  if (!_substitute) _substitute = makeSubstituteFrame();
  return _substitute;
}
