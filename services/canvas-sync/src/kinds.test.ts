import { describe, expect, it } from "bun:test";

import type { Extension, onAuthenticatePayload } from "@hocuspocus/server";

import { SCENE_FORMAT_VERSION } from "../../../packages/engine/scene/types.ts";
import { SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import {
  signCanvasToken,
  type SyncTokenKind,
  type SyncTokenScope,
} from "../../../src/lib/canvas/token.ts";
import { COLLAB_LAYOUT_VERSION } from "../../../src/lib/scene/project-bytes.ts";
import { createAuthenticate } from "./auth.ts";
import { createAssetKind } from "./engine/asset-kind.ts";
import { MemoryAssetDocStore } from "./engine/doc-store.ts";
import { createProjectKind, MemoryProjectStore } from "./engine/project-kind.ts";
import {
  type DocumentKind,
  type DocumentKindName,
  DocumentKinds,
  type KindGrant,
} from "./kinds.ts";
import { ConnectionCaps, localLedger, SyncRefusal } from "./limits.ts";
import { RevocationList, type RevocationTombstones } from "./revoke.ts";
import { createSceneKind } from "./scene/kind.ts";
import { MemorySceneStore } from "./scene/store.ts";
import { SyncMetrics } from "./telemetry.ts";

const SECRET = "kinds-test-secret-1234";

/** What a test token sets beyond its user; `c` defaults to the document it opens. */
interface Claims {
  c?: string;
  k?: SyncTokenKind;
  s?: SyncTokenScope;
  f?: number;
  l?: number;
  a?: "read";
}

function fakeKind(
  name: DocumentKindName,
  admit: () => Promise<KindGrant> = async () => ({}),
  persistence: Extension = {},
): DocumentKind {
  return {
    name,
    noun: name,
    limits: { maxStateBytes: 1_000, maxMessageBytes: 100 },
    subject: (id) => (name === "canvas" ? id : `${name}:${id}`),
    admit,
    persistence,
  };
}

function setup(kinds: DocumentKind[], tombstones?: RevocationTombstones) {
  const caps = new ConnectionCaps(
    { forDocument: () => 0, forUser: () => 0 },
    localLedger,
    Date.now,
  );
  const revocations = new RevocationList();
  const authenticate = createAuthenticate({
    secret: SECRET,
    kinds: new DocumentKinds(kinds),
    caps,
    revocations,
    tombstones,
    now: Date.now,
  });
  const attempt = async (name: string, claims: Claims) => {
    const connectionConfig = { readOnly: false, isAuthenticated: false };
    const token = await signCanvasToken(
      { c: name, u: "alice", a: claims.a ?? "write", ...claims },
      SECRET,
    );
    const context = await authenticate({
      token,
      documentName: name,
      connectionConfig,
      request: new Request("http://test"),
    } as unknown as onAuthenticatePayload);
    return { context, connectionConfig };
  };
  const refusal = async (name: string, claims: Claims = {}) => {
    try {
      await attempt(name, claims);
    } catch (error) {
      if (error instanceof SyncRefusal) return { code: error.code, reason: error.reason };
      throw error;
    }
    return null;
  };
  return { attempt, refusal, revocations };
}

describe("DocumentKinds", () => {
  const kinds = new DocumentKinds([fakeKind("canvas"), fakeKind("scene")]);

  it("resolves each hosted prefix to its kind and id", () => {
    expect(kinds.resolve("canvas:abc")?.kind.name).toBe("canvas");
    expect(kinds.resolve("canvas:abc")?.id).toBe("abc");
    expect(kinds.resolve("scene:game.level")?.kind.name).toBe("scene");
    expect(kinds.resolve("scene:game.level")?.id).toBe("game.level");
  });

  it("hosts nothing else", () => {
    for (const name of ["note:abc", "board:abc", "abc", "scene:", "canvas:a:b"]) {
      expect(kinds.resolve(name)).toBeNull();
    }
    expect(new DocumentKinds([fakeKind("canvas")]).resolve("scene:game.level")).toBeNull();
  });

  it("hands each document hook to its own kind only", async () => {
    const seen: string[] = [];
    const routed = new DocumentKinds([
      fakeKind("canvas", undefined, {
        async onLoadDocument({ documentName }) {
          seen.push(`canvas ${documentName}`);
        },
      }),
      fakeKind("scene", undefined, {
        async onLoadDocument({ documentName }) {
          seen.push(`scene ${documentName}`);
          return new Uint8Array([1]);
        },
        async onStoreDocument({ documentName }) {
          seen.push(`store ${documentName}`);
        },
      }),
    ]).extension() as Required<Pick<Extension, "onLoadDocument" | "onStoreDocument">>;
    const load = (name: string) =>
      routed.onLoadDocument({ documentName: name } as Parameters<typeof routed.onLoadDocument>[0]);

    expect(await load("scene:g.l")).toEqual(new Uint8Array([1]));
    await load("canvas:c1");
    await routed.onStoreDocument({ documentName: "canvas:c1" } as Parameters<
      typeof routed.onStoreDocument
    >[0]);
    await routed.onStoreDocument({ documentName: "scene:g.l" } as Parameters<
      typeof routed.onStoreDocument
    >[0]);
    expect(seen).toEqual(["scene scene:g.l", "canvas canvas:c1", "store scene:g.l"]);
    await expect(load("note:n1")).rejects.toBeInstanceOf(SyncRefusal);
  });
});

describe("onAuthenticate through the kinds", () => {
  it("refuses an unknown prefix with 4403", async () => {
    const { refusal } = setup([fakeKind("canvas"), fakeKind("scene")]);
    expect(await refusal("note:n1")).toMatchObject({ code: SYNC_CLOSE.revoked });
    expect(await refusal("board:b1")).toMatchObject({ code: SYNC_CLOSE.revoked });
  });

  it("refuses a kind this instance doesn't host", async () => {
    const { refusal } = setup([fakeKind("canvas")]);
    expect(await refusal("scene:g.l", { k: "scene", f: 1 })).toMatchObject({
      code: SYNC_CLOSE.revoked,
    });
  });

  it("refuses a token minted for another kind with 4401", async () => {
    const { refusal } = setup([fakeKind("canvas"), fakeKind("scene")]);
    expect(await refusal("scene:g.l")).toMatchObject({ code: SYNC_CLOSE.unauthorized });
    expect(await refusal("canvas:c1", { k: "scene", f: 1 })).toMatchObject({
      code: SYNC_CLOSE.unauthorized,
    });
  });

  it("names the kind, the id and the revocation subject in the context", async () => {
    const { attempt } = setup([fakeKind("canvas"), fakeKind("scene")]);
    const { context: canvas } = await attempt("canvas:c1", {});
    expect(canvas).toMatchObject({ kind: "canvas", docId: "c1", subject: "c1", readOnly: false });
    const { context: scene } = await attempt("scene:g.l", { k: "scene", f: 1 });
    expect(scene).toMatchObject({ kind: "scene", docId: "g.l", subject: "scene:g.l" });
  });

  it("connects read-only for a read token or when the kind says so, with its notice", async () => {
    const { attempt } = setup([
      fakeKind("canvas"),
      fakeKind("scene", async () => ({ readOnly: true, notice: "reload" })),
    ]);
    const read = await attempt("canvas:c1", { a: "read" });
    expect(read.connectionConfig.readOnly).toBe(true);
    expect(read.context.readOnly).toBe(true);
    const scene = await attempt("scene:g.l", { k: "scene", f: 1 });
    expect(scene.connectionConfig.readOnly).toBe(true);
    expect(scene.context).toMatchObject({ access: "write", readOnly: true, notice: "reload" });
  });

  it("passes on the kind's own refusal, after the revocation checks", async () => {
    const gone = () => Promise.reject(new SyncRefusal(SYNC_CLOSE.revoked, "gone", "auth"));
    const tombstones: RevocationTombstones = {
      latest: async (subject) => (subject === "scene:g.revoked" ? Date.now() : null),
      close: async () => {},
    };
    const { refusal, revocations } = setup([fakeKind("scene", gone)], tombstones);
    expect(await refusal("scene:g.l", { k: "scene", f: 1 })).toMatchObject({
      reason: expect.stringContaining("gone"),
    });
    expect(await refusal("scene:g.revoked", { k: "scene", f: 1 })).toMatchObject({
      reason: expect.stringContaining("access revoked"),
    });
    revocations.record({ sceneId: "g.l", userId: "alice" }, Date.now());
    expect(await refusal("scene:g.l", { k: "scene", f: 1 })).toMatchObject({
      reason: expect.stringContaining("access revoked"),
    });
  });
});

describe("kinds an instance wasn't started with", () => {
  it("resolve to nothing, so a well-formed project or asset name is refused like any unknown kind", async () => {
    const kinds = new DocumentKinds([fakeKind("canvas"), fakeKind("scene")]);
    expect(kinds.get("project")).toBeUndefined();
    expect(kinds.resolve("project:jam")).toBeNull();
    expect(kinds.resolve("asset:jam.k1")).toBeNull();
    const routed = kinds.extension() as Required<Pick<Extension, "onLoadDocument">>;
    await expect(
      routed.onLoadDocument({ documentName: "asset:jam.k1" } as Parameters<
        typeof routed.onLoadDocument
      >[0]),
    ).rejects.toBeInstanceOf(SyncRefusal);

    const { refusal } = setup([fakeKind("canvas"), fakeKind("scene")]);
    expect(await refusal("project:jam", { k: "project", l: 1 })).toMatchObject({
      code: SYNC_CLOSE.revoked,
      reason: expect.stringContaining("unsupported document"),
    });
    expect(await refusal("asset:jam.k1", { k: "asset", l: 1 })).toMatchObject({
      code: SYNC_CLOSE.revoked,
      reason: expect.stringContaining("unsupported document"),
    });
  });

  it("resolve once an instance hosts them", () => {
    const kinds = new DocumentKinds([fakeKind("project"), fakeKind("asset")]);
    expect(kinds.resolve("project:jam")).toMatchObject({ id: "jam" });
    expect(kinds.resolve("asset:jam.k1")?.kind.name).toBe("asset");
    expect(kinds.resolve("asset:jam")).toBeNull();
  });
});

describe("project-scoped tokens", () => {
  const all = () => [fakeKind("canvas"), fakeKind("scene"), fakeKind("project"), fakeKind("asset")];
  const scoped = { k: "project", s: "project", f: 1, l: 1 } as const;

  it("admit every document of their project, each under its own kind and subject", async () => {
    const { attempt } = setup(all());
    for (const [name, kind] of [
      ["project:jam", "project"],
      ["scene:jam.level-1", "scene"],
      ["asset:jam.k1", "asset"],
    ] as const) {
      const { context } = await attempt(name, { ...scoped, c: "project:jam" });
      expect(context).toMatchObject({ kind, subject: `${kind}:${name.slice(kind.length + 1)}` });
    }
  });

  it("admit nothing outside their project", async () => {
    const { refusal } = setup(all());
    for (const name of ["project:other", "scene:other.level-1", "asset:other.k1", "canvas:jam"]) {
      expect(await refusal(name, { ...scoped, c: "project:jam" })).toMatchObject({
        code: SYNC_CLOSE.unauthorized,
        reason: expect.stringContaining("another document"),
      });
    }
  });

  it("leave an unscoped project token and an asset token to their one document", async () => {
    const { refusal, attempt } = setup(all());
    expect(
      await refusal("scene:jam.level-1", { k: "project", l: 1, c: "project:jam" }),
    ).toMatchObject({ code: SYNC_CLOSE.unauthorized });
    expect(await refusal("asset:other.k1", { k: "asset", l: 1, c: "asset:jam.k1" })).toMatchObject({
      code: SYNC_CLOSE.unauthorized,
    });
    expect(await refusal("asset:jam.k2", { k: "asset", l: 1, c: "asset:jam.k1" })).toMatchObject({
      code: SYNC_CLOSE.unauthorized,
    });
    expect(await refusal("asset:jam.k1", { k: "scene", f: 1, c: "asset:jam.k1" })).toMatchObject({
      reason: expect.stringContaining("another kind"),
    });
    expect((await attempt("asset:jam.k1", { k: "asset", l: 1 })).context.kind).toBe("asset");
  });

  it("are refused on every project document once the project is revoked", async () => {
    const { refusal, revocations } = setup(all());
    revocations.record({ projectId: "jam" }, Date.now());
    for (const name of ["project:jam", "scene:jam.level-1", "asset:jam.k1"]) {
      expect(await refusal(name, { ...scoped, c: "project:jam" })).toMatchObject({
        code: SYNC_CLOSE.revoked,
        reason: expect.stringContaining("access revoked"),
      });
    }
    expect(await refusal("scene:other.level-1", { k: "scene", f: 1 })).toBeNull();
  });
});

describe("the engine kinds", () => {
  const scenes = new MemorySceneStore();
  const assets = new MemoryAssetDocStore();
  const projects = new MemoryProjectStore({ assets, scenes });
  const common = { documents: () => new Map(), now: Date.now, metrics: new SyncMetrics() };
  const project = createProjectKind({ store: projects, ...common });
  const asset = createAssetKind({ store: assets, ...common });
  const scene = createSceneKind({ store: scenes, ...common });
  const kinds = () => [project, asset, scene];
  projects.create("jam");
  scenes.create("jam.level-1");
  assets.create("jam.deck", "data-table");

  const F = SCENE_FORMAT_VERSION;
  const L = COLLAB_LAYOUT_VERSION;
  const scoped = { k: "project", s: "project", c: "project:jam", f: F } as const;

  it("name every document of a project under its own subject, so a project revoke covers it", () => {
    expect(project.subject("jam")).toBe("project:jam");
    expect(scene.subject("jam.level-1")).toBe("scene:jam.level-1");
    expect(asset.subject("jam.deck")).toBe("asset:jam.deck");
  });

  it("admit a document only while its row exists", async () => {
    const { attempt, refusal } = setup(kinds());
    for (const name of ["project:jam", "scene:jam.level-1", "asset:jam.deck"]) {
      expect((await attempt(name, { ...scoped, l: L })).context.readOnly).toBe(false);
    }
    for (const [name, reason] of [
      ["project:gone", "project not found"],
      ["scene:jam.gone", "scene not found"],
      ["asset:jam.gone", "asset not found"],
    ] as const) {
      const c = name.startsWith("project:") ? name : "project:jam";
      expect(await refusal(name, { ...scoped, c, l: L })).toMatchObject({
        code: SYNC_CLOSE.revoked,
        reason: expect.stringContaining(reason),
      });
    }
  });

  it("connect a client on an older collab layout read-only with a reload notice", async () => {
    const { attempt } = setup(kinds());
    const older = await attempt("scene:jam.level-1", { ...scoped, l: L - 1 });
    expect(older.connectionConfig.readOnly).toBe(true);
    expect(JSON.parse(older.context.notice!)).toEqual({
      type: "scene-read-only",
      reason: "engine-outdated",
      schemaVersion: F,
      layout: L,
    });
    const unstamped = await attempt("scene:jam.level-1", { k: "scene", f: F });
    expect(JSON.parse(unstamped.context.notice!)).toMatchObject({ reason: "engine-outdated" });
    const newer = await attempt("scene:jam.level-1", { ...scoped, l: L + 1 });
    expect(JSON.parse(newer.context.notice!)).toMatchObject({ reason: "server-outdated" });

    for (const name of ["project:jam", "asset:jam.deck"]) {
      const { context } = await attempt(name, { ...scoped, l: L - 1 });
      expect(context.readOnly).toBe(true);
      expect(JSON.parse(context.notice!)).toEqual({
        type: "layout-read-only",
        reason: "engine-outdated",
        layout: L,
      });
    }
  });

  it("refuse a scene token with no engine version", async () => {
    const { refusal } = setup(kinds());
    expect(await refusal("scene:jam.level-1", { k: "scene", l: L })).toMatchObject({
      code: SYNC_CLOSE.unauthorized,
      reason: expect.stringContaining("no engine version"),
    });
  });
});
