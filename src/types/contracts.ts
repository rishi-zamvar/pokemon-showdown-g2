export type Unsubscribe = () => void;

/** One entry of the native OS context menu. itemID non-zero and unique; itemName <= 32 UTF-8 BYTES. */
export interface MenuItem {
  id: number;
  name: string;
}

export type GestureKind =
  | "SCROLL_FWD"
  | "SCROLL_BACK"
  | "TAP"
  | "DOUBLE_TAP"
  | "MENU_ITEM"
  | "FOREGROUND_ENTER"
  | "FOREGROUND_EXIT";

export interface GestureEvent {
  kind: GestureKind;
  /** Firmware-reported list selection index (from listEvent on TAP). */
  listIndex?: number;
  /** Set only on MENU_ITEM; the itemID the OS reported for the clicked entry. */
  menuItemID?: number;
}

export interface StatusBar {
  left: string;
  right: string;
}

export interface GlassAdapter {
  connect(): Promise<void>;
  bootstrapStartup(): Promise<void>;
  onGesture(handler: (event: GestureEvent) => void): Unsubscribe;
  /**
   * Render a list page, optionally declaring the native OS context menu.
   *
   * Omitting `menu` rebuilds without `menuObject`, which CLEARS the custom menu
   * and restores the OS default (D-09). Only the root page passes one.
   */
  showList(items: string[], statusText: string, menu?: readonly MenuItem[]): Promise<void>;
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
  /**
   * Show the 4-container overlay HUD layout used by all decision screens.
   *
   * Containers (in order):
   *   C2 (ImageContainer 144x132): Opponent composite at x=432, y=24
   *   C3 (ImageContainer 144x132): Player composite at x=0, y=156
   *   C4 (ListContainer 288x132):  Selectable action list at x=288, y=156
   */
  showOverlayHud(
    oppCompositeBmp: Uint8Array,
    playerCompositeBmp: Uint8Array,
    listItems: string[],
    listStatus: string,
  ): Promise<void>;
  /**
   * Raise the OS exit dialogue (shutDownPageContainer exitMode 1).
   *
   * D-02: once this dialogue has been shown and dismissed, EVERY
   * updateImageRawData returns sendFailed in 1-3 ms and never recovers until
   * the app restarts. Three in-app recoveries were tried upstream and all
   * failed. There is no recovery path here on purpose — only one caller, and
   * it is an explicit menu selection on the root page.
   */
  exitApp(): Promise<void>;
}
