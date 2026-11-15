// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { AssetEntry } from "../../../../project/index";
import type { EditorStorage } from "../../../host";
import { KitProvider } from "../../../kit/index";
import { AssetPanel, coverageText } from "../asset-panel";
import { entry, hero } from "./fixtures";

afterEach(cleanup);

function mount(stored: Map<string, string>, editor: boolean) {
  const storage: EditorStorage = {
    get: (key) => stored.get(key) ?? null,
    set: (key, value) => void stored.set(key, value),
  };
  return render(
    <KitProvider host={{ storage }}>
      <AssetPanel entry={hero} onClose={() => {}} editor={editor} />
    </KitProvider>,
  );
}

const section = (name: string) => screen.getByRole("region", { name });
const toggle = (name: string) => fireEvent.click(within(section(name)).getByText(name));

describe("the asset panel's file and licence sections", () => {
  it("start open for a kind with nothing else to show", () => {
    mount(new Map(), false);
    expect(within(section("File")).getByText("sprites/hero.png")).toBeTruthy();
    expect(within(section("Licence")).getByLabelText("Author")).toBeTruthy();
  });

  it("start collapsed above a kind's own editor, and remember being opened per kind", () => {
    const stored = new Map<string, string>();
    mount(stored, true);
    expect(section("File").hasAttribute("data-open")).toBe(false);
    expect(screen.queryByText("sprites/hero.png")).toBeNull();
    expect(screen.queryByLabelText("Author")).toBeNull();
    toggle("File");
    expect(within(section("File")).getByText("sprites/hero.png")).toBeTruthy();

    cleanup();
    mount(stored, true);
    expect(section("File").hasAttribute("data-open")).toBe(true);
    expect(section("Licence").hasAttribute("data-open")).toBe(false);
    // Closing it again goes back to the default, so nothing is left stored for it.
    toggle("File");
    expect(JSON.parse(stored.get("jams-editor:inspector-collapsed") ?? "{}")).toEqual({});
  });
});

const shown = (asset: AssetEntry) =>
  render(
    <KitProvider host={{ storage: null }}>
      <AssetPanel entry={asset} onClose={() => {}} />
    </KitProvider>,
  );

describe("what the asset panel reads from an asset's sidecar", () => {
  it("gives a bitmap font's face: format, size, line height and glyph count, and what it covers", () => {
    const font = entry("kfont", "fonts/kitchen.fnt", "font", {
      bytes: 7125,
      meta: {
        format: "bmfont",
        size: 10,
        lineHeight: 12,
        coverage: [
          [32, 34],
          [65, 90],
          [201, 201],
        ],
      },
    });
    shown(font);
    const details = within(section("File"));
    expect(details.getByText("font · 7 KB")).toBeTruthy();
    expect(details.getByText("Face").nextElementSibling?.textContent).toBe(
      "BMFont · 10 px · 12 px line · 30 glyphs",
    );
    expect(details.getByText("Covers").nextElementSibling?.textContent).toBe('U+0020–" A–Z É');
  });

  it("reads a code point range as its characters, a space or control by its code", () => {
    expect(coverageText([[0x20, 0x20]])).toBe("U+0020");
    expect(
      coverageText([
        [0x61, 0x7a],
        [0xe0, 0xe0],
      ]),
    ).toBe("a–z à");
    expect(coverageText([])).toBeNull();
    expect(coverageText(undefined)).toBeNull();
  });

  it("warns when a clip's loop points run past its end, and says nothing when they fit", () => {
    const clip = (loop: Record<string, number>) =>
      entry("kloop", "sfx/loop.wav", "audio", {
        meta: { format: "wav", durationMs: 1500, sampleRate: 22050, channels: 1 },
        import: loop,
      });
    shown(clip({ loopEnd: 2 }));
    expect(screen.getByRole("note").textContent).toBe(
      "loopEnd 2 s is past the clip's 1.500 s end, so the loop jumps back at the end.",
    );
    cleanup();
    shown(clip({ loopStart: 0.5, loopEnd: 1.25 }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(within(section("File")).getByText("audio · 22.05 kHz · mono")).toBeTruthy();
  });
});
