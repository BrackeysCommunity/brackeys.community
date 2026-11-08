import { COLLAB_LAYOUT_VERSION, type AwarenessLike, type DocOrigin } from "@jams/engine/collab";
import type { ProjectSocket, ProjectTransport } from "@jams/engine/editor-ui";
import { createRegistry, SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SYNC_LIMITS } from "@/lib/canvas/limits";
import { SYNC_CLOSE, syncClose } from "@/lib/canvas/sync-channels";

import {
  ENGINE_PROJECTS_FLAG,
  hostedProject,
  hostedProjectTokens,
  syncCloseReason,
  type MintProjectToken,
} from "../hosted-project";

vi.mock("@/orpc/client", () => ({ client: {} }));

const registry = createRegistry(null);
const origin: DocOrigin = { kind: "user", userId: "u", name: "U" };

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

type Opened = {
  name: string;
  token: (() => Promise<string>) | null;
  events: Parameters<ProjectSocket["provider"]>[0]["events"];
};

/** A socket whose docs never sync: the test closes them as the server would. */
function fakeTransport() {
  const urls: string[] = [];
  const opened: Opened[] = [];
  const transport: ProjectTransport = (url) => {
    urls.push(url);
    return {
      status: () => "connected",
      subscribe: () => () => {},
      provider({ name, token, events }) {
        opened.push({ name, token, events });
        return { awareness: fakeAwareness(), attach() {}, detach() {}, destroy() {} };
      },
      destroy() {},
    };
  };
  return { transport, urls, opened };
}

const answer = { token: "t1", url: "wss://sync.example.test/engine", access: "write" as const };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
});

describe("syncCloseReason", () => {
  it("maps canvas-sync's revoked and too-large closes to a stop", () => {
    expect(syncCloseReason(SYNC_CLOSE.revoked)).toBe("revoked");
    expect(syncCloseReason(SYNC_CLOSE.tooLarge)).toBe("too-large");
    expect(syncCloseReason(1009)).toBe("too-large");
  });

  it("reads the code from a refused authentication's reason", () => {
    expect(syncCloseReason(null, syncClose(SYNC_CLOSE.revoked, "gone").reason)).toBe("revoked");
    expect(syncCloseReason(null, syncClose(SYNC_CLOSE.tooLarge).reason)).toBe("too-large");
  });

  it("retries everything else", () => {
    expect(syncCloseReason(SYNC_CLOSE.unauthorized)).toBe("retry");
    expect(syncCloseReason(SYNC_CLOSE.rateLimited)).toBe("retry");
    expect(syncCloseReason(1006)).toBe("retry");
    expect(syncCloseReason(null)).toBe("retry");
  });
});

describe("hostedProjectTokens", () => {
  it("mints over the given mint for the project, and reuses a token for canvas-sync's lifetime", async () => {
    let now = 1_000;
    const mint = vi.fn<MintProjectToken>(async () => answer);
    const tokens = hostedProjectTokens("p", { mint, access: "read", now: () => now });
    expect(await tokens.get()).toEqual(answer);
    expect(mint).toHaveBeenCalledWith({
      projectId: "p",
      formatVersion: SCENE_FORMAT_VERSION,
      layoutVersion: COLLAB_LAYOUT_VERSION,
      access: "read",
    });
    now += SYNC_LIMITS.tokenTtlMs / 2;
    await tokens.get();
    expect(mint).toHaveBeenCalledOnce();
    now += SYNC_LIMITS.tokenTtlMs;
    await tokens.get();
    expect(mint).toHaveBeenCalledTimes(2);
  });
});

describe("hostedProject", () => {
  it("opens nothing while the engine-projects flag is off", () => {
    const mint = vi.fn<MintProjectToken>(async () => answer);
    const { transport, urls } = fakeTransport();
    const flag = vi.fn(() => false);
    const link = hostedProject({ transport, flag, mint }).connect({
      project: "p",
      registry,
      origin,
    });
    cleanups.push(() => link.destroy());
    expect(flag).toHaveBeenCalledWith(ENGINE_PROJECTS_FLAG);
    expect(link.getState().status).toBe("off");
    expect(mint).not.toHaveBeenCalled();
    expect(urls).toEqual([]);
    const read = hostedProject({ transport, flag, mint, access: "read" }).connect({
      project: "p",
      registry,
      origin,
    });
    cleanups.push(() => read.destroy());
    expect(read.getState()).toMatchObject({ status: "off", access: "read", session: null });
  });

  it("opens the socket the minted token names, and authenticates each doc with it", async () => {
    const mint = vi.fn<MintProjectToken>(async () => answer);
    const { transport, urls, opened } = fakeTransport();
    const host = hostedProject({ transport, flag: (name) => name === ENGINE_PROJECTS_FLAG, mint });
    const link = host.connect({ project: "p", registry, origin });
    cleanups.push(() => link.destroy());
    expect(link.getState().status).toBe("connecting");
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(urls).toEqual([answer.url]);
    expect(opened[0]!.name).toBe("project:p");
    expect(await opened[0]!.token?.()).toBe("t1");
    expect(link.blobs).toBeDefined();
    expect(
      host.assetUrl("p", { id: "a", kind: "texture", sha256: "ab".repeat(32), bytes: 1 }),
    ).toBe(`/api/engine/projects/p/blobs/${"ab".repeat(32)}`);
  });

  it("stops a doc canvas-sync closes for good, and fails the session when it is the project's", async () => {
    const { transport, opened } = fakeTransport();
    const link = hostedProject({ transport, flag: () => true, mint: async () => answer }).connect({
      project: "p",
      registry,
      origin,
    });
    cleanups.push(() => link.destroy());
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    opened[0]!.events.closed(SYNC_CLOSE.tooLarge, true);
    await vi.waitFor(() => expect(link.getState().stopped).toEqual({ "project:p": "too-large" }));
    await vi.waitFor(() => expect(link.getState().status).toBe("failed"));
  });
});
