import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import {
  CONTAINER_IDS,
  CONTAINER_NAMES,
  GLASS_LAYOUT,
  OVERLAY_LAYOUT,
  SPRITE_CONFIG,
  TIMING,
} from "../config/constants";
import { emptyTeamBarBmp } from "../sprites/CompositeBuilder";
import type { GestureEvent, GlassAdapter, StatusBar, Unsubscribe } from "../types/contracts";

/**
 * GlassAdapter implementation built from official SDK docs and
 * Nick Ustinov's G2 community notes.
 *
 * Key design decisions:
 * - createStartUpPageContainer called exactly once (first render)
 * - rebuildPageContainer only for mode changes
 * - textContainerUpgrade for in-place text updates (no flash)
 * - 300ms scroll cooldown to prevent duplicate events
 * - CLICK_EVENT=0->undefined quirk handled
 * - Simulator sysEvent + hardware listEvent/textEvent all handled
 */
export class GlassAdapterImpl implements GlassAdapter {
  private bridge: EvenAppBridge | null = null;
  private unsubscribeHub: Unsubscribe | null = null;
  private startupDone = false;
  private readonly gestureHandlers = new Set<(e: GestureEvent) => void>();
  private lastScrollTime = 0;

  async connect(): Promise<void> {
    if (this.bridge) return;

    this.bridge = await this.waitForBridge();
    this.bindEvents();
  }

  onGesture(handler: (event: GestureEvent) => void): Unsubscribe {
    this.gestureHandlers.add(handler);
    return () => {
      this.gestureHandlers.delete(handler);
    };
  }

  /**
   * Bootstrap the SDK startup page with a minimal single text container.
   * Must be called once before any other render calls.
   * Uses position 0,0 and full display dimensions — matching proven working apps.
   */
  async bootstrapStartup(): Promise<void> {
    if (!this.bridge) throw new Error('Not connected');
    if (this.startupDone) return;

    const config = {
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          containerID: CONTAINER_IDS.content,
          containerName: CONTAINER_NAMES.content,
          content: 'Loading...',
          isEventCapture: 1,
        }),
      ],
    };

    console.log('[GlassAdapter] bootstrapStartup config:', JSON.stringify(config));
    const result = await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer(config),
    );
    console.log('[GlassAdapter] bootstrapStartup result:', result);

    if (result === StartUpPageCreateResult.success) {
      this.startupDone = true;
    } else {
      console.error('[GlassAdapter] bootstrapStartup failed with code:', result);
      // Force startupDone so subsequent renders use rebuildPageContainer
      this.startupDone = true;
    }
  }

  /**
   * Show a scrollable list on glasses.
   * Always rebuilds because list items can't be updated in-place.
   */
  async showList(items: string[], statusText: string): Promise<void> {
    const listContainer = new ListContainerProperty({
      xPosition: GLASS_LAYOUT.x,
      yPosition: GLASS_LAYOUT.y,
      width: GLASS_LAYOUT.width,
      height: GLASS_LAYOUT.height,
      containerID: CONTAINER_IDS.content,
      containerName: CONTAINER_NAMES.content,
      isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({
        itemCount: items.length,
        itemName: items,
        isItemSelectBorderEn: 1,
      }),
    });

    const statusContainer = this.makeStatusContainer(statusText);

    await this.renderContainers({
      listObject: [listContainer],
      textObject: [statusContainer],
    });
  }

  /**
   * Show text content with a split status bar (left + right).
   * Full rebuild — use this for mode changes.
   */
  async showText(text: string, status: StatusBar): Promise<void> {
    const textContainer = new TextContainerProperty({
      xPosition: GLASS_LAYOUT.x,
      yPosition: GLASS_LAYOUT.y,
      width: GLASS_LAYOUT.width,
      height: GLASS_LAYOUT.height,
      containerID: CONTAINER_IDS.content,
      containerName: CONTAINER_NAMES.content,
      isEventCapture: 0,
      content: text.slice(0, 1000), // startup/rebuild limit: 1000 chars
    });

    const [statusLeft, statusRight] = this.makeSplitStatus(status);

    await this.renderContainers({
      textObject: [textContainer, statusLeft, statusRight],
    });
  }

  /**
   * Lightweight in-place text update — NO rebuild, NO flash.
   * Uses textContainerUpgrade. Max 2000 chars per Nick Ustinov notes.
   */
  async updateText(text: string, status: StatusBar): Promise<void> {
    if (!this.bridge) {
      throw new Error("Not connected");
    }

    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: CONTAINER_IDS.content,
        containerName: CONTAINER_NAMES.content,
        contentOffset: 0,
        contentLength: text.length,
        content: text.slice(0, 2000),
      }),
    );

    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: CONTAINER_IDS.status,
        containerName: CONTAINER_NAMES.status,
        contentOffset: 0,
        contentLength: status.left.length,
        content: status.left.slice(0, 2000),
      }),
    );

    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: CONTAINER_IDS.statusRight,
        containerName: CONTAINER_NAMES.statusRight,
        contentOffset: 0,
        contentLength: status.right.length,
        content: status.right.slice(0, 2000),
      }),
    );
  }

  /**
   * Show a simple text message with an empty status bar.
   */
  async showMessage(text: string): Promise<void> {
    const msgContainer = new TextContainerProperty({
      xPosition: GLASS_LAYOUT.x,
      yPosition: GLASS_LAYOUT.y,
      width: GLASS_LAYOUT.width,
      height: GLASS_LAYOUT.height,
      containerID: CONTAINER_IDS.content,
      containerName: CONTAINER_NAMES.content,
      isEventCapture: 1,
      content: text.slice(0, 1000),
    });

    const statusContainer = this.makeStatusContainer("");

    await this.renderContainers({
      textObject: [msgContainer, statusContainer],
    });
  }

  /**
   * Show battle HUD with two Pokemon sprites and info text.
   *
   * Layout (576x288, max 4 containers):
   *   Top-right:    oppSprite (64x64) with oppText to its left
   *   Bottom-left:  playerSprite (64x64) with playerText to its right
   *   Text below each sprite includes HP bar
   *   Status bar at very bottom
   */
  async showBattleHud(
    oppText: string,
    playerText: string,
    status: StatusBar,
    oppSprite?: Uint8Array,
    playerSprite?: Uint8Array,
  ): Promise<void> {
    const s = SPRITE_CONFIG.SIZE;
    const halfH = Math.floor(GLASS_LAYOUT.height / 2);

    const imageContainers: ImageContainerProperty[] = [];

    // Opponent sprite: top-right, vertically centered in top half
    if (oppSprite) {
      const oppY = GLASS_LAYOUT.y + Math.floor((halfH - s) / 2);
      imageContainers.push(new ImageContainerProperty({
        xPosition: GLASS_LAYOUT.x + GLASS_LAYOUT.width - s,
        yPosition: oppY,
        width: s,
        height: s,
        containerID: CONTAINER_IDS.oppSprite,
        containerName: CONTAINER_NAMES.oppSprite,
      }));
    }

    // Player sprite: bottom-left, vertically centered in bottom half
    if (playerSprite) {
      const plyY = GLASS_LAYOUT.y + halfH + Math.floor((halfH - s) / 2);
      imageContainers.push(new ImageContainerProperty({
        xPosition: GLASS_LAYOUT.x,
        yPosition: plyY,
        width: s,
        height: s,
        containerID: CONTAINER_IDS.playerSprite,
        containerName: CONTAINER_NAMES.playerSprite,
      }));
    }

    // Text: opponent info top half, player info bottom half
    const combinedText = `${oppText}\n\n${playerText}`;

    const textContainer = new TextContainerProperty({
      xPosition: GLASS_LAYOUT.x,
      yPosition: GLASS_LAYOUT.y,
      width: GLASS_LAYOUT.width,
      height: GLASS_LAYOUT.height,
      containerID: CONTAINER_IDS.content,
      containerName: CONTAINER_NAMES.content,
      isEventCapture: 1,
      content: combinedText.slice(0, 1000),
    });

    const statusText = `${status.left}  ${status.right}`;
    const statusContainer = this.makeStatusContainer(statusText);

    // Blank out container 8 (teamBar) before rebuilding.
    //
    // The SDK's rebuildPageContainer does NOT remove containers that are absent
    // from the new config — they persist on screen with their last-rendered
    // content. showOverlayHud always includes container 8 (a 576x24 team bar
    // image at y=0). When showBattleHud is called next (for animation), that
    // container 8 remains visible as a green horizontal strip across the top.
    //
    // Fix: overwrite container 8's image data with an all-black BMP before
    // the rebuild, effectively hiding it. We use a try/catch because this call
    // may fail if container 8 has never been created yet (first animation before
    // any overlay was shown) — that failure is harmless and expected.
    if (this.bridge) {
      try {
        await this.bridge.updateImageRawData(
          new ImageRawDataUpdate({
            containerID: CONTAINER_IDS.teamBar,
            containerName: CONTAINER_NAMES.teamBar,
            imageData: emptyTeamBarBmp(),
          }),
        );
      } catch {
        // Container 8 doesn't exist yet — nothing to blank, safe to ignore.
      }
    }

    await this.renderContainers({
      imageObject: imageContainers.length > 0 ? imageContainers : undefined,
      textObject: [textContainer, statusContainer],
    });

    // Send BMP image data AFTER container creation (sequential — no concurrent sends)
    if (this.bridge) {
      if (oppSprite) {
        console.log(`[GlassAdapter] sending oppSprite BMP: ${oppSprite.length} bytes`);
        await this.bridge.updateImageRawData(
          new ImageRawDataUpdate({
            containerID: CONTAINER_IDS.oppSprite,
            containerName: CONTAINER_NAMES.oppSprite,
            imageData: oppSprite,
          }),
        );
      }
      if (playerSprite) {
        console.log(`[GlassAdapter] sending playerSprite BMP: ${playerSprite.length} bytes`);
        await this.bridge.updateImageRawData(
          new ImageRawDataUpdate({
            containerID: CONTAINER_IDS.playerSprite,
            containerName: CONTAINER_NAMES.playerSprite,
            imageData: playerSprite,
          }),
        );
      }
    }
  }

  /**
   * Show the 4-container overlay HUD used by all decision screens.
   *
   * Layout (576x288 total):
   *   C1: Team preview bar  — ImageContainer 576x24  at (0, 0)
   *   C2: Opponent composite — ImageContainer 144x132 at (432, 24)
   *   C3: Player composite   — ImageContainer 144x132 at (0, 156)
   *   C4: Action list        — ListContainer  288x132 at (288, 156)
   *
   * BMP image data is sent sequentially after container creation.
   * Total container count is exactly 4, within the SDK hardware limit.
   */
  async showOverlayHud(
    teamBarBmp: Uint8Array,
    oppCompositeBmp: Uint8Array,
    playerCompositeBmp: Uint8Array,
    listItems: string[],
    listStatus: string,
  ): Promise<void> {
    // C1: Team preview bar (full-width, top strip)
    const teamBarContainer = new ImageContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: OVERLAY_LAYOUT.TEAM_BAR_W,
      height: OVERLAY_LAYOUT.TEAM_BAR_H,
      containerID: CONTAINER_IDS.teamBar,
      containerName: CONTAINER_NAMES.teamBar,
    });

    // C2: Opponent composite (top-right quadrant)
    const oppContainer = new ImageContainerProperty({
      xPosition: OVERLAY_LAYOUT.OPP_X,
      yPosition: OVERLAY_LAYOUT.OPP_Y,
      width: OVERLAY_LAYOUT.COMPOSITE_W,
      height: OVERLAY_LAYOUT.COMPOSITE_H,
      containerID: CONTAINER_IDS.oppSprite,
      containerName: CONTAINER_NAMES.oppSprite,
    });

    // C3: Player composite (bottom-left quadrant)
    const playerContainer = new ImageContainerProperty({
      xPosition: OVERLAY_LAYOUT.PLAYER_X,
      yPosition: OVERLAY_LAYOUT.PLAYER_Y,
      width: OVERLAY_LAYOUT.COMPOSITE_W,
      height: OVERLAY_LAYOUT.COMPOSITE_H,
      containerID: CONTAINER_IDS.playerSprite,
      containerName: CONTAINER_NAMES.playerSprite,
    });

    // C4: Selectable action list (bottom-right quadrant)
    const listContainer = new ListContainerProperty({
      xPosition: OVERLAY_LAYOUT.LIST_X,
      yPosition: OVERLAY_LAYOUT.LIST_Y,
      width: OVERLAY_LAYOUT.LIST_W,
      height: OVERLAY_LAYOUT.LIST_H,
      containerID: CONTAINER_IDS.content,
      containerName: CONTAINER_NAMES.content,
      isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({
        itemCount: listItems.length,
        itemName: listItems,
        isItemSelectBorderEn: 1,
      }),
    });

    // Blank out container 2 (status text bar) before rebuilding.
    //
    // showBattleHud includes container 2 (status text at y=256) in its config.
    // When showOverlayHud runs next, rebuildPageContainer does NOT remove
    // container 2 — it persists as stale status text at the bottom of the
    // overlay. Clearing it with a zero-length textContainerUpgrade hides it.
    // Try/catch: silently ignored if container 2 doesn't exist yet.
    if (this.bridge) {
      try {
        await this.bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: CONTAINER_IDS.status,
            containerName: CONTAINER_NAMES.status,
            contentOffset: 0,
            contentLength: 0,
            content: '',
          }),
        );
      } catch {
        // Container 2 doesn't exist yet — safe to ignore.
      }
    }

    await this.renderContainers({
      imageObject: [teamBarContainer, oppContainer, playerContainer],
      listObject: [listContainer],
    });

    // Send BMP image data sequentially after container creation
    await this.sendBmpData(CONTAINER_IDS.teamBar, CONTAINER_NAMES.teamBar, teamBarBmp);
    await this.sendBmpData(CONTAINER_IDS.oppSprite, CONTAINER_NAMES.oppSprite, oppCompositeBmp);
    await this.sendBmpData(CONTAINER_IDS.playerSprite, CONTAINER_NAMES.playerSprite, playerCompositeBmp);
  }

  /**
   * Update a sprite image in-place without rebuilding the page.
   *
   * Calls the SDK's updateImageRawData directly on the existing container.
   * The container must already exist (created via showBattleHud or similar).
   *
   * @param containerID - Numeric ID of the image container (from CONTAINER_IDS).
   * @param containerName - Name of the image container (from CONTAINER_NAMES).
   * @param base64 - Raw base64 PNG string without the `data:` prefix.
   */
  async updateImage(containerID: number, containerName: string, bmpData: Uint8Array): Promise<void> {
    if (!this.bridge) throw new Error('Not connected');
    await this.bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID,
        containerName,
        imageData: bmpData,
      }),
    );
  }

  // --- Private ---

  private makeStatusContainer(text: string): TextContainerProperty {
    return new TextContainerProperty({
      xPosition: GLASS_LAYOUT.x,
      yPosition: GLASS_LAYOUT.statusY,
      width: GLASS_LAYOUT.width,
      height: GLASS_LAYOUT.statusHeight,
      containerID: CONTAINER_IDS.status,
      containerName: CONTAINER_NAMES.status,
      isEventCapture: 0,
      content: text.slice(0, 1000),
    });
  }

  private makeSplitStatus(status: StatusBar): [TextContainerProperty, TextContainerProperty] {
    const charWidth = GLASS_LAYOUT.width / 64;
    const rightWidth = Math.ceil(status.right.length * charWidth) + 16;
    const rightX = GLASS_LAYOUT.x + GLASS_LAYOUT.width - rightWidth;
    const leftWidth = rightX - GLASS_LAYOUT.x;

    const left = new TextContainerProperty({
      xPosition: GLASS_LAYOUT.x,
      yPosition: GLASS_LAYOUT.statusY,
      width: Math.max(leftWidth, 40),
      height: GLASS_LAYOUT.statusHeight,
      containerID: CONTAINER_IDS.status,
      containerName: CONTAINER_NAMES.status,
      isEventCapture: 0,
      content: status.left.slice(0, 1000),
    });

    const right = new TextContainerProperty({
      xPosition: rightX,
      yPosition: GLASS_LAYOUT.statusY,
      width: rightWidth,
      height: GLASS_LAYOUT.statusHeight,
      containerID: CONTAINER_IDS.statusRight,
      containerName: CONTAINER_NAMES.statusRight,
      isEventCapture: 1,
      content: status.right.slice(0, 1000),
    });

    return [left, right];
  }

  private async renderContainers(payload: {
    listObject?: ListContainerProperty[];
    textObject?: TextContainerProperty[];
    imageObject?: ImageContainerProperty[];
  }): Promise<void> {
    if (!this.bridge) {
      throw new Error("Not connected. Call connect() first.");
    }

    const containerTotalNum =
      (payload.listObject?.length ?? 0) +
      (payload.textObject?.length ?? 0) +
      (payload.imageObject?.length ?? 0);

    const config = {
      containerTotalNum,
      ...(payload.listObject ? { listObject: payload.listObject } : {}),
      ...(payload.textObject ? { textObject: payload.textObject } : {}),
      ...(payload.imageObject ? { imageObject: payload.imageObject } : {}),
    };

    if (!this.startupDone) {
      // Try createStartUpPageContainer once — if it fails, fall through to rebuildPageContainer
      try {
        const result = await this.bridge.createStartUpPageContainer(
          new CreateStartUpPageContainer(config),
        );
        console.log('[GlassAdapter] createStartUpPageContainer result:', result);
        if (result === StartUpPageCreateResult.success) {
          this.startupDone = true;
          return;
        }
      } catch (e) {
        console.warn('[GlassAdapter] createStartUpPageContainer threw:', e);
      }
      // Failed — mark as done and fall through to rebuildPageContainer
      console.warn('[GlassAdapter] startup failed, falling through to rebuild');
      this.startupDone = true;
    }

    let ok = await this.bridge.rebuildPageContainer(
      new RebuildPageContainer(config),
    );

    if (!ok) {
      await this.delay(300);
      ok = await this.bridge.rebuildPageContainer(
        new RebuildPageContainer(config),
      );
    }

    if (!ok) {
      console.warn("[glass] rebuildPageContainer failed after retry");
    }
  }

  private bindEvents(): void {
    if (!this.bridge) return;

    this.unsubscribeHub?.();
    this.unsubscribeHub = this.bridge.onEvenHubEvent((event) => {
      const gesture = this.mapEventToGesture(event);
      if (!gesture) return;

      if (gesture.kind === "SCROLL_FWD" || gesture.kind === "SCROLL_BACK") {
        const now = Date.now();
        if (now - this.lastScrollTime < TIMING.SCROLL_COOLDOWN_MS) {
          return;
        }
        this.lastScrollTime = now;
      }

      for (const handler of this.gestureHandlers) {
        handler(gesture);
      }
    });
  }

  /**
   * Map SDK events to gesture events.
   * Handles all known quirks:
   * - CLICK_EVENT=0 normalizes to undefined
   * - Simulator sends sysEvent for clicks
   * - Hardware sends listEvent/textEvent depending on container
   */
  private mapEventToGesture(event: EvenHubEvent): GestureEvent | null {
    const eventType =
      event.listEvent?.eventType ??
      event.textEvent?.eventType ??
      event.sysEvent?.eventType;

    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      return { kind: "SCROLL_FWD" };
    }

    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      return { kind: "SCROLL_BACK" };
    }

    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      return { kind: "DOUBLE_TAP" };
    }

    // CLICK_EVENT = 0 becomes undefined during SDK deserialization
    if (
      eventType === OsEventTypeList.CLICK_EVENT ||
      eventType === undefined
    ) {
      return { kind: "TAP", listIndex: event.listEvent?.currentSelectItemIndex };
    }

    if (eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      return { kind: "FOREGROUND_ENTER" };
    }

    if (eventType === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
      return { kind: "FOREGROUND_EXIT" };
    }

    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Send BMP image data to an existing image container via updateImageRawData. */
  private async sendBmpData(
    containerID: number,
    containerName: string,
    bmpData: Uint8Array,
  ): Promise<void> {
    if (!this.bridge) return;
    console.log(`[GlassAdapter] sendBmpData container=${containerName} size=${bmpData.length}B`);
    await this.bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID,
        containerName,
        imageData: bmpData,
      }),
    );
  }

  private async waitForBridge(): Promise<EvenAppBridge> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const bridge = await Promise.race([
        waitForEvenAppBridge(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error(
                "Timed out waiting for Even bridge. Open this URL from Even app dev mode.",
              ),
            );
          }, TIMING.BRIDGE_TIMEOUT_MS);
        }),
      ]);

      return bridge;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
