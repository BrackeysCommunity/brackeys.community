// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { jsonAt } from "../../dialogue/vars";
import { settingsRows } from "../../editor/settings-model";
import { createRegistry } from "../../game/index";
import type { JsonValue } from "../../game/types";
import type { AssetEntry, DocLayout, ProjectOp } from "../../project/index";
import { localeTagProblem } from "../../project/kinds/strings";
import { gameSettingsBlocks } from "../panels/settings/settings-schemas";
import { LOCALE_PREVIEW_NOTE, SettingsRows } from "../panels/settings/SettingsRows";
import { fakeSettingsDoc } from "./fixtures/settings-doc";

const font: AssetEntry = {
  key: "kfont",
  id: "kitchen-font",
  kind: "font",
  path: "fonts/kitchen.ttf",
  created: { at: 0, by: "seed" },
};

vi.mock("../panels/EditorProject", () => ({
  useProjectView: () => ({ byId: new Map([[font.id, font]]) }),
}));

const registry = createRegistry(null);
const { engine } = gameSettingsBlocks(registry);

function mount(engineValue: Record<string, unknown>) {
  const doc = fakeSettingsDoc({
    value: { kind: "game-settings", v: 2, engine: engineValue },
    layout: { as: "atomic" } as DocLayout,
  });
  render(
    <SettingsRows doc={doc} rows={settingsRows(engine, engineValue, "engine", { registry })} />,
  );
  /** The value at `pointer` after the last edit, read through the edit that wrote over it. */
  const written = (pointer: string) => {
    const ops = doc.edit.mock.lastCall?.[0] as ProjectOp[] | undefined;
    const op = ops?.[0] as { edits?: { set?: string; value?: JsonValue }[] } | undefined;
    const edit = op?.edits?.find((e) => e.set !== undefined && pointer.startsWith(e.set));
    if (!edit || edit.value === undefined) return "no edit";
    return jsonAt(edit.value, pointer.slice(edit.set!.length));
  };
  return { doc, written };
}

const LOCALES = {
  default: "en",
  available: ["en", "fr"],
  fonts: { default: "kitchen-font", fr: "gone-font" },
};

afterEach(cleanup);

describe("the locales settings", () => {
  it("draw the offered locales as chips, the default without a remove", async () => {
    const { doc, written } = mount({ locales: LOCALES });
    expect(screen.queryByText('["en","fr"]')).toBeNull();
    expect(screen.getByText("en (default)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove the locale en" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove the locale fr" }));
    await waitFor(() => expect(doc.edit).toHaveBeenCalledTimes(1));
    expect(written("/engine/locales/available")).toEqual(["en"]);

    const add = screen.getByRole("textbox", { name: "engine.locales.available" });
    fireEvent.change(add, { target: { value: "de, pt-BR" } });
    fireEvent.keyDown(add, { key: "Enter" });
    await waitFor(() => expect(doc.edit).toHaveBeenCalledTimes(2));
    expect(written("/engine/locales/available")).toEqual(["en", "fr", "de", "pt-BR"]);

    fireEvent.change(add, { target: { value: "Not A Tag" } });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(await screen.findByText(`${localeTagProblem("Not")}.`)).toBeTruthy();
    expect(doc.edit).toHaveBeenCalledTimes(2);
    expect((add as HTMLInputElement).value).toBe("Not A Tag");
  });

  it("pick the default from the offered locales", async () => {
    const { doc, written } = mount({ locales: LOCALES });
    const select = screen.getByRole("combobox", { name: "engine.locales.default" });
    expect(select.textContent).toContain("en");
    fireEvent.click(select);
    const fr = await screen.findByRole("option", { name: "fr" });
    fireEvent.mouseMove(fr);
    fireEvent.click(fr);
    await waitFor(() => expect(doc.edit).toHaveBeenCalled());
    expect(written("/engine/locales/default")).toBe("fr");
  });

  it("edit each locale's fallback chain as a list, none when blank", async () => {
    const { doc, written } = mount({ locales: LOCALES });
    const chains = screen.getByRole("group", { name: "engine.locales.fallback" });
    const fr = within(chains).getByRole("textbox", { name: "engine.locales.fallback.fr" });
    expect(fr.getAttribute("placeholder")).toBe("none");
    fireEvent.change(fr, { target: { value: "es, it" } });
    fireEvent.keyDown(fr, { key: "Enter" });
    await waitFor(() => expect(doc.edit).toHaveBeenCalled());
    expect(written("/engine/locales/fallback")).toEqual({ fr: ["es", "it"] });
  });

  it("say that a locale is previewed in Play, since edit mode draws the default", () => {
    mount({ locales: LOCALES });
    expect(screen.getByText(LOCALE_PREVIEW_NOTE)).toBeTruthy();
  });

  it("say so when only the default is offered, so there is no chain to give", () => {
    mount({ locales: { default: "en", available: ["en"] } });
    expect(screen.getByText("none: every locale falls back to the default")).toBeTruthy();
  });

  it("pick each locale's font from the project's fonts, flagging an id it doesn't have", async () => {
    const { doc, written } = mount({ locales: LOCALES });
    const fonts = screen.getByRole("group", { name: "engine.locales.fonts" });
    const fallback = within(fonts).getByRole("combobox", { name: "engine.locales.fonts.default" });
    expect((fallback as HTMLInputElement).value).toBe("kitchen-font");
    const fr = within(fonts).getByRole("combobox", { name: "engine.locales.fonts.fr" });
    expect(fr.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("gone-font isn't a font in this project.")).toBeTruthy();
    const en = within(fonts).getByRole("combobox", { name: "engine.locales.fonts.en" });
    expect(en.getAttribute("placeholder")).toBe("Default");
    expect(fallback.getAttribute("placeholder")).toBe("Engine font");

    const entry = fr.closest(".je-insp-record") as HTMLElement;
    fireEvent.click(within(entry).getByRole("button", { name: "Show options" }));
    const option = await screen.findByRole("option", { name: /kitchen/ });
    await act(async () => {
      fireEvent.mouseMove(option);
      fireEvent.click(option);
    });
    await waitFor(() => expect(doc.edit).toHaveBeenCalled());
    expect(written("/engine/locales/fonts")).toEqual({
      default: "kitchen-font",
      fr: "kitchen-font",
    });
  });

  it("write the whole block on the first edit of a project without one", async () => {
    const { doc, written } = mount({});
    expect(screen.getByText("en (default)")).toBeTruthy();
    const add = screen.getByRole("textbox", { name: "engine.locales.available" });
    fireEvent.change(add, { target: { value: "fr" } });
    fireEvent.keyDown(add, { key: "Enter" });
    await waitFor(() => expect(doc.edit).toHaveBeenCalled());
    expect(written("/engine/locales")).toEqual({ default: "en", available: ["en", "fr"] });
  });
});
