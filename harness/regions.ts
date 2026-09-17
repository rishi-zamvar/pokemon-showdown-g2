import type { Region } from "./frame.ts";

export type RegionName =
  | "FULL"
  | "CONTENT"
  | "STATUS"
  | "TEAM_BAR"
  | "OPP_COMPOSITE"
  | "PLAYER_COMPOSITE"
  | "LIST";

const stub = (name: RegionName): Region => ({ name, x: 0, y: 0, w: 0, h: 0 });

export const REGIONS: Record<RegionName, Region> = {
  FULL: stub("FULL"),
  CONTENT: stub("CONTENT"),
  STATUS: stub("STATUS"),
  TEAM_BAR: stub("TEAM_BAR"),
  OPP_COMPOSITE: stub("OPP_COMPOSITE"),
  PLAYER_COMPOSITE: stub("PLAYER_COMPOSITE"),
  LIST: stub("LIST"),
};
