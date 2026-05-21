import test from "node:test";
import assert from "node:assert/strict";
import { DESIGN_SYSTEMS, type DesignSystemId, type DesignSystemMode } from "@crewcue/contracts";

const MIN_PRIMARY_TEXT_CONTRAST = 4.5;

function parseHex(hex: string): [number, number, number] {
  const h = hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(background: string, foreground: string): number {
  const bg = relativeLuminance(parseHex(background));
  const fg = relativeLuminance(parseHex(foreground));
  const hi = Math.max(bg, fg);
  const lo = Math.min(bg, fg);
  return (hi + 0.05) / (lo + 0.05);
}

function primarySurfaceColor(mode: DesignSystemMode, colors: (typeof DESIGN_SYSTEMS.kinetic)["variants"]["light"]["colors"]): string {
  return mode === "light" ? colors.primary : colors.primaryContainer;
}

test("primary surfaces use onPrimary with WCAG AA contrast", () => {
  const systems: DesignSystemId[] = ["kinetic", "performance"];
  const modes: DesignSystemMode[] = ["light", "dark"];

  for (const id of systems) {
    for (const mode of modes) {
      const colors = DESIGN_SYSTEMS[id].variants[mode].colors;
      const bg = primarySurfaceColor(mode, colors);
      const fg = mode === "light" ? colors.onPrimary : colors.onPrimaryContainer;
      const ratio = contrastRatio(bg, fg);
      assert.ok(
        ratio >= MIN_PRIMARY_TEXT_CONTRAST,
        `${id} ${mode}: primary surface ${bg} + foreground ${fg} = ${ratio.toFixed(2)}:1`
      );
    }
  }
});
