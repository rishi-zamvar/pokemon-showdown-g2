/**
 * SpriteEffects -- pixel-level sprite manipulation for battle animations.
 *
 * All functions operate on raw base64 PNG strings (no data: prefix).
 * Uses the Canvas API to perform pixel operations in-browser.
 */

/**
 * Invert the RGB channels of a base64 PNG sprite, preserving alpha.
 *
 * Takes a raw base64 PNG string (no `data:` prefix), draws it to a temporary
 * Canvas, reads the pixel data, inverts R/G/B channels (255 - value) while
 * leaving the alpha channel unchanged, then returns the result as a raw base64
 * PNG string. Used for the "flash" inversion effect on damage hits.
 *
 * @param base64 - Raw base64 PNG string without the `data:image/png;base64,` prefix.
 * @returns Promise resolving to a raw base64 PNG string of the inverted image.
 */
export function invertSprite(base64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get 2D canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Invert R, G, B channels; leave alpha unchanged
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - (data[i] ?? 0);         // R
        data[i + 1] = 255 - (data[i + 1] ?? 0); // G
        data[i + 2] = 255 - (data[i + 2] ?? 0); // B
        // data[i + 3] unchanged (alpha)
      }

      ctx.putImageData(imageData, 0, 0);

      // Strip the data URL prefix and return raw base64
      const dataUrl = canvas.toDataURL('image/png');
      const result = dataUrl.replace(/^data:image\/png;base64,/, '');
      resolve(result);
    };

    img.onerror = () => {
      reject(new Error('Failed to load sprite image for inversion'));
    };

    img.src = `data:image/png;base64,${base64}`;
  });
}

/**
 * Create a 1x1 transparent PNG and return its raw base64 string.
 *
 * Used to "hide" a sprite container without removing it from the page.
 * Useful for blank flash frames and faint removal effects.
 *
 * @returns Raw base64 PNG string without the `data:image/png;base64,` prefix.
 */
export function blankSprite(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Fallback: minimal valid 1x1 transparent PNG as base64
    return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  }

  // Draw nothing -- canvas is already transparent (all zeros)
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}
