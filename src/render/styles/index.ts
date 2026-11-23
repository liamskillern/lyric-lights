import type { VisualStyle } from "../../settings";
import type { BackgroundState } from "../background";
import { drawAurora } from "./aurora";
import { drawGlow } from "./glow";
import { drawTunnel } from "./tunnel";
import { drawVinyl, VINYL_LYRICS_Y } from "./vinyl";

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, s: BackgroundState) => void;

export const STYLE_DRAW: Record<VisualStyle, Draw> = {
  glow: drawGlow,
  aurora: drawAurora,
  vinyl: drawVinyl,
  tunnel: drawTunnel,
};

/** Vertical position of the lyrics for each style (fraction of screen height). */
export const LYRICS_Y: Record<VisualStyle, number> = {
  glow: 0.5,
  aurora: 0.55,
  vinyl: VINYL_LYRICS_Y,
  tunnel: 0.5,
};
