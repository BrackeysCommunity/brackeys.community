// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { EditorStorage } from "../../../host";
import { KitProvider } from "../../../kit/index";
import { AssetPanel } from "../asset-panel";
import { hero } from "./fixtures";

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
