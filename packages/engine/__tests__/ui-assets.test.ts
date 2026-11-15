// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { memoryPrefsStore } from "../prefs";
import { entryInfo } from "../project/asset-info";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetEntry, AssetId } from "../project/types";
import type { GameInstance } from "../types";
import { mountUi, uiAssetUrl, type BlobUrl } from "../ui/layer";
import type { UiContext } from "../ui/types";
import { manualFrames } from "./fixtures/frame-clock";

vi.mock("../renderer", async () => (await import("./fixtures/frame-clock")).stubRenderer());

const created = { at: 0, by: "test" };

const entries: AssetEntry[] = [
  {
    key: "k-sheet",
    id: "faces-sheet",
    kind: "texture",
    path: "art/faces.png",
    sha256: "a".repeat(64),
    bytes: 2048,
    meta: { width: 128, height: 64 },
    created,
  },
  {
    key: "k-faces",
    id: "faces",
    kind: "atlas",
    path: "art/faces.atlas.json",
    sha256: "b".repeat(64),
    bytes: 512,
    meta: {
      tool: "texturepacker",
      frames: {
        "ada-smile": { x: 0, y: 0, w: 64, h: 64 },
        "ada-frown": { x: 64, y: 0, w: 64, h: 64 },
      },
      tags: [],
      slices: [],
      order: ["ada-smile", "ada-frown"],
    },
    import: { texture: "faces-sheet" },
    created,
  },
  {
    key: "k-icon",
    id: "coin-icon",
    kind: "texture",
    path: "art/coin.png",
    sha256: "c".repeat(64),
    bytes: 256,
    meta: { width: 16, height: 16 },
    created,
  },
];

const STRINGS = {
  kind: "strings",
  v: 1,
  strings: [{ key: "greet", en: "Hello", fr: "Bonjour" }],
};

const project: ProjectRuntimeView = {
  settings: {},
  engine: { locales: { default: "en", available: ["en", "fr"] } },
  table: () => [],
  asset(id, frame) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return undefined;
    const { info, frames } = entryInfo(entry);
    if (frame === undefined) return info;
    const own = frames.get(frame);
    return own ? { ...info, ...own } : undefined;
  },
  inputMap: null,
  doc: <T>(kind: string, id: string): T | undefined =>
    kind === "strings" && id === "lines" ? (STRINGS as T) : undefined,
  docs: (kind) => (kind === "strings" ? ["lines"] : []),
};

const blobUrl: BlobUrl = (id: AssetId) => {
  const info = project.asset(id);
  return info?.sha256 ? `https://cdn.test/${info.sha256.slice(0, 8)}` : null;
};

const blank: GameDefinition<{ n: number }> = defineGame({
  id: "ui-assets",
  types: [],
  actions: [],
  world: { physics: "none" },
  time: { kind: "fixed", rate: 60 },
  createRuntime: () => ({ snapshot: () => ({ n: 0 }), restore: () => {} }),
});

const games: GameInstance[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  manualFrames({ timers: true });
  document.body.appendChild(document.createElement("canvas"));
  vi.stubGlobal("navigator", { ...navigator, languages: ["en"] });
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mounted(
  opts: { blobUrl?: BlobUrl } = {},
): Promise<{ game: GameInstance; ctx: UiContext; unmount: () => void }> {
  const canvas = document.querySelector("canvas")!;
  const game = await createGame(canvas, {
    game: blank as GameDefinition,
    project,
    audio: { backend: false, prefs: memoryPrefsStore() },
  });
  games.push(game);
  let ctx: UiContext | null = null;
  const unmount = mountUi(
    game,
    canvas,
    (c) => {
      ctx = c;
      return { destroy() {} };
    },
    opts,
  );
  return { game, ctx: ctx!, unmount };
}

describe("UiContext.assetUrl", () => {
  it("resolves a portrait frame to its texture's URL and the frame's rect", async () => {
    const { ctx } = await mounted({ blobUrl });
    expect(ctx.assetUrl("faces", "ada-frown")).toEqual({
      url: "https://cdn.test/aaaaaaaa",
      rect: { x: 64, y: 0, w: 64, h: 64 },
    });
    expect(ctx.assetUrl("faces")).toEqual({ url: "https://cdn.test/aaaaaaaa" });
  });

  it("resolves a texture icon to its own URL with no rect", async () => {
    const { ctx } = await mounted({ blobUrl });
    expect(ctx.assetUrl("coin-icon")).toEqual({ url: "https://cdn.test/cccccccc" });
  });

  it("gives null for an unknown id, an unknown frame, or a frame on a texture", async () => {
    const { ctx } = await mounted({ blobUrl });
    expect(ctx.assetUrl("nobody")).toBeNull();
    expect(ctx.assetUrl("faces", "ada-wink")).toBeNull();
    expect(ctx.assetUrl("coin-icon", "ada-smile")).toBeNull();
  });

  it("gives null where the host serves no blobs", async () => {
    const { ctx } = await mounted();
    expect(ctx.assetUrl("faces", "ada-smile")).toBeNull();
    expect(uiAssetUrl(project, () => null, "coin-icon")).toBeNull();
    expect(uiAssetUrl(null, blobUrl, "coin-icon")).toBeNull();
  });
});

describe("UiContext.strings", () => {
  it("answers the new locale after a locale.set, inside the locale:change handler too", async () => {
    const { game, ctx } = await mounted();
    expect(ctx.strings().get("greet")).toBe("Hello");
    const seen: string[] = [];
    game.on("locale:change", () => seen.push(ctx.strings().get("greet")));
    game.locale.set("fr");
    expect(seen).toEqual(["Bonjour"]);
    expect(ctx.strings().get("greet")).toBe("Bonjour");
  });
});
