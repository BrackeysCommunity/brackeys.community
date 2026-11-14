import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");

/** The declarations of every rule whose selector list names `selector` exactly. */
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

describe("outliner styles", () => {
  it("marks the root strip like every other drop zone, with no dashed stroke", () => {
    const strip = declarations(".je-outliner-root");
    expect(strip).toContain("position: absolute");
    expect(strip).not.toMatch(/dashed/);
    expect(strip).not.toMatch(/border:/);
    expect(declarations(".je-outliner-root[data-drop-over]")).toBe(
      declarations(".je-ptree-drop[data-drop-over]"),
    );
    expect(declarations(".je-outliner-root[data-drop-over]")).toMatch(
      /box-shadow: 0 0 0 1px var\(--je-primary\)/,
    );
  });

  it("keeps the root strip opaque when it refuses, since it lies over rows", () => {
    expect(declarations(".je-outliner-root[data-drop-refused]")).toMatch(
      /background: color-mix\(in srgb, var\(--je-danger\) 10%, var\(--je-panel\)\)/,
    );
  });

  it("hides a row's detail whenever its Open button shows", () => {
    expect(declarations(".je-outliner-entity:hover .je-outliner-open")).toContain("opacity: 1");
    const showing = [
      ".je-outliner-entity:hover:has(.je-outliner-open) .je-outliner-detail",
      ".je-outliner-entity:has(.je-outliner-open:is(:focus-visible, [data-busy])) .je-outliner-detail",
    ];
    for (const selector of showing) {
      expect(declarations(selector), selector).toContain("visibility: hidden");
    }
  });
});
