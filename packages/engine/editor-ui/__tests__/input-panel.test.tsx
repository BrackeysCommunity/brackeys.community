// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ProjectSession } from "../../collab/index";
import { createRegistry, defineGame } from "../../game/index";
import type { Binding } from "../../game/types";
import { INPUT_MAP_KIND, inputMapKind, type DocLayout } from "../../project/index";
import type { EditorNotify } from "../host";
import { KitProvider } from "../kit/index";
import { InputPanel, type CaptureBinding } from "../panels/settings/InputPanel";
import type { SettingsDoc } from "../panels/settings/settings-doc";

const game = defineGame({
  id: "pad",
  types: [],
  actions: [
    { action: "jump", description: "Jump.", bindings: [{ device: "key", code: "Space" }] },
    { action: "cursor", kind: "vector", description: "Aim.", bindings: [] },
    {
      action: "end-turn",
      ui: true,
      description: "End the turn.",
      bindings: [{ device: "key", code: "Enter" }],
    },
  ],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);

const notify: EditorNotify = Object.assign(vi.fn(), {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
});

function settingsDoc(edit: SettingsDoc["edit"]): SettingsDoc {
  return {
    session: {} as ProjectSession,
    kind: INPUT_MAP_KIND,
    entry: {
      key: "kin",
      id: "input-map",
      kind: INPUT_MAP_KIND,
      path: "input-map.json",
      created: { at: 0, by: "seed" },
    },
    docName: "asset:pad.kin",
    value: { kind: INPUT_MAP_KIND, v: 1 },
    layout: inputMapKind.layout as DocLayout,
    readOnly: null,
    edit,
    create: vi.fn(async () => true),
  };
}

function mount(capture: CaptureBinding) {
  const edit = vi.fn<SettingsDoc["edit"]>(async () => true);
  const doc = settingsDoc(edit);
  const view = render(
    <KitProvider host={{ storage: null }}>
      <InputPanel doc={doc} registry={registry} capture={capture} notify={notify} />
    </KitProvider>,
  );
  return { edit, panel: within(view.container) };
}

/** A capture that waits for `answer`; like the engine's, any pointer press also ends it with a binding. */
function heldCapture() {
  let answer: (b: Binding | null) => void = () => {};
  const capture = vi.fn<CaptureBinding>(
    () =>
      new Promise((resolve) => {
        const onPointer = () => {
          window.removeEventListener("pointerdown", onPointer, true);
          resolve({ device: "key", code: "KeyQ" });
        };
        window.addEventListener("pointerdown", onPointer, true);
        answer = (b) => {
          window.removeEventListener("pointerdown", onPointer, true);
          resolve(b);
        };
      }),
  );
  return { capture, answer: (b: Binding | null) => answer(b) };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the input panel's action rows", () => {
  it("wraps a vector action's direction picker and Add binding, so every direction stays reachable", () => {
    const { panel } = mount(heldCapture().capture);
    const cursor = panel.getByRole("group", { name: "cursor" });
    const picker = within(cursor).getByRole("group", { name: "cursor direction" });
    expect(picker.parentElement?.classList.contains("je-insp-wrap")).toBe(true);
    expect(
      within(picker)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toHaveLength(4);
  });

  it("shows a UI-only action's badge with its bindings, leaving the label column to the name", () => {
    const { panel } = mount(heldCapture().capture);
    const row = panel.getByRole("group", { name: "end-turn" });
    const bindings = within(row).getByLabelText("end-turn bindings");
    expect(within(bindings).getByText("UI")).toBeTruthy();
    expect(row.querySelector(".je-insp-field-label")?.textContent).toBe("end-turn");
  });

  it("waits for a press with a status note and Cancel, and Cancel binds nothing", async () => {
    const { capture, answer } = heldCapture();
    const { edit, panel } = mount(capture);
    const jump = panel.getByRole("group", { name: "jump" });
    await act(async () => {
      fireEvent.click(within(jump).getByRole("button", { name: "Add binding" }));
    });
    expect(within(jump).getByRole("button", { name: "Listening…" })).toBeTruthy();
    expect(within(jump).getByRole("status").textContent).toContain("Esc cancels");
    await act(async () => {
      fireEvent.click(within(jump).getByRole("button", { name: "Cancel" }));
    });
    expect(within(jump).queryByRole("status")).toBeNull();
    expect(within(jump).getByRole("button", { name: "Add binding" })).toBeTruthy();
    await act(async () => answer({ device: "key", code: "KeyJ" }));
    expect(edit).not.toHaveBeenCalled();
  });

  it("doesn't bind the press on Cancel itself, which the capture also hears", async () => {
    const { capture } = heldCapture();
    const { edit, panel } = mount(capture);
    const jump = panel.getByRole("group", { name: "jump" });
    await act(async () => {
      fireEvent.click(within(jump).getByRole("button", { name: "Add binding" }));
    });
    await act(async () => {
      fireEvent.pointerDown(within(jump).getByRole("button", { name: "Cancel" }), { button: 0 });
    });
    expect(within(jump).queryByRole("status")).toBeNull();
    expect(edit).not.toHaveBeenCalled();
  });

  it("binds the press it waited for", async () => {
    const { capture, answer } = heldCapture();
    const { edit, panel } = mount(capture);
    const jump = panel.getByRole("group", { name: "jump" });
    await act(async () => {
      fireEvent.click(within(jump).getByRole("button", { name: "Add binding" }));
    });
    await act(async () => answer({ device: "key", code: "KeyJ" }));
    expect(edit).toHaveBeenCalledOnce();
    expect(edit.mock.calls[0]?.[1]).toBe("Bind J to jump");
    expect(within(jump).queryByRole("status")).toBeNull();
  });
});
