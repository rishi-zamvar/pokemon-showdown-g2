export const DISPLAY = {
  WIDTH: 576,
  HEIGHT: 288,
} as const;

export const GLASS_LAYOUT = {
  x: 8,
  y: 4,
  width: 560,
  height: 248,
  statusY: 256,
  statusHeight: 28,
} as const;

export const TIMING = {
  /** Scroll cooldown to prevent duplicate events (ms). Per Nick Ustinov notes. */
  SCROLL_COOLDOWN_MS: 300,
  /** Timeout waiting for EvenAppBridge connection (ms). */
  BRIDGE_TIMEOUT_MS: 15_000,
} as const;

export const CONTAINER_IDS = {
  content: 1,
  status: 2,
  statusRight: 3,
} as const;

export const CONTAINER_NAMES = {
  content: "content",
  status: "status",
  statusRight: "statusR",
} as const;

export const DISPLAY_BUDGET = {
  /** Safe character budget for text containers (leave room for status bar) */
  SAFE_CHARS: 900,
  /** Max characters per line on G2 display */
  LINE_WIDTH: 64,
  /** Max lines on G2 display */
  MAX_LINES: 8,
  /** Max turn result log entries to show (prevents budget overflow) */
  MAX_LOG_ENTRIES: 6,
} as const;
