export interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Frame {
  width: number;
  height: number;
  rgba: Uint8Array;
  /** original PNG bytes, kept so saveFrame() writes a real PNG artifact */
  png: Uint8Array;
  capturedAt: number;
}

export const INK_THRESHOLD = 16;

export function toFrame(_png: Uint8Array): Frame {
  throw new Error("toFrame not implemented");
}

export function inkRatio(_f: Frame, _r: Region): number {
  throw new Error("inkRatio not implemented");
}

export function greyLevels(_f: Frame, _r: Region): number {
  throw new Error("greyLevels not implemented");
}

export async function saveFrame(_f: Frame, _filePath: string): Promise<void> {
  throw new Error("saveFrame not implemented");
}
