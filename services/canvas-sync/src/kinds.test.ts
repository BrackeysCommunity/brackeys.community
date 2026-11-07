import { describe, expect, it } from "bun:test";

import type { Extension, onAuthenticatePayload } from "@hocuspocus/server";

import { SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken, type SyncTokenKind } from "../../../src/lib/canvas/token.ts";
import { createAuthenticate } from "./auth.ts";
import {
  type DocumentKind,
  type DocumentKindName,
  DocumentKinds,
  type KindGrant,
} from "./kinds.ts";
import { ConnectionCaps, localLedger, SyncRefusal } from "./limits.ts";
import { RevocationList, type RevocationTombstones } from "./revoke.ts";

const SECRET = "kinds-test-secret-1234";

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
  const attempt = async (name: string, claims: { k?: SyncTokenKind; f?: number; a?: "read" }) => {
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
  const refusal = async (name: string, claims: { k?: SyncTokenKind; f?: number } = {}) => {
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
