/**
 * Named screen rectangles, derived from the app's own layout constants.
 *
 * Nothing here restates a coordinate. If OVERLAY_LAYOUT moves — as TEAM_BAR_W
 * did when the full-width bar turned out to exceed the firmware image cap —
 * the harness follows automatically instead of asserting against a stale map.
 */
import { DISPLAY, GLASS_LAYOUT, OVERLAY_LAYOUT } from "../src/config/constants.ts";
import type { Region } from "./frame.ts";

export type RegionName =
  | "FULL"
  | "CONTENT"
  | "STATUS"
  | "TEAM_BAR"
  | "OPP_COMPOSITE"
  | "PLAYER_COMPOSITE"
  | "LIST";

export const REGIONS: Record<RegionName, Region> = {
  FULL: {
    name: "FULL",
    x: 0,
    y: 0,
    w: DISPLAY.WIDTH,
    h: DISPLAY.HEIGHT,
  },
  CONTENT: {
    name: "CONTENT",
    x: GLASS_LAYOUT.x,
    y: GLASS_LAYOUT.y,
    w: GLASS_LAYOUT.width,
    h: GLASS_LAYOUT.height,
  },
  STATUS: {
    name: "STATUS",
    x: GLASS_LAYOUT.x,
    y: GLASS_LAYOUT.statusY,
    w: GLASS_LAYOUT.width,
    h: GLASS_LAYOUT.statusHeight,
  },
  TEAM_BAR: {
    name: "TEAM_BAR",
    x: 0,
    y: 0,
    w: OVERLAY_LAYOUT.TEAM_BAR_W,
    h: OVERLAY_LAYOUT.TEAM_BAR_H,
  },
  OPP_COMPOSITE: {
    name: "OPP_COMPOSITE",
    x: OVERLAY_LAYOUT.OPP_X,
    y: OVERLAY_LAYOUT.OPP_Y,
    w: OVERLAY_LAYOUT.COMPOSITE_W,
    h: OVERLAY_LAYOUT.COMPOSITE_H,
  },
  PLAYER_COMPOSITE: {
    name: "PLAYER_COMPOSITE",
    x: OVERLAY_LAYOUT.PLAYER_X,
    y: OVERLAY_LAYOUT.PLAYER_Y,
    w: OVERLAY_LAYOUT.COMPOSITE_W,
    h: OVERLAY_LAYOUT.COMPOSITE_H,
  },
  LIST: {
    name: "LIST",
    x: OVERLAY_LAYOUT.LIST_X,
    y: OVERLAY_LAYOUT.LIST_Y,
    w: OVERLAY_LAYOUT.LIST_W,
    h: OVERLAY_LAYOUT.LIST_H,
  },
};
