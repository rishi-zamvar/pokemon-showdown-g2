/**
 * The container safety layer (REND-03..REND-06).
 *
 * IMPORTS NOTHING, AND MUST KEEP IMPORTING NOTHING. This module is loaded two
 * ways: extensionless from glassAdapter.ts (Vite) and as
 * `../src/adapters/containerGuards.ts` from the harness (Node strip-only,
 * which requires the extension). The project's src/ convention is `.js`
 * specifiers, which Node cannot resolve, so a single relative import here
 * would break `node harness/selfCheck.ts` outright. Structural local types
 * only; no SDK, no ../config/constants.
 *
 * Plans 13-02 and 13-03 add the geometry and dimension guards here. Today it
 * holds the queue.
 */

/**
 * The platform rule this exists for: "Concurrent sends: Not allowed - queue
 * image updates sequentially." AnimationEngine.ts:282 runs spriteFlash and
 * hpDrain as concurrent Promise.all branches and both issue
 * updateImageRawData; the bridge deadlocks roughly one turn in twenty
 * (research-14 — the hung turn issued 5 sends against 10-21 on healthy turns,
 * i.e. it died partway through its send sequence).
 *
 * Serialising HERE, at the adapter's single choke point, fixes every caller
 * including the ones that do not exist yet. Rewriting that one Promise.all
 * would fix one caller and leave the next one free to reintroduce the race.
 *
 * Cost, so nobody reads it as a regression: sends stop overlapping, so wall
 * time per animation entry moves from max(branches) to about sum(sends) —
 * single-digit SECONDS added per turn at ~104 ms a send, against a 120 s
 * TURN_MS budget. That is the price of a game that does not stop forever.
 */
export class SendQueue {
  // NOT a constructor parameter property: Node strips types only and rejects
  // those at runtime (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX) while tsc stays
  // silent — see harness/logs.ts:121 for the same scar.
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Run `fn` once every previously-submitted task has settled. Results come
   * back in submission order and each caller gets its own task's value.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    // .then(fn, fn): a prior send that REJECTED must not block the sends
    // queued behind it — one failed frame would otherwise wedge the game
    // exactly as badly as the deadlock this replaces.
    const result = this.tail.then(fn, fn);
    // Swallow separately so the queue's own copy of a rejection never becomes
    // an unhandled rejection, while the caller's copy still rejects.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

// ---------------------------------------------------------------------------
// REND-03: the geometry / count guard
// ---------------------------------------------------------------------------

/**
 * Measured firmware limits. ONE oversized container fails the WHOLE
 * rebuildPageContainer call — that is what made the game unplayable in defect
 * #2, not a partial render — so these are checked before the call, not after.
 */
export const LIMITS = {
  IMAGE_W_MIN: 20,
  IMAGE_W_MAX: 288,
  IMAGE_H_MIN: 20,
  IMAGE_H_MAX: 144,
  MAX_IMAGE: 4,
  MAX_OTHER: 8,
  MAX_TOTAL: 12,
  MAX_NAME_CHARS: 16,
} as const;

/**
 * Structural on purpose, so this file never imports the SDK (see the header).
 * The SDK's ListContainerProperty / TextContainerProperty / ImageContainerProperty
 * all satisfy it; ImageContainerProperty has no isEventCapture at all, which is
 * why every field here is optional.
 */
export interface ContainerLike {
  containerID?: number;
  containerName?: string;
  width?: number;
  height?: number;
  isEventCapture?: number;
}

export interface PageConfigLike {
  containerTotalNum?: number;
  listObject?: ContainerLike[];
  textObject?: ContainerLike[];
  imageObject?: ContainerLike[];
}

function label(c: ContainerLike): string {
  return `id=${c.containerID ?? "?"} name="${c.containerName ?? "?"}"`;
}

/**
 * Side-effect free: it throws and says nothing. The adapter catches, logs the
 * `adapter: rejected container` line and rethrows, so the guard stays a pure
 * function you can call a hundred times in a self-check without a log storm.
 */
function refuse(reason: string): never {
  throw new Error(`adapter: rejected container page — ${reason}`);
}

/**
 * REFUSE, never clamp (D-02). A container outside the firmware limits is a
 * layout bug in the caller; quietly resizing it renders the wrong page instead
 * of failing, which is precisely how the 576px team bar survived Phase 10's
 * 15/15 verification.
 *
 * This does NOT replace the SDK's validateEvenHubPageContainer() and it is not
 * replaced by it — verified live against 0.0.15, the SDK returns {valid:true}
 * for a 9999x9999 image container, for a 13-image page and for
 * containerTotalNum:13. It covers z-order, menus and text brightness; this
 * covers geometry and counts. Neither is sufficient alone (D-05).
 *
 * Deliberately NOT checked: xPosition / yPosition bounds. No measured limit
 * exists for them, and inventing one is how a guard starts refusing correct
 * pages.
 */
export function assertPageContainers(config: PageConfigLike): void {
  const images = config.imageObject ?? [];
  const lists = config.listObject ?? [];
  const texts = config.textObject ?? [];
  const all = [...images, ...lists, ...texts];

  // 1. Image geometry. Image containers only — bootstrapStartup's text
  //    container is a legal 576x288 and must stay legal.
  for (const c of images) {
    const w = c.width;
    const h = c.height;
    if (w === undefined) {
      refuse(`image container ${label(c)} declares no width; the SDK makes it optional but the firmware does not (${LIMITS.IMAGE_W_MIN}-${LIMITS.IMAGE_W_MAX})`);
    }
    if (h === undefined) {
      refuse(`image container ${label(c)} declares no height; the SDK makes it optional but the firmware does not (${LIMITS.IMAGE_H_MIN}-${LIMITS.IMAGE_H_MAX})`);
    }
    if (w < LIMITS.IMAGE_W_MIN || w > LIMITS.IMAGE_W_MAX) {
      refuse(`image container ${label(c)} has width ${w}, outside the firmware limit ${LIMITS.IMAGE_W_MIN}-${LIMITS.IMAGE_W_MAX}`);
    }
    if (h < LIMITS.IMAGE_H_MIN || h > LIMITS.IMAGE_H_MAX) {
      refuse(`image container ${label(c)} has height ${h}, outside the firmware limit ${LIMITS.IMAGE_H_MIN}-${LIMITS.IMAGE_H_MAX}`);
    }
  }

  // 2. Counts. MAX_IMAGE + MAX_OTHER === MAX_TOTAL today, so the total rule is
  //    a backstop that only bites if those two ever diverge; check 43 asserts
  //    that relationship so it cannot rot into a dead branch unnoticed.
  const other = lists.length + texts.length;
  if (images.length > LIMITS.MAX_IMAGE) {
    refuse(`page declares ${images.length} image containers, limit ${LIMITS.MAX_IMAGE}`);
  }
  if (other > LIMITS.MAX_OTHER) {
    refuse(`page declares ${other} non-image containers, limit ${LIMITS.MAX_OTHER}`);
  }
  if (all.length > LIMITS.MAX_TOTAL) {
    refuse(`page declares ${all.length} containers in total, limit ${LIMITS.MAX_TOTAL}`);
  }

  // 3. Exactly one isEventCapture:1, or the page takes no input at all / the
  //    wrong container takes it.
  const captures = all.filter((c) => c.isEventCapture === 1);
  if (captures.length !== 1) {
    const which = captures.map(label).join(", ") || "none";
    refuse(`page declares ${captures.length} containers with isEventCapture:1 (${which}), exactly 1 required`);
  }

  // 4. containerName length. The firmware truncates silently past 16, leaving
  //    a container the app can never address by name again.
  for (const c of all) {
    const n = c.containerName;
    if (n !== undefined && n.length > LIMITS.MAX_NAME_CHARS) {
      refuse(`container ${label(c)} has a ${n.length}-character containerName, limit ${LIMITS.MAX_NAME_CHARS}`);
    }
  }

  // 5. The config lying about itself.
  if (config.containerTotalNum !== undefined && config.containerTotalNum !== all.length) {
    refuse(`config declares containerTotalNum ${config.containerTotalNum} but carries ${all.length} containers`);
  }
}
