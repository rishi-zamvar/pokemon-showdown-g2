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
  SPRITE_CONFIG,
  TIMING,
} from "../config/constants";
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
    oppSprite?: string,
    playerSprite?: string,
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

    await this.renderContainers({
      imageObject: imageContainers.length > 0 ? imageContainers : undefined,
      textObject: [textContainer, statusContainer],
    });

    // Send image data AFTER container creation (sequential — no concurrent sends)
    if (this.bridge) {
      if (oppSprite) {
        await this.bridge.updateImageRawData(
          new ImageRawDataUpdate({
            containerID: CONTAINER_IDS.oppSprite,
            containerName: CONTAINER_NAMES.oppSprite,
            imageData: oppSprite,
          }),
        );
      }
      if (playerSprite) {
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
   * Update a sprite image in-place without rebuilding the page.
   *
   * Calls the SDK's updateImageRawData directly on the existing container.
   * The container must already exist (created via showBattleHud or similar).
   *
   * @param containerID - Numeric ID of the image container (from CONTAINER_IDS).
   * @param containerName - Name of the image container (from CONTAINER_NAMES).
   * @param base64 - Raw base64 PNG string without the `data:` prefix.
   */
  async updateImage(containerID: number, containerName: string, base64: string): Promise<void> {
    if (!this.bridge) throw new Error('Not connected');
    await this.bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID,
        containerName,
        imageData: base64,
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
      const result = await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer(config),
      );

      if (result !== StartUpPageCreateResult.success) {
        throw new Error(
          `createStartUpPageContainer failed with code: ${String(result)}`,
        );
      }

      this.startupDone = true;
      return;
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
      return { kind: "TAP", listIndex: event.listEvent?.currentSelectItemIndex };
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
