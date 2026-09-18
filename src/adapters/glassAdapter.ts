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
  formatEvenHubPageContainerValidationError,
  validateEvenHubPageContainer,
  waitForEvenAppBridge,
  type EvenHubEvent,
  type EvenHubPageContainerLike,
} from "@evenrealities/even_hub_sdk";
import {
  CONTAINER_IDS,
  CONTAINER_NAMES,
  GLASS_LAYOUT,
  OVERLAY_LAYOUT,
  SPRITE_CONFIG,
  TIMING,
} from "../config/constants";
import { SendQueue, assertPageContainers } from "./containerGuards";
import type { ContainerLike, PageConfigLike } from "./containerGuards";
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
  private readonly queue = new SendQueue();

  /**
   * Every container ever successfully declared, with its latest kind and size.
   *
   * CUMULATIVE ON PURPOSE. rebuildPageContainer does NOT remove containers that
   * are absent from the new config — they persist on screen with their last
   * rendered content (see the comment in showBattleHud; both blanking
   * workarounds in this file exist because of it). So "does this container
   * exist on the hardware" means "was it ever declared by a create/rebuild that
   * SUCCEEDED", not "is it in the config we just sent". A per-page map would
   * report container 8 as absent while it is visibly on screen, and plan 13-03
   * would then skip a blank that is genuinely needed.
   *
   * Nothing reads it yet; plan 13-03 does.
   */
  private readonly declaredContainers = new Map<number, {
    kind: "image" | "text" | "list";
    name: string;
    width: number;
    height: number;
  }>();

  /**
   * EVERY SDK call in this file goes through here. That is what makes the
   * serialisation total: two sends are never in flight at once no matter which
   * caller issued them, including callers that do not exist yet (D-06,
   * research-14 — the game hung ~1 turn in 20 because AnimationEngine.ts:282
   * runs spriteFlash and hpDrain concurrently and both send images).
   *
   * NEVER call this from inside a task it runs: a queued method that queues
   * again deadlocks on itself. `queue.run` appears exactly once in this file,
   * and every enqueued task is exactly one bridge call.
   */
  private call<T>(fn: (b: EvenAppBridge) => Promise<T>): Promise<T> {
    const b = this.bridge;
    if (!b) throw new Error("Not connected. Call connect() first.");
    return this.queue.run(() => fn(b));
  }

  /**
   * Two guards, because neither covers the other (D-05). Verified live against
   * SDK 0.0.15: validateEvenHubPageContainer() returned {valid:true} for a
   * 9999x9999 image container, for a 13-image page and for
   * containerTotalNum:13, so it cannot be trusted for geometry or counts.
   * Ours does not cover z-order, menus or text brightness, so it cannot
   * replace the SDK's either. Both are pure local calls — no host round-trip.
   *
   * REFUSES, never clamps (D-02): a page outside the limits is a layout bug in
   * the caller, and one oversized container fails the entire rebuild.
   */
  private assertPage(config: PageConfigLike & EvenHubPageContainerLike): void {
    try {
      assertPageContainers(config);
    } catch (e) {
      // Log here rather than inside the guard so the guard stays side-effect
      // free, while the refusal is still visible in the harness console stream
      // even if a caller swallows the exception. Catch, log, rethrow.
      console.error(`[glass] ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }

    const r = validateEvenHubPageContainer(config);
    if (!r.valid) {
      const detail = formatEvenHubPageContainerValidationError(r);
      console.error(`[glass] adapter: rejected container page (SDK): ${detail}`);
      throw new Error(`adapter: rejected container page (SDK): ${detail}`);
    }
  }

  /**
   * Record what a create/rebuild that ACTUALLY SUCCEEDED just declared.
   * Called from all three success paths and nowhere else — a missing entry
   * becomes a hard throw on updateText in plan 13-03, the hottest path here.
   */
  private recordPage(config: PageConfigLike): void {
    const add = (kind: "image" | "text" | "list", cs: ContainerLike[] | undefined): void => {
      for (const c of cs ?? []) {
        if (c.containerID === undefined) continue;
        this.declaredContainers.set(c.containerID, {
          kind,
          name: c.containerName ?? "",
          width: c.width ?? 0,
          height: c.height ?? 0,
        });
      }
    };
    add("image", config.imageObject);
    add("text", config.textObject);
    add("list", config.listObject);
  }

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

    this.assertPage(config);

    console.log('[GlassAdapter] bootstrapStartup config:', JSON.stringify(config));
    const result = await this.call((b) =>
      b.createStartUpPageContainer(new CreateStartUpPageContainer(config)),
    );
    console.log('[GlassAdapter] bootstrapStartup result:', result);

    if (result === StartUpPageCreateResult.success) {
      this.startupDone = true;
      this.recordPage(config);   // population point 1: container 1 now exists
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
    await this.call((b) =>
      b.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: CONTAINER_IDS.content,
          containerName: CONTAINER_NAMES.content,
          contentOffset: 0,
          contentLength: text.length,
          content: text.slice(0, 2000),
        }),
      ),
    );

    await this.call((b) =>
      b.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: CONTAINER_IDS.status,
          containerName: CONTAINER_NAMES.status,
          contentOffset: 0,
          contentLength: status.left.length,
          content: status.left.slice(0, 2000),
        }),
      ),
    );

    // Only update statusRight if it has content — container 3 doesn't exist
    // during animation (showBattleHud only creates containers 1, 2, 4, 5).
    if (status.right) {
      await this.call((b) =>
        b.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: CONTAINER_IDS.statusRight,
            containerName: CONTAINER_NAMES.statusRight,
            contentOffset: 0,
            contentLength: status.right.length,
            content: status.right.slice(0, 2000),
          }),
        ),
      );
    }
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
    try {
      await this.call((b) =>
        b.updateImageRawData(
          new ImageRawDataUpdate({
            containerID: CONTAINER_IDS.teamBar,
            containerName: CONTAINER_NAMES.teamBar,
            imageData: emptyTeamBarBmp(),
          }),
        ),
      );
    } catch {
      // Container 8 doesn't exist yet — nothing to blank, safe to ignore.
    }

    await this.renderContainers({
      imageObject: imageContainers.length > 0 ? imageContainers : undefined,
      textObject: [textContainer, statusContainer],
    });

    // Send BMP image data AFTER container creation. These were inline copies of
    // sendBmpData with the same arguments — the duplication predated it and was
    // the only reason one host call had two different log shapes.
    if (oppSprite) {
      await this.sendBmpData(CONTAINER_IDS.oppSprite, CONTAINER_NAMES.oppSprite, oppSprite);
    }
    if (playerSprite) {
      await this.sendBmpData(CONTAINER_IDS.playerSprite, CONTAINER_NAMES.playerSprite, playerSprite);
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
    try {
      await this.call((b) =>
        b.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: CONTAINER_IDS.status,
            containerName: CONTAINER_NAMES.status,
            contentOffset: 0,
            contentLength: 0,
            content: '',
          }),
        ),
      );
    } catch {
      // Container 2 doesn't exist yet — safe to ignore.
    }

    await this.renderContainers({
      imageObject: [teamBarContainer, oppContainer, playerContainer],
      listObject: [listContainer],
    });

    // Diagnostic: log BMP sizes so we can verify correct data reaches each container.
    // Expected: teamBar ~1790B (576x24 1-bit), opp/player ~2702B (144x132 1-bit).
    // If playerBmp length equals teamBarBmp length, cache swapped them.
    console.debug(
      `[showOverlayHud] BMP sizes: teamBar=${teamBarBmp.length}B ` +
      `opp=${oppCompositeBmp.length}B player=${playerCompositeBmp.length}B`,
    );

    // Wait 50ms after rebuildPageContainer before sending image data.
    //
    // The SDK's rebuildPageContainer reconfigures container slots asynchronously
    // on the hardware side. If updateImageRawData is called too soon, the SDK
    // may route image data using the container mapping from the *previous*
    // rebuildPageContainer call (e.g. showBattleHud's 2-image layout) instead
    // of the new 3-image layout. This produces the "wrong BMP in wrong container"
    // symptom where the player composite slot shows team bar pixel data.
    //
    // 50ms is enough for the hardware to process the rebuild response before
    // the first updateImageRawData call arrives.
    await this.delay(50);

    // Send BMP image data sequentially after container creation.
    // Order must match the imageObject array order above (teamBar, opp, player).
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
    await this.call((b) =>
      b.updateImageRawData(
        new ImageRawDataUpdate({
          containerID,
          containerName,
          imageData: bmpData,
        }),
      ),
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

    this.assertPage(config);

    if (!this.startupDone) {
      // Try createStartUpPageContainer once — if it fails, fall through to rebuildPageContainer
      try {
        const result = await this.call((b) =>
          b.createStartUpPageContainer(new CreateStartUpPageContainer(config)),
        );
        console.log('[GlassAdapter] createStartUpPageContainer result:', result);
        if (result === StartUpPageCreateResult.success) {
          this.startupDone = true;
          // Population point 2. This branch RETURNS, so it never reaches the
          // rebuild below — instrumenting only the rebuild silently skips the
          // entire first page of every cold boot.
          this.recordPage(config);
          return;
        }
      } catch (e) {
        console.warn('[GlassAdapter] createStartUpPageContainer threw:', e);
      }
      // Failed — mark as done and fall through to rebuildPageContainer.
      // NOT a population point: startupDone is set for control flow only,
      // nothing was declared. The rebuild below records on its own success.
      console.warn('[GlassAdapter] startup failed, falling through to rebuild');
      this.startupDone = true;
    }

    let ok = await this.call((b) => b.rebuildPageContainer(new RebuildPageContainer(config)));

    if (!ok) {
      await this.delay(300);
      ok = await this.call((b) => b.rebuildPageContainer(new RebuildPageContainer(config)));
    }

    if (ok) {
      // Population point 3, recorded once after the retry has settled `ok`.
      this.recordPage(config);
    } else {
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
    // No `if (!this.bridge) return` — every caller already requires a live
    // bridge, so a null one here is a programming error. Returning silently
    // turned it into a sprite that never appeared with nothing in any log;
    // call() throws instead.
    console.log(`[GlassAdapter] sendBmpData container=${containerName} size=${bmpData.length}B`);
    await this.call((b) =>
      b.updateImageRawData(
        new ImageRawDataUpdate({
          containerID,
          containerName,
          imageData: bmpData,
        }),
      ),
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
