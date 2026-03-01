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
  oppSprite: 4,
  playerSprite: 5,
  oppInfo: 6,
  playerInfo: 7,
} as const;

export const CONTAINER_NAMES = {
  content: "content",
  status: "status",
  statusRight: "statusR",
  oppSprite: "oppSpr",
  playerSprite: "plySpr",
  oppInfo: "oppInfo",
  playerInfo: "plyInfo",
} as const;

export const SPRITE_CONFIG = {
  /** Sprite display size in pixels on G2 display */
  SIZE: 96,
  /** Gap between sprite and adjacent text container */
  GAP: 8,
  /** localStorage cache key prefix (legacy, used for cleanup) */
  CACHE_PREFIX: 'bitmap-sprite-',
} as const;

export const ANIM = {
  /** Delay between each typewriter character (ms). */
  CHAR_DELAY_MS: 45,
  /** Extra pause after punctuation (., !, ?) during typewriter (ms). */
  PUNCTUATION_PAUSE_MS: 180,
  /** Pause after each log entry before advancing to the next (ms). */
  ENTRY_PAUSE_MS: 500,
  /** Duration of a single flash frame (inverted or blank sprite) (ms). */
  FLASH_FRAME_MS: 75,
  /** Number of invert/restore cycles for a damage hit flash. */
  HIT_FLASH_CYCLES: 2,
  /** Number of invert/blank cycles for a faint flash. */
  FAINT_FLASH_CYCLES: 3,
  /** Delay between each HP bar drain step (ms). */
  HP_FRAME_MS: 40,
  /** Maximum number of HP drain steps per animation. */
  MAX_HP_STEPS: 20,
  /** Delay after animation completes before returning control (ms). */
  POST_ANIM_DELAY_MS: 400,
  /** Duration each switch-in transition frame is held (ms). */
  SWITCH_FRAME_MS: 120,
  /** Pixel offset for switch-in sprite slide effect (pixels shifted per frame). */
  SWITCH_SLIDE_PX: 3,
  /** Number of slide frames for switch-in sprite entrance. */
  SWITCH_SLIDE_FRAMES: 2,
  /** Pixel offset for attack lunge (pixels per frame). */
  LUNGE_OFFSET_PX: 10,
  /** Number of frames for the lunge forward motion. */
  LUNGE_FRAMES: 2,
  /** Duration of each lunge frame (ms) -- uses base timing, speed-scaled. */
  LUNGE_FRAME_MS: 60,
} as const;

export const DISPLAY_BUDGET = {
  /** Safe character budget for text containers (leave room for status bar) */
  SAFE_CHARS: 900,
  /** Max characters per line on G2 display */
  LINE_WIDTH: 64,
  /** Max lines on G2 display */
  MAX_LINES: 8,
  /** Max turn result log entries to show (prevents budget overflow) */
  MAX_LOG_ENTRIES: 12,
} as const;
