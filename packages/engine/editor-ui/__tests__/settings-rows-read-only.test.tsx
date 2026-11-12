// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vite-plus/test";
import { z } from "zod";

import type { ProjectSession } from "../../collab/index";
import { settingsRows } from "../../editor/settings-model";
import type { AssetEntry, DocLayout } from "../../project/index";
import type { SettingsDoc } from "../panels/settings/settings-doc";
import { SettingsRows } from "../panels/settings/SettingsRows";

const SCHEMA = z.object({
  width: z.number().optional().meta({ unit: "px" }),
  heading: z.number().optional().meta({ unit: "deg" }),
});
const VALUE = { width: 32, heading: 0 };
const READ_ONLY = "This project is read-only here.";

const entry: AssetEntry = {
  key: "kset",
  id: "game-settings",
  kind: "game-settings",
  path: "game-settings.json",
  created: { at: 0, by: "seed" },
};

function settingsDoc(readOnly: string | null): SettingsDoc & { edit: Mock } {
  return {
    session: {} as ProjectSession,
    kind: "game-settings",
    entry,
    docName: "asset:p.kset",
    value: VALUE,
    layout: { as: "map", rest: { as: "atomic" } } as DocLayout,
    readOnly,
    edit: vi.fn(async () => true),
    create: vi.fn(async () => true),
  };
}

function mount(readOnly: string | null) {
  const doc = settingsDoc(readOnly);
  const view = render(<SettingsRows doc={doc} rows={settingsRows(SCHEMA, VALUE, "")} />);
  return { doc, view };
}

afterEach(cleanup);

describe("settings rows on a read-only doc", () => {
  it("take no scrub on a number's label nor a turn of the angle dial", () => {
    const { doc, view } = mount(READ_ONLY);
    const title = settingsRows(SCHEMA, VALUE, "").find((r) => r.name === "width")!.title;
    const label = screen.getByText(title);
    expect(label.classList.contains("je-insp-scrub")).toBe(false);
    fireEvent.pointerDown(label, { pointerId: 1, button: 0, clientX: 0 });
    fireEvent.pointerMove(label, { pointerId: 1, clientX: 200 });
    fireEvent.pointerUp(label, { pointerId: 1, clientX: 200 });

    const dial = view.container.querySelector(".je-insp-dial")!;
    dial.getBoundingClientRect = () => new DOMRect(0, 0, 20, 20);
    fireEvent.pointerDown(dial, { pointerId: 1, clientX: 10, clientY: 30 });
    fireEvent.pointerUp(dial, { pointerId: 1 });
    expect(doc.edit).not.toHaveBeenCalled();
  });

  it("refuse a commit that reaches them anyway, saying why", async () => {
    const { doc } = mount(READ_ONLY);
    const input = screen.getByRole("textbox", { name: "width" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "48" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(doc.edit).not.toHaveBeenCalled();
    expect(await screen.findByText(READ_ONLY)).toBeTruthy();
  });

  it("scrub and commit as one edit when the doc takes edits", async () => {
    const { doc } = mount(null);
    const title = settingsRows(SCHEMA, VALUE, "").find((r) => r.name === "width")!.title;
    const label = screen.getByText(title);
    await act(async () => {
      fireEvent.pointerDown(label, { pointerId: 1, button: 0, clientX: 0 });
      fireEvent.pointerMove(label, { pointerId: 1, clientX: 200 });
      fireEvent.pointerUp(label, { pointerId: 1, clientX: 200 });
    });
    expect(doc.edit).toHaveBeenCalledTimes(1);
  });
});
