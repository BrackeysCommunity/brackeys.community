// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  electResponder,
  liveRequest,
  livePresence,
  type AwarenessLike,
  type StatelessProvider,
} from "../../collab/index";
import type { GameInstance } from "../../index";
import type { EditorStorage } from "../host";
import { KitProvider } from "../kit/index";
import { AgentsPanel } from "../panels/settings/AgentsPanel";
import {
  AGENTS_DRIVE_PLAY_KEY,
  agentsDrivePlay,
  attachEditorResponder,
} from "../session/live-responder";
import type { LiveEditor } from "../session/live-scene-editor";

/** Clients on one doc: a shared awareness map, and stateless messages to every other client. */
function relay() {
  const states = new Map<number, Record<string, unknown>>();
  const change = new Set<() => void>();
  const clients = new Map<number, Set<(e: { payload: string }) => void>>();
  const awarenessOf = (clientID: number): AwarenessLike => ({
    clientID,
    getLocalState: () => states.get(clientID) ?? null,
    setLocalStateField(field, value) {
      states.set(clientID, { ...states.get(clientID), [field]: value });
      for (const h of change) h();
    },
    getStates: () => states,
    on: (_e, cb) => void change.add(cb as () => void),
    off: (_e, cb) => void change.delete(cb as () => void),
  });
  const join = (clientID: number): StatelessProvider => {
    const listeners = new Set<(e: { payload: string }) => void>();
    clients.set(clientID, listeners);
    return {
      awareness: awarenessOf(clientID),
      sendStateless(payload) {
        queueMicrotask(() => {
          for (const [id, ls] of clients) if (id !== clientID) for (const l of ls) l({ payload });
        });
      },
      on: (_e, fn) => void listeners.add(fn),
      off: (_e, fn) => void listeners.delete(fn),
    };
  };
  return { join, awarenessOf };
}

function memoryStorage(): EditorStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
}

function stubGame(tick: number): GameInstance {
  const state = { phase: "running", tick, mode: "edit", game: {}, dialogue: null, timings: null };
  return {
    getStore: () => ({ state }),
    debug: { entities: async () => [], events: { list: () => [] } },
  } as unknown as GameInstance;
}

const live = { play: () => true, stop: () => {} } as unknown as Pick<LiveEditor, "play" | "stop">;

afterEach(cleanup);

describe("which open editor answers", () => {
  it("is one with Let agents drive Play on, though another with it off has a lower client id", async () => {
    const net = relay();
    const project = relay();
    const off = memoryStorage();
    off.set(AGENTS_DRIVE_PLAY_KEY, "false");
    const on = memoryStorage();
    on.set(AGENTS_DRIVE_PLAY_KEY, "true");
    const lowProject = project.awarenessOf(2);
    const detaches = [
      attachEditorResponder({
        provider: net.join(2),
        projectAwareness: lowProject,
        enabled: () => agentsDrivePlay(off, true),
        live,
        game: stubGame(2),
      }),
      attachEditorResponder({
        provider: net.join(50),
        projectAwareness: project.awarenessOf(50),
        enabled: () => agentsDrivePlay(on, true),
        live,
        game: stubGame(50),
      }),
    ];
    const agent = net.join(99);
    expect(electResponder(livePresence(agent.awareness!))).toBe(50);
    expect(lowProject.getLocalState()?.project).toMatchObject({ live: false });
    expect(await liveRequest(agent, { t: "state", id: "s1" })).toMatchObject({
      ok: true,
      store: { tick: 50 },
    });
    for (const d of detaches) d();
  });

  it("moves to this editor once its viewer turns the toggle on in Project settings", async () => {
    const net = relay();
    const project = relay();
    const storage = memoryStorage();
    storage.set(AGENTS_DRIVE_PLAY_KEY, "false");
    const projectAwareness = project.awarenessOf(2);
    const detaches = [
      attachEditorResponder({
        provider: net.join(2),
        projectAwareness,
        enabled: () => agentsDrivePlay(storage, true),
        live,
        game: stubGame(2),
      }),
      attachEditorResponder({
        provider: net.join(50),
        enabled: () => true,
        live,
        game: stubGame(50),
      }),
    ];
    const agent = net.join(99);
    expect(electResponder(livePresence(agent.awareness!))).toBe(50);

    render(
      <KitProvider host={{ storage }}>
        <AgentsPanel hosted />
      </KitProvider>,
    );
    const toggle = screen.getByRole("switch", { name: "Let agents drive Play" });
    act(() => {
      fireEvent.click(toggle);
    });
    expect(agentsDrivePlay(storage, true)).toBe(true);
    expect(electResponder(livePresence(agent.awareness!))).toBe(2);
    expect(projectAwareness.getLocalState()?.project).toMatchObject({ live: true });
    expect(await liveRequest(agent, { t: "state", id: "s2" })).toMatchObject({
      ok: true,
      store: { tick: 2 },
    });
    for (const d of detaches) d();
    expect(projectAwareness.getLocalState()?.project).toMatchObject({ live: false });
  });

  it("follows another tab's change through the storage event", () => {
    const net = relay();
    const storage = memoryStorage();
    const detach = attachEditorResponder({
      provider: net.join(4),
      enabled: () => agentsDrivePlay(storage, true),
      live,
      game: stubGame(4),
    });
    const presence = () => livePresence(net.join(99).awareness!).find((p) => p.clientId === 4);
    expect(presence()?.drives).toBeUndefined();
    storage.set(AGENTS_DRIVE_PLAY_KEY, "true");
    window.dispatchEvent(new StorageEvent("storage", { key: AGENTS_DRIVE_PLAY_KEY }));
    expect(presence()?.drives).toBe(true);
    detach();
  });
});
