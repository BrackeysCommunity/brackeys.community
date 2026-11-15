import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");

function declarations(selector: string): string {
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = rule.exec(css); m; m = rule.exec(css)) {
    const selectors = (m[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/,(?![^(]*\))/)
      .map((s) => s.replace(/\s+/g, " ").trim());
    if (selectors.includes(selector)) out.push(m[2] ?? "");
  }
  return out.join("\n");
}

describe("tile palette styles", () => {
  it("lets the grid shrink to a short dock, bounded in tile rows rather than px", () => {
    expect(declarations(".je-panel-body > .je-tile-palette")).toContain("flex: 1 1 0");
    expect(declarations(".je-panel-body > .je-tile-palette")).toContain("min-height: 0");
    expect(declarations(".je-frame-sheet .je-panel-body > .je-tile-palette")).toContain(
      "flex-basis: auto",
    );
    const grid = declarations(".je-tile-grid");
    expect(grid).toContain("flex: 0 1 auto");
    expect(grid).toMatch(/min-height: calc\(2 \* var\(--je-tile-px\)/);
    expect(grid).toMatch(/max-height: calc\(10 \* var\(--je-tile-px\)/);
  });

  it("an armed rule uses the kit's ghost pressed state, nothing of its own", () => {
    expect(declarations('.je-tile-rule[aria-pressed="true"]')).toBe("");
    expect(declarations('.je-btn[data-variant="ghost"][aria-pressed="true"]')).toContain(
      "background: var(--je-muted)",
    );
  });
});
