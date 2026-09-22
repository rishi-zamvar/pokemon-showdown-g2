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
  teamBar: 8,
} as const;

/**
 * Root-page context menu (INFO-01, D-04).
 *
 * ORDER IS LOAD-BEARING: Exit is LAST. The whole reason this phase routes the
 * exit dialogue through a menu instead of a bare double-tap is that the
 * dialogue, once dismissed, leaves every updateImageRawData returning
 * sendFailed until the app restarts (D-02). The first item of a menu is the
 * one a pre-selected highlight lands on, so putting Exit there would recreate
 * the accident the menu exists to prevent — and it would let the harness wedge
 * its own simulator with one `click` after `context_menu`.
 *
 * Protocol rules the SDK validator enforces before any host call: at most 10
 * items, every itemID non-zero and unique, every itemName at most 32 UTF-8
 * BYTES. Phase 17 adds inspect entries here, inherits all four rules, and must
 * keep Exit last.
 *
 * The IDs are independent of the order: never renumber an id to move an item.
 */
export const MENU_ITEM_IDS = {
  exit: 1,
  battleSpeed: 2,
  about: 3,
} as const;

export const MAIN_MENU_CONTEXT_MENU = [
  { id: MENU_ITEM_IDS.battleSpeed, name: 'Battle Speed' },
  { id: MENU_ITEM_IDS.about, name: 'About' },
  { id: MENU_ITEM_IDS.exit, name: 'Exit' },   // LAST. See the note above.
] as const;

export const CONTAINER_NAMES = {
  content: "content",
  status: "status",
  statusRight: "statusR",
  oppSprite: "oppSpr",
  playerSprite: "plySpr",
  oppInfo: "oppInfo",
  playerInfo: "plyInfo",
  teamBar: "teamBar",
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

export const OVERLAY_LAYOUT = {
  /**
   * Image containers are capped at 288x144 by the firmware. A 576-wide team
   * bar is rejected outright and takes the whole rebuildPageContainer call
   * with it, so the page never builds and no action list appears.
   * ponytail: half-width bar; split across two 288px image containers if the
   * full-width strip is wanted back (image containers max out at 4).
   */
  TEAM_BAR_W: 288,
  TEAM_BAR_H: 24,
  COMPOSITE_W: 144,
  COMPOSITE_H: 132,
  NAMEPLATE_H: 36,
  SPRITE_SIZE: 96,
  OPP_X: 360,        // top-right, shifted toward center
  OPP_Y: 24,         // below team bar
  PLAYER_X: 72,      // bottom-left, shifted toward center
  PLAYER_Y: 156,     // 24 + 132
  LIST_X: 288,       // right half
  LIST_Y: 156,       // 24 + 132
  LIST_W: 288,
  LIST_H: 132,
  MINI_SPRITE_SIZE: 20,
  MINI_SLOT_W: 48,   // 288 / 6
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
