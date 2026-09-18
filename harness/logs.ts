/**
 * Two log streams merged into one ordered buffer, plus the failure policy
 * (HARN-02, HARN-05, D-03, D-04, D-05).
 *
 * The simulator writes container validation failures to its OWN stdout and they
 * appear nowhere in /api/console. A harness that read only the console API
 * would have passed the exact defect that made this game unplayable, so both
 * streams land here with a shared `seq` and the same failure policy applied to
 * each.
 */
import type { ConsoleEntry, Driver } from "./driver.ts";

export interface LogLine {
  /** harness-assigned ordering across both sources */
  seq: number;
  source: "console" | "stdout";
  /** console level, or the level parsed out of the stdout line */
  level: string;
  message: string;
}

// ---------------------------------------------------------------------------
// D-05 failure policy. Two named rule sets so Phases 13-19 can cite them.
// Warnings are NOT tolerated on either stream: "rebuildPageContainer failed
// after retry" was logged at warn level the entire time the game was unplayable.
// ---------------------------------------------------------------------------

/** a console message starting with any of these is a failure regardless of level */
export const CONSOLE_FAILURE_PREFIXES = ["[uncaught]", "[unhandledrejection]", "[fetch]"] as const;

/** ...as is a console message matching any of these, again regardless of level */
export const CONSOLE_FAILURE_PATTERNS: RegExp[] = [
  /rebuildPageContainer failed/,
  /createStartUpPageContainer threw/,
  /startup failed/,
];

/**
 * HARN-02. `WARN` alone is enough — the container-validation line that broke
 * the app is a WARN, and "validation failed" / "not found" are spelled out so
 * the rule survives a simulator that stops prefixing its level.
 */
export const STDOUT_FAILURE_PATTERNS: RegExp[] = [
  /\b(WARN|ERROR)\b/,
  /validation failed/,
  /not found/,
];

/**
 * Escape hatch, deliberately EMPTY. Adding an entry means naming one specific
 * benign simulator line; a speculative pre-population here is how HARN-02 would
 * get quietly turned off one regex at a time.
 */
export const ALLOWED_STDOUT: RegExp[] = [];

export function isFailureLine(l: LogLine): boolean {
  if (l.source === "stdout") {
    if (ALLOWED_STDOUT.some((re) => re.test(l.message))) return false;
    return STDOUT_FAILURE_PATTERNS.some((re) => re.test(l.message));
  }
  if (l.level === "error") return true;
  if (CONSOLE_FAILURE_PREFIXES.some((p) => l.message.startsWith(p))) return true;
  return CONSOLE_FAILURE_PATTERNS.some((re) => re.test(l.message));
}

// ---------------------------------------------------------------------------
// host-call accounting (D-13)
// ---------------------------------------------------------------------------

/**
 * ponytail: counts inferred from existing adapter logs rather than adding
 * instrumentation to src/ — this phase only observes (D-13 needs the number
 * recorded, not exact). Two known inaccuracies, both documented below; Phase 19
 * / PERF-04 owns turning this into an enforced ceiling and must add the
 * adapter-side log lines first.
 *
 * `sendBmpData container=` is now the SINGLE marker for `updateImageRawData`.
 * It used to be one of two: `showBattleHud` carried inline copies of
 * sendBmpData's call that logged `sending (opp|player)Sprite BMP` instead.
 * Plan 13-01 collapsed those two sites onto sendBmpData, which moves two calls
 * from one log pattern to the other — one line each way, so the per-turn count
 * is unchanged. That count is the evidence that diagnosed research-14 (5 sends
 * on the hung turn against 10-21 on healthy ones), so it must keep counting.
 *
 * KNOWN INACCURACY 1 — `rebuildPageContainer` is a known-zero placeholder. The
 * ONLY console line in the app mentioning it is the failure warning at
 * glassAdapter.ts:577, so any "count non-failure mentions" rule yields 0
 * forever. Phase 19 MUST add a success-path log inside renderContainers before
 * PERF-02's "at most 2 host calls" can be asserted at all. Not faked here.
 *
 * KNOWN INACCURACY 2 — showBattleHud's FIRST updateImageRawData
 * (glassAdapter.ts ~:295) has no log line at all, so that path undercounts by
 * one per call. Phase 19's single instrumentation point fixes both.
 */
const HOST_CALL_PATTERNS: Array<[RegExp, string]> = [
  [/\[GlassAdapter\] sendBmpData container=/, "updateImageRawData"],
  [/\[GlassAdapter\] createStartUpPageContainer result/, "createStartUpPageContainer"],
  // known-zero, see KNOWN INACCURACY 1 above. Kept in the table so Phase 19 has
  // an obvious place to point the new success log at.
  [/\[GlassAdapter\] rebuildPageContainer ok/, "rebuildPageContainer"],
];

export class LogStream {
  /**
   * Monotonic for the LIFETIME of this object — reset() must not zero it.
   *
   * This is the B2 guard. On the attach path there is no child process to tee,
   * so onStdout never fires; without a counter that survives the per-step
   * console clear, a completely dead stdout tee looks exactly like a clean run
   * and HARN-02 switches itself off in silence.
   */
  stdoutLineCount = 0;

  private lines: LogLine[] = [];
  private lastConsoleId = 0;
  private seq = 0;
  // NOT a constructor parameter property: Node's strip-only TypeScript mode
  // rejects those outright (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX) and tsc does not
  // warn, so it fails only at runtime.
  private readonly driver: Driver;

  constructor(driver: Driver) {
    this.driver = driver;
  }

  /**
   * Called synchronously from sim.ts's line reader so stdout ordering is
   * preserved relative to console polls within a step.
   */
  pushStdout(rawLine: string): void {
    const message = rawLine.trim();
    if (message.length === 0) return;
    const level = /\b(TRACE|DEBUG|INFO|WARN|ERROR)\b/.exec(message)?.[1]?.toLowerCase() ?? "info";
    this.lines.push({ seq: this.seq++, source: "stdout", level, message });
    this.stdoutLineCount++;
  }

  /** Drain new console entries (D-04: incremental); returns only what is new. */
  async poll(): Promise<LogLine[]> {
    const { entries } = await this.driver.consoleSince(this.lastConsoleId);
    const fresh: LogLine[] = [];
    for (const e of entries as ConsoleEntry[]) {
      const line: LogLine = {
        seq: this.seq++,
        source: "console",
        level: e.level,
        message: e.message,
      };
      this.lines.push(line);
      fresh.push(line);
      this.lastConsoleId = Math.max(this.lastConsoleId, e.id);
    }
    return fresh;
  }

  /**
   * Per scenario step (D-04), so assertions are scoped to one step.
   * `seq` and `stdoutLineCount` survive on purpose.
   */
  async reset(): Promise<void> {
    await this.driver.clearConsole();
    this.lines = [];
    this.lastConsoleId = 0;
  }

  all(): LogLine[] {
    return this.lines;
  }

  failures(): LogLine[] {
    return this.lines.filter(isFailureLine);
  }

  hostCalls(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const l of this.lines) {
      if (l.source !== "console") continue;
      for (const [re, name] of HOST_CALL_PATTERNS) {
        if (re.test(l.message)) {
          counts[name] = (counts[name] ?? 0) + 1;
          break;
        }
      }
    }
    return counts;
  }

  /**
   * Watermark. Callers snapshot this before sending an input and then filter
   * all() to `l.seq >= watermark`, which is how waitScreen avoids matching a
   * [screen] line that was logged before the input was even sent (B4).
   */
  nextSeq(): number {
    return this.seq;
  }
}
