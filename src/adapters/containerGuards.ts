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
