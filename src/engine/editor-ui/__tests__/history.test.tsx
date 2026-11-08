// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { applyOpsToDoc, sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import type { EditorNotify } from "../host";
import { EditorHistory } from "../panels/EditorHistory";

const toasts = { error: vi.fn(), warning: vi.fn(), success: vi.fn() };
const notify: EditorNotify = Object.assign(vi.fn(), toasts);

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const scout: SceneOrigin = { kind: "agent", agentId: "scout", onBehalfOf: "Ada" };

const scene: SceneDefinition = {
  v: 1,
  name: "history-yard",
  bounds: [0, 0, 2000, 1200],
  entities: [{ id: "pad", type: "marker", at: [1000, 1010] }],
};

afterEach(cleanup);

describe("EditorHistory", () => {
  it("badges an agent's entry and reverts it as your own change", () => {
    const doc = sceneToDoc(scene, { key: sequentialKeys("t") });
    const session = createEditorSession({
      doc,
      origin: ada,
      name: "history-yard",
      registry,
      issuesDebounceMs: 0,
    });
    render(<EditorHistory session={session} notify={notify} />);

    act(() => {
      const applied = applyOpsToDoc(
        doc,
        {
          label: "Add 3 clouds",
          ops: [1, 2, 3].map((n) => ({
            op: "add" as const,
            entity: { id: `cloud-${n}`, type: "sensor", shape: ["box", n * 100, 300, 40, 8] },
          })),
        },
        scout,
        registry,
      );
      expect(applied.ok).toBe(true);
    });

    const row = screen.getByRole("listitem", { name: "Agent · Add 3 clouds" });
    expect(within(row).getByText("Agent")).toBeTruthy();
    expect(within(row).getByText("Add 3 clouds")).toBeTruthy();
    expect(within(row).getByText("scout for Ada")).toBeTruthy();
    expect(session.getDoc().entities).toHaveLength(4);

    fireEvent.click(within(row).getByRole("button", { name: "Revert" }));
    expect(session.getDoc().entities!.map((e) => e.id)).toEqual(["pad"]);
    const newest = screen.getAllByRole("listitem")[0]!;
    expect(newest.getAttribute("aria-label")).toBe("Revert Add 3 clouds");
    expect(within(newest).queryByText("Agent")).toBeNull();
    expect(within(newest).getByText("You")).toBeTruthy();
    expect(toasts.error).not.toHaveBeenCalled();
  });
});
