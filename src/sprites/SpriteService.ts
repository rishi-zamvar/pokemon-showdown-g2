/**
 * SpriteService — fetch, cache, and serve 1-bit BMP Pokemon sprites.
 *
 * Sprites are bundled locally in /public/sprites/ (downloaded from PokeAPI).
 * Front sprites: /sprites/front/{dexNum}.png
 * Back sprites:  /sprites/back/{dexNum}.png
 *
 * PNGs are loaded via <img>, drawn to canvas, converted to 1-bit monochrome
 * BMP Uint8Array (same format the Even G2 SDK expects for ImageRawDataUpdate).
 *
 * BMP data is cached in localStorage as base64 for persistence, but returned
 * as Uint8Array for direct SDK consumption.
 */

import { SPRITE_CONFIG } from '../config/constants.js';
import { pngToBmp } from './SpriteBmpEncoder.js';

const BACK_CACHE_PREFIX = 'bmp-sprite-back-';
const FRONT_CACHE_PREFIX = 'bmp-sprite-front-';

/** Convert Uint8Array to base64 string for localStorage storage. */
function uint8ToBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary);
}

/** Convert base64 string back to Uint8Array. */
function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    data[i] = binary.charCodeAt(i);
  }
  return data;
}

/** Build the localStorage key for a front-facing sprite. */
function frontKey(dexNum: number): string {
  return `${FRONT_CACHE_PREFIX}${dexNum}`;
}

/** Build the localStorage key for a back-facing sprite. */
function backKey(dexNum: number): string {
  return `${BACK_CACHE_PREFIX}${dexNum}`;
}

/** Read BMP data from localStorage, returning Uint8Array or null. */
function getFromCache(key: string): Uint8Array | null {
  try {
    const val = localStorage.getItem(key);
    if (!val) return null;
    // Clear old-format entries (raw base64 of PNG, or data: URLs)
    if (val.startsWith('data:') || val.length < 100) {
      localStorage.removeItem(key);
      return null;
    }
    return base64ToUint8(val);
  } catch {
    return null;
  }
}

/** Store BMP Uint8Array in localStorage as base64. */
function setInCache(key: string, data: Uint8Array): void {
  try {
    localStorage.setItem(key, uint8ToBase64(data));
  } catch { /* storage full */ }
}

export const SpriteService = {
  /** Get a cached front-facing sprite as BMP Uint8Array. */
  getBitmapCached(dexNum: number): Uint8Array | null {
    return getFromCache(frontKey(dexNum));
  },

  /** Get a cached back-facing sprite as BMP Uint8Array. */
  getBackBitmapCached(dexNum: number): Uint8Array | null {
    return getFromCache(backKey(dexNum));
  },

  /**
   * Fetch front + back sprites for all battle Pokemon.
   * Loads PNGs from local /sprites/ directory, converts to 1-bit BMP.
   */
  async fetchAndCacheBitmaps(
    oppDexNums: number[],
    playerDexNums: number[],
  ): Promise<void> {
    const fetches: Promise<void>[] = [];

    // Front-facing sprites for opponents
    for (const num of oppDexNums) {
      if (getFromCache(frontKey(num))) continue;
      fetches.push((async () => {
        const bmp = await pngToBmp(`/sprites/front/${num}.png`);
        if (!bmp) return;
        setInCache(frontKey(num), bmp);
        console.log(`[SPRITES] front/${num}.png → BMP ${bmp.length} bytes`);
      })());
    }

    // Back-facing sprites for player (fall back to front if back is missing/broken)
    for (const num of playerDexNums) {
      if (getFromCache(backKey(num))) continue;
      fetches.push((async () => {
        let bmp = await pngToBmp(`/sprites/back/${num}.png`);
        if (!bmp) {
          console.log(`[SPRITES] back/${num}.png failed, falling back to front`);
          bmp = await pngToBmp(`/sprites/front/${num}.png`);
        }
        if (!bmp) return;
        setInCache(backKey(num), bmp);
        console.log(`[SPRITES] back/${num}.png → BMP ${bmp.length} bytes`);
      })());
    }

    if (fetches.length === 0) {
      console.log('[SPRITES] All sprites already cached');
      return;
    }

    console.log(`[SPRITES] Converting ${fetches.length} sprites to BMP...`);
    await Promise.allSettled(fetches);
    console.log('[SPRITES] Conversion complete');
  },

  /**
   * Ensure front + back sprites for a dex number are cached.
   * Fetches on demand if not already present (needed for transform targets
   * whose sprites weren't pre-loaded at battle start).
   */
  async ensureCached(dexNum: number): Promise<void> {
    const needsFront = !getFromCache(frontKey(dexNum));
    const needsBack = !getFromCache(backKey(dexNum));
    if (!needsFront && !needsBack) return;

    const fetches: Promise<void>[] = [];

    if (needsFront) {
      fetches.push((async () => {
        const bmp = await pngToBmp(`/sprites/front/${dexNum}.png`);
        if (bmp) setInCache(frontKey(dexNum), bmp);
      })());
    }

    if (needsBack) {
      fetches.push((async () => {
        let bmp = await pngToBmp(`/sprites/back/${dexNum}.png`);
        if (!bmp) bmp = await pngToBmp(`/sprites/front/${dexNum}.png`);
        if (bmp) setInCache(backKey(dexNum), bmp);
      })());
    }

    await Promise.allSettled(fetches);
  },

  /** Clear cached sprites for specific dex numbers (both front and back). */
  clearBitmapCache(dexNumbers: number[]): void {
    for (const num of dexNumbers) {
      try {
        localStorage.removeItem(frontKey(num));
        localStorage.removeItem(backKey(num));
        // Also clear old-format keys
        localStorage.removeItem(`${SPRITE_CONFIG.CACHE_PREFIX}${num}`);
        localStorage.removeItem(`bitmap-sprite-back-${num}`);
      } catch { /* ignore */ }
    }
  },

  /** Clear ALL cached sprites from localStorage. */
  clearAllBitmapCache(): void {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key?.startsWith(FRONT_CACHE_PREFIX) ||
          key?.startsWith(BACK_CACHE_PREFIX) ||
          key?.startsWith(SPRITE_CONFIG.CACHE_PREFIX) ||
          key?.startsWith('bitmap-sprite-back-')
        ) {
          keys.push(key);
        }
      }
      for (const key of keys) {
        localStorage.removeItem(key);
      }
    } catch { /* ignore */ }
  },
} as const;
