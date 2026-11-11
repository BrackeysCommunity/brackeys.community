// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import {
  ASSET_CHANGED,
  buildAtFrom,
  COLLAB_LAYOUT_VERSION,
  seedProjectDoc,
  type AssetChangedMessage,
  type AwarenessLike,
  type DocOrigin,
  type ProjectSession,
} from "../../collab/index";
import { createKindRegistry, defineAssetKind, type AssetEntry } from "../../project/index";
import { createRegistry, SCENE_FORMAT_VERSION } from "../../scene/index";
import { devCollabUrl } from "../connect/dev";
import { hocuspocusTransport } from "../connect/hocuspocus";
import {
  connectProjectSession,
  createProjectTokens,
  TOKEN_REFRESH_MARGIN_MS,
  type ProjectTokens,
} from "../connect/project-session";
import type {
  CloseReason,
  HocuspocusModule,
  ProjectAccess,
  ProjectDocEvents,
  ProjectTokenAnswer,
  ProjectTransport,
} from "../host";
import { useProjectSession, useSessionDoc } from "../session/use-project-session";

const fakes = { mint: vi.fn() };

/** A sync server's close codes: revoked and too large stop a doc, anything else retries. */
const SYNC_CLOSE = { revoked: 4403, tooLarge: 4413, rateLimited: 4429 } as const;
const closeReason = (code: number | null): CloseReason =>
  code === SYNC_CLOSE.revoked ? "revoked" : code === SYNC_CLOSE.tooLarge ? "too-large" : "retry";

/** One client's awareness, holding its own state only. */
function fakeAwareness(): AwarenessLike {
  const states = new Map<number, Record<string, unknown>>();
  return {
    clientID: 1,
    getLocalState: () => states.get(1) ?? null,
    setLocalStateField(field, value) {
      states.set(1, { ...states.get(1), [field]: value });
    },
    getStates: () => states,
    on() {},
    off() {},
  };
}

const card = defineAssetKind({
  storage: "doc",
  kind: "card",
  title: "Card",
  description: "A card.",
  match: { suffixes: [".card.json"] },
  version: 1,
  schemaId: "urn:jams-engine:card:v1",
  schema: () => z.looseObject({ v: z.literal(1) }),
  layout: { as: "map", rest: { as: "atomic" } },
  empty: () => ({ v: 1 }),
});
const kinds = createKindRegistry(null, [card]);
const registry = createRegistry(null);
const origin: DocOrigin = { kind: "user", userId: "u", name: "U" };

type FakeProvider = {
  name: string;
  events: ProjectDocEvents;
  tokens: string[];
  attaches: number;
  attached: boolean;
  destroyed: boolean;
};

type FakeSocket = { url: string; providers: FakeProvider[]; destroyed: boolean };

/** Docs served from memory: each provider syncs its doc with the server's copy once it attaches. */
function fakeServer() {
  const docs = new Map<string, Y.Doc>();
  const sockets: FakeSocket[] = [];
  /** A close code the next attach of a doc meets instead of syncing. */
  const refuse = new Map<string, number>();
  const serverDoc = (name: string) => {
    let doc = docs.get(name);
    if (!doc) docs.set(name, (doc = new Y.Doc()));
    return doc;
  };

  const entry = (key: string): AssetEntry => ({
    key,
    id: key,
    kind: "card",
    path: `${key}.card.json`,
    created: { at: 0, by: "seed" },
  });
  seedProjectDoc(
    serverDoc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: { a: entry("a"), b: entry("b") },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );

  const transport: ProjectTransport = (url) => {
    const socket: FakeSocket = { url, providers: [], destroyed: false };
    sockets.push(socket);
    return {
      status: () => (socket.destroyed ? "disconnected" : "connected"),
      subscribe: () => () => {},
      provider({ name, doc, token, events }) {
        const server = serverDoc(name);
        const p: FakeProvider = {
          name,
          events,
          tokens: [],
          attaches: 0,
          attached: false,
          destroyed: false,
        };
        socket.providers.push(p);
        let unwire: (() => void) | null = null;
        const detach = () => {
          p.attached = false;
          unwire?.();
          unwire = null;
        };
        const attach = () => {
          if (p.attached) return;
          p.attached = true;
          p.attaches++;
          void (async () => {
            if (token) p.tokens.push(await token());
            await Promise.resolve();
            if (!p.attached) return;
            const code = refuse.get(name);
            if (code !== undefined) {
              refuse.delete(name);
              return events.closed(code as never, true);
            }
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(server), p);
            Y.applyUpdate(server, Y.encodeStateAsUpdate(doc), p);
            const up = (u: Uint8Array, o: unknown) => o !== p && Y.applyUpdate(server, u, p);
            const down = (u: Uint8Array, o: unknown) => o !== p && Y.applyUpdate(doc, u, p);
            doc.on("update", up);
            server.on("update", down);
            unwire = () => {
              doc.off("update", up);
              server.off("update", down);
            };
            events.synced();
          })();
        };
        attach();
        return {
          awareness: fakeAwareness(),
          attach,
          detach,
          destroy() {
            detach();
            p.destroyed = true;
          },
        };
      },
      destroy() {
        socket.destroyed = true;
      },
    };
  };

  const provider = (name: string) =>
    sockets.flatMap((s) => s.providers).find((p) => p.name === name && !p.destroyed);
  return { transport, sockets, refuse, docs, provider };
}

/** The dev server (no tokens, a URL) or a hosted one (tokens, the URL its answer names). */
type Host = { url?: string; tokens?: ProjectTokens; access?: ProjectAccess };

const dev = (url = devCollabUrl()): Host => ({ url });

const hosted = (access: ProjectAccess = "write"): Host => ({
  access,
  tokens: createProjectTokens(
    {
      projectId: "p",
      formatVersion: SCENE_FORMAT_VERSION,
      layoutVersion: COLLAB_LAYOUT_VERSION,
      access,
    },
    fakes.mint,
  ),
});

function mount(
  host: Host,
  server = fakeServer(),
  extra: { buildAt?: number; onAssetChanged?: (message: AssetChangedMessage) => void } = {},
) {
  const hook = renderHook(
    (props: { project: string | null }) =>
      useProjectSession({
        project: props.project,
        ...host,
        closeReason,
        registry,
        kinds,
        origin,
        transport: server.transport,
        ...extra,
      }),
    { initialProps: { project: "p" as string | null } },
  );
  return { hook, server };
}

const answer = (token: string): ProjectTokenAnswer => ({
  token,
  url: "wss://sync.example.test",
  access: "write",
});

afterEach(() => {
  cleanup();
  fakes.mint.mockReset();
  vi.useRealTimers();
});

describe("useProjectSession on the dev server", () => {
  it("opens the project doc on the same origin's collab path, without tokens", async () => {
    const { hook, server } = mount(dev(), fakeServer(), { buildAt: 1234 });
    await waitFor(() => expect(hook.result.current.status).toBe("live"));
    const session = hook.result.current.session!;
    expect(session.project).toBe("p");
    expect(session.buildAt).toBe(1234);
    expect(Object.keys(session.state().assets).sort()).toEqual(["a", "b"]);
    expect(server.sockets).toHaveLength(1);
    expect(server.sockets[0]!.url).toBe(`ws://${window.location.host}/__scene-collab`);
    expect(server.sockets[0]!.providers.map((p) => p.tokens)).toEqual([[]]);
    expect(fakes.mint).not.toHaveBeenCalled();
  });

  it("shares one socket between the docs, with a provider each", async () => {
    const { hook, server } = mount(dev("ws://dev.test/__scene-collab"));
    await waitFor(() => expect(hook.result.current.session).not.toBeNull());
    const session = hook.result.current.session!;
    await act(() => Promise.all([session.open("asset:p.a"), session.open("asset:p.b")]));
    expect(server.sockets).toHaveLength(1);
    expect(server.sockets[0]!.url).toBe("ws://dev.test/__scene-collab");
    expect(server.sockets[0]!.providers.map((p) => p.name)).toEqual([
      "project:p",
      "asset:p.a",
      "asset:p.b",
    ]);
  });

  it("opens only scene:<id>.<key> and asset:<id>.<key> docs of its project, never a bare scene name", async () => {
    const { hook, server } = mount(dev());
    await waitFor(() => expect(hook.result.current.session).not.toBeNull());
    const session = hook.result.current.session!;
    for (const name of ["scene:test-yard", "scene:other.a", "test-yard", "asset:p"]) {
      await expect(session.open(name)).rejects.toThrow(/isn't a doc of project "p"/);
    }
    await act(() => session.open("asset:p.a").then(() => {}));
    expect(server.sockets[0]!.providers.map((p) => p.name)).toEqual(["project:p", "asset:p.a"]);
  });

  it("closes every provider and the socket on unmount", async () => {
    const { hook, server } = mount(dev());
    await waitFor(() => expect(hook.result.current.session).not.toBeNull());
    await act(() => hook.result.current.session!.open("asset:p.a").then(() => {}));
    hook.unmount();
    expect(server.sockets[0]!.destroyed).toBe(true);
    expect(server.sockets[0]!.providers.every((p) => p.destroyed)).toBe(true);
  });

  it("closes the session when the project goes null", async () => {
    const { hook, server } = mount(dev());
    await waitFor(() => expect(hook.result.current.status).toBe("live"));
    hook.rerender({ project: null });
    expect(hook.result.current.status).toBe("off");
    expect(hook.result.current.session).toBeNull();
    expect(server.sockets[0]!.destroyed).toBe(true);
  });
});

describe("useProjectSession on a hosted server", () => {
  it("mints one project token through its token source and opens on its URL", async () => {
    fakes.mint.mockResolvedValue(answer("t1"));
    const { hook, server } = mount(hosted());
    await waitFor(() => expect(hook.result.current.status).toBe("live"));
    const session = hook.result.current.session!;
    await act(() => Promise.all([session.open("asset:p.a"), session.open("asset:p.b")]));
    expect(fakes.mint).toHaveBeenCalledTimes(1);
    expect(fakes.mint).toHaveBeenCalledWith({
      projectId: "p",
      formatVersion: SCENE_FORMAT_VERSION,
      layoutVersion: COLLAB_LAYOUT_VERSION,
      access: "write",
    });
    expect(server.sockets).toHaveLength(1);
    expect(server.sockets[0]!.url).toBe("wss://sync.example.test");
    expect(server.sockets[0]!.providers.map((p) => p.tokens)).toEqual([["t1"], ["t1"], ["t1"]]);
  });

  it("asks for the access it's given and reports it", async () => {
    fakes.mint.mockResolvedValue({ ...answer("t1"), access: "read" });
    const { hook } = mount(hosted("read"));
    await waitFor(() => expect(hook.result.current.status).toBe("live"));
    expect(fakes.mint.mock.lastCall![0].access).toBe("read");
    expect(hook.result.current.access).toBe("read");
  });

  it("fails when the first token is refused", async () => {
    fakes.mint.mockRejectedValue(
      Object.assign(new Error("No such project."), { code: "NOT_FOUND" }),
    );
    const { hook, server } = mount(hosted());
    await waitFor(() => expect(hook.result.current.status).toBe("failed"));
    expect(hook.result.current.error?.message).toBe("No such project.");
    expect(server.sockets).toHaveLength(0);
  });
});

describe("project tokens", () => {
  it("reuses a token until it nears the 60 s expiry, then mints a fresh one", async () => {
    let now = 1_000;
    const mint = vi.fn().mockResolvedValueOnce(answer("t1")).mockResolvedValueOnce(answer("t2"));
    const tokens = createProjectTokens(
      { projectId: "p", formatVersion: 2, layoutVersion: 1, access: "write" },
      mint,
      { ttlMs: 60_000, now: () => now },
    );
    expect((await tokens.get()).token).toBe("t1");
    now += 60_000 - TOKEN_REFRESH_MARGIN_MS - 1;
    expect((await tokens.get()).token).toBe("t1");
    now += 1;
    expect((await tokens.get()).token).toBe("t2");
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it("shares one mint between concurrent asks, and retries after a failed one", async () => {
    const mint = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(answer("t1"));
    const tokens = createProjectTokens(
      { projectId: "p", formatVersion: 2, layoutVersion: 1, access: "write" },
      mint,
    );
    const both = await Promise.allSettled([tokens.get(), tokens.get()]);
    expect(both.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(mint).toHaveBeenCalledTimes(1);
    expect((await tokens.get()).token).toBe("t1");
  });
});

describe("doc lifetimes", () => {
  async function live() {
    const { hook, server } = mount(dev());
    await waitFor(() => expect(hook.result.current.status).toBe("live"));
    return { session: hook.result.current.session!, server };
  }

  it("useSessionDoc holds a doc while mounted and closes it on unmount", async () => {
    const { session, server } = await live();
    const doc = renderHook(() => useSessionDoc(session, "asset:p.a"));
    await waitFor(() => expect(doc.result.current.doc?.name).toBe("asset:p.a"));
    expect(server.provider("asset:p.a")).toBeDefined();
    doc.unmount();
    expect(session.openDocs()).toEqual(["project:p"]);
    expect(server.provider("asset:p.a")).toBeUndefined();
  });

  it("keeps a released doc open while an undo step names it", async () => {
    const { session, server } = await live();
    const doc = renderHook(() => useSessionDoc(session, "asset:p.a"));
    await waitFor(() => expect(doc.result.current.doc).not.toBeNull());
    const held = doc.result.current.doc!;
    held.doc.transact(() => held.doc.getMap("content").set("n", 1), session.origin);
    session.commit({ docs: ["asset:p.a"], label: "Set n" });
    doc.unmount();
    expect(session.openDocs()).toContain("asset:p.a");
    expect(server.provider("asset:p.a")).toBeDefined();
  });

  it("reports an open's failure", async () => {
    const { session } = await live();
    const doc = renderHook(() => useSessionDoc(session, "asset:q.a"));
    await waitFor(() => expect(doc.result.current.error).not.toBeNull());
    expect(doc.result.current.doc).toBeNull();
  });
});

describe("close codes", () => {
  function link(server = fakeServer()) {
    return {
      server,
      link: connectProjectSession({
        project: "p",
        url: devCollabUrl(),
        closeReason,
        registry,
        kinds,
        origin,
        transport: server.transport,
        retryMs: [5],
      }),
    };
  }
  const ready = async (l: ReturnType<typeof link>["link"]): Promise<ProjectSession> => {
    await vi.waitFor(() => expect(l.getState().session).not.toBeNull());
    return l.getState().session!;
  };

  it("stops a revoked doc for good and fails its open", async () => {
    const { server, link: l } = link();
    const session = await ready(l);
    server.refuse.set("asset:p.a", SYNC_CLOSE.revoked);
    await expect(session.open("asset:p.a")).rejects.toThrow(/revoked/);
    expect(l.getState().stopped).toEqual({ "asset:p.a": "revoked" });
    expect(session.openDocs()).toEqual(["project:p"]);
    l.destroy();
  });

  it("re-attaches a rate-limited doc after the backoff", async () => {
    const { server, link: l } = link();
    const session = await ready(l);
    server.refuse.set("asset:p.a", SYNC_CLOSE.rateLimited);
    const doc = await session.open("asset:p.a");
    expect(doc.name).toBe("asset:p.a");
    expect(server.provider("asset:p.a")!.attaches).toBe(2);
    expect(l.getState().stopped).toEqual({});
    l.destroy();
  });

  it("fails the session when the project doc is revoked after it opened", async () => {
    const { server, link: l } = link();
    await ready(l);
    server.provider("project:p")!.events.closed(SYNC_CLOSE.revoked, true);
    expect(l.getState().status).toBe("failed");
    expect(l.getState().stopped).toEqual({ "project:p": "revoked" });
    l.destroy();
  });

  it("leaves a closed socket's reconnect to the transport", async () => {
    const { server, link: l } = link();
    await ready(l);
    const p = server.provider("project:p")!;
    p.events.closed(null, false);
    expect(p.attached).toBe(true);
    expect(p.attaches).toBe(1);
    l.destroy();
  });
});

describe("asset:changed messages", () => {
  const changed = (over: Partial<AssetChangedMessage> = {}): AssetChangedMessage => ({
    type: ASSET_CHANGED,
    project: "p",
    key: "a",
    id: "a",
    kind: "texture",
    path: "a.png",
    sha256: "b".repeat(64),
    bytes: 3,
    previous: "a".repeat(64),
    ...over,
  });

  it("reach the link's listeners when they're about its project, and nothing else does", async () => {
    const server = fakeServer();
    const l = connectProjectSession({
      project: "p",
      url: devCollabUrl(),
      registry,
      kinds,
      origin,
      transport: server.transport,
    });
    await vi.waitFor(() => expect(l.getState().session).not.toBeNull());
    const heard: AssetChangedMessage[] = [];
    const off = l.onAssetChanged((m) => heard.push(m));
    const events = server.provider("project:p")!.events;
    events.stateless?.(JSON.stringify(changed()));
    events.stateless?.(JSON.stringify(changed({ project: "q" })));
    events.stateless?.(JSON.stringify({ type: "other", project: "p" }));
    events.stateless?.("not json");
    expect(heard).toEqual([changed()]);
    off();
    events.stateless?.(JSON.stringify(changed({ id: "b" })));
    expect(heard).toHaveLength(1);
    l.destroy();
  });

  it("reach the hook's latest onAssetChanged", async () => {
    const first = vi.fn();
    const { hook, server } = mount(dev(), fakeServer(), { onAssetChanged: first });
    await waitFor(() => expect(hook.result.current.status).toBe("live"));
    server.provider("project:p")!.events.stateless?.(JSON.stringify(changed()));
    expect(first).toHaveBeenCalledWith(changed());
    hook.unmount();
    expect(server.provider("project:p")).toBeUndefined();
  });

  it("come through Hocuspocus's onStateless", () => {
    let config: { onStateless?: (data: { payload: string }) => void } = {};
    const mod = {
      WebSocketStatus: { Connected: "connected", Connecting: "connecting" },
      HocuspocusProviderWebsocket: class {
        status = "connected";
        destroy() {}
      },
      HocuspocusProvider: class {
        awareness = {};
        constructor(c: typeof config) {
          config = c;
        }
        attach() {}
        detach() {}
        destroy() {}
      },
    } as unknown as HocuspocusModule;
    const stateless = vi.fn();
    const socket = hocuspocusTransport(mod)("ws://dev.test/__scene-collab");
    socket.provider({
      name: "project:p",
      doc: new Y.Doc(),
      token: null,
      events: { synced: () => {}, closed: () => {}, stateless },
    });
    config.onStateless?.({ payload: "hello" });
    expect(stateless).toHaveBeenCalledWith("hello");
    socket.destroy();
  });
});

describe("buildAtFrom", () => {
  it("reads epoch ms or an ISO date, padded as an env file may leave it, and anything else as 0", () => {
    expect(buildAtFrom("1700000000000")).toBe(1_700_000_000_000);
    expect(buildAtFrom("2026-11-07T00:00:00Z")).toBe(Date.parse("2026-11-07T00:00:00Z"));
    expect(buildAtFrom(" 2026-11-07T00:00:00Z\n")).toBe(Date.parse("2026-11-07T00:00:00Z"));
    expect(buildAtFrom(42)).toBe(42);
    expect(buildAtFrom(undefined)).toBe(0);
    expect(buildAtFrom("")).toBe(0);
    expect(buildAtFrom("soon")).toBe(0);
  });
});
