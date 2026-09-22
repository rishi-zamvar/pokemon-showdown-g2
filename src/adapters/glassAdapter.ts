import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ListContainerProperty,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
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
import { SendQueue, assertContainerDeclared, assertImageUpdate, assertPageContainers } from "./containerGuards";
import type { ContainerLike, PageConfigLike } from "./containerGuards";
import { blankSprite } from "../animation/SpriteEffects";
import type { GestureEvent, GlassAdapter, MenuItem, StatusBar, Unsubscribe } from "../types/contracts";

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
  /**
   * Menu dedupe state, its OWN pair. Sharing lastScrollTime would make a menu
   * click eat the next scroll — different windows, different reasons.
   */
  private lastMenuItemID: number | null = null;
  private lastMenuItemTime = 0;
  private readonly queue = new SendQueue();

  /**
   * The containers the CURRENT page declares, with their kind and size.
   *
   * PER PAGE, not cumulative. Plan 13-02 built this cumulative on the belief
   * that "rebuildPageContainer does NOT remove containers absent from the new
   * config". That belief is wrong, and the boot log says so directly: the
   * FIRST showOverlayHud blanks container 2 successfully (the preceding page
   * declared it), the rebuild that follows omits container 2, and the very
   * next showOverlayHud's blank comes back
   * `TextContainerUpgrade failed: container 2 not found` — research-11, on
   * every boot, from a container a cumulative map still claims exists.
   *
   * What actually persists across a rebuild is the PIXELS, not the container:
   * lvgl does not clear the canvas, so stale status text stays visible while
   * the container object behind it is gone. That is why the blank in
   * showOverlayHud still has to happen on the first overlay (while the
   * container is alive) and must be skipped on every one after it, and it is
   * also why the leftover pixels are Phase 14's problem, not something a
   * textContainerUpgrade can reach.
   *
   * Read by sendBmpData (REND-04, dimensions) and by updateText /
   * showOverlayHud (REND-06, existence).
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
   * Record what a create/rebuild that ACTUALLY SUCCEEDED just declared, and
   * forget the page it replaced. Called from all three success paths and
   * nowhere else — a missing entry is a hard throw on updateText, the hottest
   * path in this file, so recording a page that never rendered would be worse
   * than recording none.
   */
  private recordPage(config: PageConfigLike): void {
    // Replace, do not accumulate: the page that just went out is the page the
    // hardware has. See the field comment for the boot log that proves it.
    this.declaredContainers.clear();
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
   *
   * `menu` is the native OS context menu. OMISSION IS THE SIGNIFICANT STATE
   * (D-09): a rebuild without menuObject clears the custom menu and restores
   * the OS default, which is why only the root page passes one.
   */
  async showList(items: string[], statusText: string, menu?: readonly MenuItem[]): Promise<void> {
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
      // Spread, not `menu: menu`. An explicit `undefined` key and an absent
      // key are not the same thing once this reaches RebuildPageContainer,
      // and absence is the state that clears the menu (D-09).
      ...(menu ? { menu } : {}),
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
    // D-08: a textContainerUpgrade aimed at a container no page has declared
    // is answered by the firmware with `container N not found` on a stream
    // nobody reads. Containers 1 and 2 are declared by every page that can
    // precede an updateText, so these refusals firing is a genuine regression
    // and must be loud rather than skipped.
    assertContainerDeclared(CONTAINER_IDS.content, this.declaredContainers.get(CONTAINER_IDS.content));
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

    assertContainerDeclared(CONTAINER_IDS.status, this.declaredContainers.get(CONTAINER_IDS.status));
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

    // Container 3 only exists once showText's split status bar has been
    // rendered; showBattleHud declares 1, 2, 4 and 5 only. "Has it got
    // content" was a PROXY for "does it exist" — ask the registry the real
    // question instead, and keep the content test because a blank right-hand
    // status is not worth a ~104 ms host call.
    if (status.right && this.declaredContainers.has(CONTAINER_IDS.statusRight)) {
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

    // Containers 4 and 5 are declared UNCONDITIONALLY, blank when there is no
    // sprite. They used to be omitted whenever the argument was undefined, and
    // that omission is a landmine under the REND-04 guard:
    //
    //   - the two containers ALTERNATE declared sizes. showOverlayHud declares
    //     them 144x132; this method declares them 96x96.
    //   - the argument is regularly undefined — battleHudRenderer.ts:164-165
    //     yields `oppSprite ?? undefined` whenever the bitmap is not yet
    //     cached or getDexNum() returns 0.
    //   - omitting the container leaves the CUMULATIVE registry holding
    //     144x132 from the last overlay, while AnimationEngine.switchAnimation
    //     sends three 96x96 frames unconditionally before its
    //     `if (!finalSprite) return`. assertImageUpdate would then refuse
    //     96x96-against-144x132 and the rejection would escape playTurn
    //     uncaught — a NEW intermittent hang in the phase whose purpose is
    //     removing one.
    //
    // Visible consequence, and it is an improvement: a missing sprite now
    // reads as an empty slot instead of leaving whatever the previous page
    // rendered there (often a 144x132 overlay composite), because
    // rebuildPageContainer does not remove absent containers. An all-black
    // 96x96 send is already what a fainted Pokemon gets
    // (battleHudRenderer.ts:151-152), and ScreenController.ts:472-473 already
    // passes blankSprite() here for this same reason.
    const opp = oppSprite ?? blankSprite();
    const ply = playerSprite ?? blankSprite();

    // Opponent sprite: top-right, vertically centered in top half
    // Player sprite:   bottom-left, vertically centered in bottom half
    const imageContainers: ImageContainerProperty[] = [
      new ImageContainerProperty({
        xPosition: GLASS_LAYOUT.x + GLASS_LAYOUT.width - s,
        yPosition: GLASS_LAYOUT.y + Math.floor((halfH - s) / 2),
        width: s,
        height: s,
        containerID: CONTAINER_IDS.oppSprite,
        containerName: CONTAINER_NAMES.oppSprite,
      }),
      new ImageContainerProperty({
        xPosition: GLASS_LAYOUT.x,
        yPosition: GLASS_LAYOUT.y + halfH + Math.floor((halfH - s) / 2),
        width: s,
        height: s,
        containerID: CONTAINER_IDS.playerSprite,
        containerName: CONTAINER_NAMES.playerSprite,
      }),
    ];

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
      imageObject: imageContainers,
      textObject: [textContainer, statusContainer],
    });

    // Send BMP image data AFTER container creation. These were inline copies of
    // sendBmpData with the same arguments — the duplication predated it and was
    // the only reason one host call had two different log shapes.
    await this.sendBmpData(CONTAINER_IDS.oppSprite, CONTAINER_NAMES.oppSprite, opp);
    await this.sendBmpData(CONTAINER_IDS.playerSprite, CONTAINER_NAMES.playerSprite, ply);
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
    oppCompositeBmp: Uint8Array,
    playerCompositeBmp: Uint8Array,
    listItems: string[],
    listStatus: string,
  ): Promise<void> {
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
    //
    // Container 2 only exists here if the page being replaced declared it —
    // before the first showBattleHud it never has, and from the second overlay
    // onward the previous rebuild already destroyed it. That is not an error
    // to swallow in a try/catch, it is a question with an answer (D-08,
    // research-11): the registry knows. The catch that used to be here hid a
    // real `TextContainerUpgrade failed: container 2 not found` on every boot.
    if (this.declaredContainers.has(CONTAINER_IDS.status)) {
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
    }

    await this.renderContainers({
      imageObject: [oppContainer, playerContainer],
      listObject: [listContainer],
    });

    // Diagnostic: log BMP sizes so we can verify correct data reaches each container.
    // Expected: opp/player ~2702B (144x132 1-bit).
    console.debug(
      `[showOverlayHud] BMP sizes: opp=${oppCompositeBmp.length}B ` +
      `player=${playerCompositeBmp.length}B`,
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
    // Order must match the imageObject array order above (opp, player).
    await this.sendBmpData(CONTAINER_IDS.oppSprite, CONTAINER_NAMES.oppSprite, oppCompositeBmp);
    await this.sendBmpData(CONTAINER_IDS.playerSprite, CONTAINER_NAMES.playerSprite, playerCompositeBmp);
  }

  /**
   * Update a sprite image in-place without rebuilding the page.
   *
   * The animation path. It used to issue its own updateImageRawData, which
   * meant every animation frame bypassed both the dimension guard and the only
   * log line the host-call counter can see. One guarded path is the whole
   * point of a choke point, so this now delegates — the arguments were already
   * identical.
   *
   * @param containerID - Numeric ID of the image container (from CONTAINER_IDS).
   * @param containerName - Name of the image container (from CONTAINER_NAMES).
   * @param bmpData - BMP (or, from Phase 15, PNG) bytes sized exactly to the container.
   */
  async updateImage(containerID: number, containerName: string, bmpData: Uint8Array): Promise<void> {
    await this.sendBmpData(containerID, containerName, bmpData);
  }

  /**
   * INPUT-05. exitMode 1, not 0: 0 closes the app directly, 1 raises the
   * foreground interaction layer and lets the wearer decide — that layer IS
   * the dialogue Even Hub requires the root page to invoke.
   *
   * D-02: after this dialogue is dismissed, every updateImageRawData returns
   * sendFailed in 1-3 ms and never recovers until restart. There is
   * deliberately no recovery attempt here; three were tried upstream and all
   * failed (rebuild-on-appearance wipes the images, rebuild-after-cancel does
   * not clear the wedge, and re-calling createStartUpPageContainer is rejected
   * `invalid` after blocking ~2.1 s). The mitigation is that this method has
   * exactly one caller and it is an explicit menu selection.
   *
   * BOTH LOG LINES ARE LOAD-BEARING — DO NOT DELETE THEM TO SATISFY A GREP.
   * The pre-call line is the ONLY positive evidence that the call happened: if
   * the dialogue wedges the bridge the promise may never settle and the
   * "after" line never arrives. console.log, never warn/error — the harness
   * treats a console error as a run failure.
   */
  async exitApp(): Promise<void> {
    console.log('[GlassAdapter] shutDownPageContainer(1)');
    // Through this.call like every other bridge call: the SendQueue is the
    // adapter's single choke point, and an exit racing an in-flight image send
    // is exactly the class of bug 13-01 removed.
    const ok = await this.call((b) => b.shutDownPageContainer(1));
    console.log(`[GlassAdapter] shutDownPageContainer(1) -> ${ok}`);
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
    /**
     * Native OS context menu for THIS page. Every other caller of this method
     * (showText, showMessage, showBattleHud, showOverlayHud) passes nothing
     * and therefore CLEARS the custom menu on every rebuild. That is D-09 and
     * it is deliberate: the menu is a root-page affordance, not a global one,
     * and D-03 says no non-root screen may reach the exit dialogue.
     */
    menu?: readonly MenuItem[];
  }): Promise<void> {
    // Menu items are NOT containers — assertPageContainers counts
    // list+text+image only, and the firmware budget is per container.
    const containerTotalNum =
      (payload.listObject?.length ?? 0) +
      (payload.textObject?.length ?? 0) +
      (payload.imageObject?.length ?? 0);

    const config = {
      containerTotalNum,
      ...(payload.listObject ? { listObject: payload.listObject } : {}),
      ...(payload.textObject ? { textObject: payload.textObject } : {}),
      ...(payload.imageObject ? { imageObject: payload.imageObject } : {}),
      ...(payload.menu
        ? {
            menuObject: new MenuContainerProperty({
              menuItems: payload.menu.map(
                (m) => new MenuItemProperty({ itemID: m.id, itemName: m.name }),
              ),
            }),
          }
        : {}),
    };

    // ORDERING IS LOAD-BEARING: assertPage runs validateEvenHubPageContainer,
    // which is what enforces the menu's 10-item / non-zero / unique /
    // 32-UTF-8-BYTE rules (D-07). A menu built after this line is an
    // unvalidated menu, and a menu the SDK rejects builds NOTHING — no list,
    // no status, no page at all.
    this.assertPage(config);

    // After, never before: the line has to mean "validated and about to be
    // sent", not "attempted". Console only — the page was being rebuilt
    // regardless, so this adds no host call.
    if (payload.menu) {
      console.log(`[GlassAdapter] menu declared: ${payload.menu.length} item(s)`);
    }

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
      // INPUT-02, and it MUST be tested before mapEventToGesture (D6 / Phase
      // 16): that function maps EVERY unrecognised eventType — including
      // `undefined`, which is how the SDK deserialises CLICK_EVENT=0 — to TAP.
      // A menu click carries no eventType at all, so falling through would
      // turn "the wearer opened the menu and chose About" into a stray TAP
      // that commits a move. Presence of the OBJECT is the test, NOT
      // `itemID !== undefined`: an event that arrives with the id missing must
      // still be swallowed here, never handed to the gesture mapper.
      if (event.menuItemClickEvent) {
        const itemID = event.menuItemClickEvent.itemID;
        if (itemID === undefined) {
          console.log('[GlassAdapter] menuItemClickEvent with no itemID — ignored');
          return;
        }

        // The firmware emits DUPLICATE events ~50-100 ms apart for one
        // physical transition. Undeduped, one selection of "Exit" fires the
        // dialogue twice and one selection of "Battle Speed" skips a preset.
        const now = Date.now();
        if (
          itemID === this.lastMenuItemID &&
          now - this.lastMenuItemTime < TIMING.MENU_DEDUPE_MS
        ) {
          console.log(
            `[GlassAdapter] menu: duplicate itemID=${itemID} within ${TIMING.MENU_DEDUPE_MS}ms — dropped`,
          );
          return;
        }
        // Refreshed on ACCEPT only, never on a drop: the window measures time
        // since the last DELIVERED click, so a burst cannot extend itself
        // indefinitely. Irrelevant at the observed 50-100 ms duplicate
        // spacing; stated because the alternative is a silently different
        // policy.
        this.lastMenuItemID = itemID;
        this.lastMenuItemTime = now;

        console.log(`[GlassAdapter] menu: itemID=${itemID}`);
        for (const handler of this.gestureHandlers) {
          handler({ kind: 'MENU_ITEM', menuItemID: itemID });
        }
        return;
      }

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
    //
    // REND-04, before the log line so a refused send is never counted as a
    // host call: the firmware TILES data smaller than its container instead of
    // erroring, so a mismatch renders something plausible and wrong and says
    // so nowhere. 8 bytes of header arithmetic, no host round-trip.
    assertImageUpdate(containerID, this.declaredContainers.get(containerID), bmpData);
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
