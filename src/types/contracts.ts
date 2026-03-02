export type Unsubscribe = () => void;

export type GestureKind =
  | "SCROLL_FWD"
  | "SCROLL_BACK"
  | "TAP"
  | "DOUBLE_TAP"
  | "FOREGROUND_ENTER"
  | "FOREGROUND_EXIT";

export interface GestureEvent {
  kind: GestureKind;
  /** Firmware-reported list selection index (from listEvent on TAP). */
  listIndex?: number;
}

export interface StatusBar {
  left: string;
  right: string;
}

export interface GlassAdapter {
  connect(): Promise<void>;
  bootstrapStartup(): Promise<void>;
  onGesture(handler: (event: GestureEvent) => void): Unsubscribe;
  showList(items: string[], statusText: string): Promise<void>;
  showText(text: string, status: StatusBar): Promise<void>;
  updateText(text: string, status: StatusBar): Promise<void>;
  showMessage(text: string): Promise<void>;
  showBattleHud(
    oppText: string,
    playerText: string,
    status: StatusBar,
    oppSprite?: Uint8Array,
    playerSprite?: Uint8Array,
  ): Promise<void>;
  /** Update a sprite image in-place without rebuilding the page. */
  updateImage(containerID: number, containerName: string, bmpData: Uint8Array): Promise<void>;
}
