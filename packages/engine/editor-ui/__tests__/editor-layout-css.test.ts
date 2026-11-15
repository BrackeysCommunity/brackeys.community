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

const LIST_PANELS = ":is(.je-outliner, .je-ptree, .je-scene-panel)";

describe("editor layout styles", () => {
  it("lets a list panel in the phone sheet start at its content's height", () => {
    // The sheet has only a max-height, so a 0 basis there would collapse the tree to nothing.
    expect(declarations(`.je-panel-body > ${LIST_PANELS}`)).toContain("flex: 1 1 0");
    expect(declarations(`.je-frame-sheet .je-panel-body > ${LIST_PANELS}`)).toContain(
      "flex-basis: auto",
    );
    expect(declarations(".je-frame-sheet")).toContain("max-height");
    expect(declarations(".je-frame-sheet")).not.toMatch(/(^|[^-])height:/);
  });

  it("keeps the play bar's pickers one width whatever they show", () => {
    const select = declarations(".je-play-select");
    expect(select).toMatch(/width: \d+px/);
    expect(select).toContain("flex-shrink: 0");
  });

  it("holds every slider's unit column at one width, its longest unit included", () => {
    const unit = declarations(".je-insp-slider-unit");
    expect(unit).toContain("flex: 0 0 3em");
    expect(unit).toContain("min-width: 0");
  });

  it("lays out a locale code at one width in the locale settings and the strings panel", () => {
    expect(declarations(".je-locale-key")).toContain("flex: 0 0 var(--je-locale-col)");
    expect(declarations(".je-strings-locale")).toBe(declarations(".je-locale-key"));
    expect(css).toMatch(/--je-locale-col: [\d.]+em;/);
  });

  it("sizes a locale entry's control as a record row's", () => {
    expect(
      declarations(".je-insp-record > :is(.je-insp-number, .je-input, .je-combobox)"),
    ).toContain("flex: 1 1 0");
  });
});
