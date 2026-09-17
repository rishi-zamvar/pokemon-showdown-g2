export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major, length = width * height * 4 */
  rgba: Uint8Array;
}

export function decodePng(_buf: Uint8Array): DecodedPng {
  throw new Error("decodePng not implemented");
}
