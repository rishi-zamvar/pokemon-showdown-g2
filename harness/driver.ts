/**
 * HTTP client for the EvenHub simulator's automation API (HARN-01).
 *
 * Node 22's global `fetch` only — no HTTP library, no dependencies. D-01 says
 * drive the real simulator rather than a mock, so this is the whole transport
 * layer of the harness.
 */

export type InputAction =
  | "up"
  | "down"
  | "click"
  | "double_click"
  | "long_press"
  | "long_press_release"
  | "context_menu";

/** every value of InputAction, in a form that can be iterated at runtime */
export const INPUT_ACTIONS: readonly InputAction[] = [
  "up",
  "down",
  "click",
  "double_click",
  "long_press",
  "long_press_release",
  "context_menu",
];

export interface ConsoleEntry {
  id: number;
  level: string; // "log" | "warn" | "error" | "info" | "debug"
  message: string;
  ts: string;
}

export class Driver {
  readonly port: number;
  private readonly base: string;

  constructor(port: number) {
    this.port = port;
    this.base = `http://127.0.0.1:${port}`;
  }

  /**
   * Never rejects — callers poll it to decide whether a simulator is up at all,
   * and a connection refusal is the expected answer, not an error.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/ping`, { signal: AbortSignal.timeout(1500) });
      return res.ok && (await res.text()).trim() === "pong";
    } catch {
      return false;
    }
  }

  /** GET /api/screenshot/glasses — raw 576x288 RGBA PNG bytes, not base64/JSON */
  glasses(): Promise<Uint8Array> {
    return this.bytes("/api/screenshot/glasses");
  }

  /** GET /api/screenshot/webview — raw PNG bytes */
  webview(): Promise<Uint8Array> {
    return this.bytes("/api/screenshot/webview");
  }

  /**
   * D-04: incremental only. Re-reading the whole buffer would make per-step
   * assertions see every line of the run, not the step's own.
   */
  async consoleSince(id: number): Promise<{ entries: ConsoleEntry[]; total: number }> {
    const res = await fetch(`${this.base}/api/console?since_id=${id}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`GET /api/console?since_id=${id} -> HTTP ${res.status}`);
    const body = (await res.json()) as { entries?: ConsoleEntry[]; total?: number };
    return { entries: body.entries ?? [], total: body.total ?? 0 };
  }

  async clearConsole(): Promise<void> {
    const res = await fetch(`${this.base}/api/console`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`DELETE /api/console -> HTTP ${res.status}`);
  }

  /**
   * POST /api/input {"action": ...}
   *
   * Constraint from the simulator README: input is silently ignored unless some
   * container has `isEventCapture: 1`. `{ ok: true }` therefore means "the
   * simulator accepted the HTTP request", NOT "the app reacted" — a dropped
   * input is indistinguishable from a no-op at this layer. Callers must assert
   * the screen actually changed (plan 12-03's job).
   */
  async input(action: InputAction): Promise<void> {
    const res = await fetch(`${this.base}/api/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`POST /api/input ${action} -> HTTP ${res.status}`);
    const body = (await res.json()) as { ok?: boolean };
    if (body.ok !== true) {
      throw new Error(`POST /api/input ${action} -> ${JSON.stringify(body)}, expected { ok: true }`);
    }
  }

  private async bytes(endpoint: string): Promise<Uint8Array> {
    const res = await fetch(`${this.base}${endpoint}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`GET ${endpoint} -> HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export interface WaitOpts {
  what: string;
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * The ONLY waiting primitive in the harness. D-15 forbids fixed sleeps: every
 * wait is a polled condition with a timeout that names what it was waiting for.
 *
 * Exceptions thrown by `fn` are swallowed while polling — a screenshot taken
 * mid-rebuild can legitimately fail — but the last one is appended to the
 * timeout message, because "timed out" with the real cause hidden is the worst
 * possible failure report.
 */
export async function waitFor<T>(
  fn: () => Promise<T | null>,
  opts: WaitOpts,
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollMs = opts.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (;;) {
    try {
      const got = await fn();
      if (got !== null && got !== undefined) return got;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() >= deadline) break;
    // poll interval, not a delay: the loop above re-tests the condition
    await new Promise<void>((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }

  const because = lastError
    ? `; last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    : "";
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${opts.what}${because}`);
}
