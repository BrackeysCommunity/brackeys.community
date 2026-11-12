// @vitest-environment jsdom
import {
  mountUi,
  type GameFlow,
  type GameInstance,
  type UiContext,
  type UiHandle,
} from "@jams/engine";
import type { SceneListEntry } from "@jams/engine/game";
import { sceneListFlow } from "@jams/engine/project";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { TacticsFlowSlice } from "../runtime";
import sceneList from "../scene-list.json";
import { createTacticsMenu, MENU_CLS, sceneTitle } from "../ui/menu";
import { tacticsProjectView } from "./pins";

type Titled = Pick<GameInstance, "flow" | "project">;

const flowOf = (scenes: readonly SceneListEntry[]): GameFlow =>
  ({ start: scenes[0]?.scene ?? null, scenes }) as unknown as GameFlow;

/** A game with no flow source, as the editor's Play makes, over the project's scene list. */
const editorGame = (): Titled => {
  const project = { ...tacticsProjectView(), flow: sceneListFlow(sceneList) };
  return { flow: flowOf([]), project: () => project };
};

describe("sceneTitle", () => {
  it("names a level by the project's scene list when the game has no flow source", () => {
    expect(sceneTitle(editorGame(), "level-1")).toBe("Ford");
    expect(sceneTitle(editorGame(), "level-2")).toBe("Bridge");
  });

  it("prefers the flow source's list, as the site's game has one", () => {
    const game: Titled = {
      flow: flowOf([{ scene: "level-1", title: "Shallows" }]),
      project: editorGame().project,
    };
    expect(sceneTitle(game, "level-1")).toBe("Shallows");
  });

  it("falls back to the id for an untitled or unlisted scene, or with no project", () => {
    expect(sceneTitle(editorGame(), "result")).toBe("result");
    expect(sceneTitle(editorGame(), "attic")).toBe("attic");
    expect(sceneTitle({ flow: flowOf([]), project: () => null }, "level-1")).toBe("level-1");
  });
});

describe("the menu's Credits link", () => {
  const handles: UiHandle[] = [];

  /** The menu over a host's context, on the title screen, with `links` as the host gives them. */
  function menu(links?: UiContext["links"], install?: UiContext["install"]): HTMLElement {
    const root = document.createElement("div");
    document.body.append(root);
    const slice = {
      flow: {
        screen: "menu",
        scene: "menu",
        progress: { cleared: [], roster: [], last: null },
        stairs: [],
        next: null,
      },
    } as unknown as TacticsFlowSlice;
    const game = {
      ...editorGame(),
      send: () => true,
      input: { onAction: () => () => {} },
      saves: { list: async () => [], load: async () => ({ ok: true }), store: {} },
    } as unknown as GameInstance;
    const ctx = {
      root,
      canvas: document.createElement("canvas"),
      game,
      slice: () => slice,
      watch: (select: (s: unknown) => unknown, fn: (v: unknown, p: unknown) => void) => {
        fn(select({ game: slice }), undefined);
        return () => {};
      },
      settings: {},
      reducedMotion: true,
      ...(links ? { links } : {}),
      ...(install ? { install } : {}),
    } as unknown as UiContext<TacticsFlowSlice>;
    handles.push(createTacticsMenu(ctx, { levels: ["level-1", "level-2"] }));
    return root;
  }

  const creditsOf = (root: HTMLElement) =>
    root.querySelector<HTMLAnchorElement>(`.${MENU_CLS.actions} a[data-action="credits"]`);

  afterEach(() => {
    for (const h of handles.splice(0)) h.destroy();
    document.body.replaceChildren();
  });

  it("links to the host's credits page in a new tab when the host ships one", () => {
    const link = creditsOf(menu({ credits: "https://example.test/game/credits.html" }));
    expect(link?.textContent).toBe("Credits");
    expect(link?.href).toBe("https://example.test/game/credits.html");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener");
    expect(link?.className).toBe(MENU_CLS.button);
  });

  it("reaches the menu through mountUi's links, as the standalone host passes them", () => {
    const slice = {
      flow: {
        screen: "menu",
        scene: "menu",
        progress: { cleared: [], roster: [], last: null },
        stairs: [],
        next: null,
      },
    };
    const game = {
      ...editorGame(),
      getStore: () => ({ state: { game: slice }, subscribe: () => () => {} }),
      send: () => true,
      input: { onAction: () => () => {} },
      saves: { list: async () => [], load: async () => ({ ok: true }), store: {} },
    } as unknown as GameInstance;
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    host.append(canvas);
    document.body.append(host);
    const mount = (ctx: UiContext<TacticsFlowSlice>) =>
      createTacticsMenu(ctx, { levels: ["level-1", "level-2"] });
    const unmount = mountUi(game, canvas, mount, { links: { credits: "credits.html" } });
    try {
      expect(creditsOf(host)?.getAttribute("href")).toBe("credits.html");
    } finally {
      unmount();
    }
    const bare = mountUi(game, canvas, mount);
    try {
      expect(creditsOf(host)).toBeNull();
    } finally {
      bare();
    }
  });

  it("opens credits in a new tab, so leaving them never boots a second copy over the running game", () => {
    const link = creditsOf(menu({ credits: "credits.html" }));
    expect(link?.target).toBe("_blank");
    expect(link?.getAttribute("href")).toBe("credits.html");
  });

  it("is absent without links, or with links that name no credits page", () => {
    expect(creditsOf(menu())).toBeNull();
    expect(creditsOf(menu({}))).toBeNull();
    const root = menu();
    expect(root.querySelector('[data-command="start"]')).not.toBeNull();
  });
});

describe("the menu's Install button", () => {
  const handles: UiHandle[] = [];

  afterEach(() => {
    for (const h of handles.splice(0)) h.destroy();
    document.body.replaceChildren();
  });

  /** A host's install prompt the test fires and takes back. */
  function prompt() {
    const listeners = new Set<() => void>();
    let offered: (() => Promise<boolean>) | null = null;
    const install: NonNullable<UiContext["install"]> = {
      current: () => offered,
      onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    const set = (next: (() => Promise<boolean>) | null) => {
      offered = next;
      for (const fn of listeners) fn();
    };
    return { install, set, listeners };
  }

  function menu(install?: UiContext["install"]): HTMLElement {
    const root = document.createElement("div");
    document.body.append(root);
    const slice = {
      flow: {
        screen: "menu",
        scene: "menu",
        progress: { cleared: [], roster: [], last: null },
        stairs: [],
        next: null,
      },
    } as unknown as TacticsFlowSlice;
    const game = {
      ...editorGame(),
      send: () => true,
      input: { onAction: () => () => {} },
      saves: { list: async () => [], load: async () => ({ ok: true }), store: {} },
    } as unknown as GameInstance;
    const ctx = {
      root,
      canvas: document.createElement("canvas"),
      game,
      slice: () => slice,
      watch: (select: (s: unknown) => unknown, fn: (v: unknown, p: unknown) => void) => {
        fn(select({ game: slice }), undefined);
        return () => {};
      },
      settings: {},
      reducedMotion: true,
      links: { credits: "credits.html" },
      ...(install ? { install } : {}),
    } as unknown as UiContext<TacticsFlowSlice>;
    handles.push(createTacticsMenu(ctx, { levels: ["level-1", "level-2"] }));
    return root;
  }

  const installOf = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>(`.${MENU_CLS.actions} button[data-action="install"]`);

  it("shows while the host offers the prompt, before Credits, and shows the prompt on click", async () => {
    const host = prompt();
    const root = menu(host.install);
    expect(installOf(root)).toBeNull();
    const show = vi.fn(async () => true);
    host.set(show);
    const button = installOf(root)!;
    expect(button.textContent).toBe("Install");
    expect(button.type).toBe("button");
    expect(button.nextElementSibling?.getAttribute("data-action")).toBe("credits");
    button.click();
    expect(show).toHaveBeenCalledTimes(1);
    host.set(null);
    expect(installOf(root)).toBeNull();
  });

  it("is absent where the host has no install prompt, and lets go of it when destroyed", () => {
    expect(installOf(menu())).toBeNull();
    const host = prompt();
    menu(host.install);
    expect(host.listeners.size).toBe(1);
    for (const h of handles.splice(0)) h.destroy();
    expect(host.listeners.size).toBe(0);
  });
});
