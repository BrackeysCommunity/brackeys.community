// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { seedProjectDoc, type DocOrigin } from "../../collab/index";
import { createKindRegistry } from "../../project/index";
import { createRegistry } from "../../scene/index";
import { hocuspocusTransport } from "../connect/hocuspocus";
import { connectProjectSession } from "../connect/project-session";
import type { HocuspocusModule } from "../host";

type Config = {
  name: string;
  document: Y.Doc;
  onSynced?: (data: { state: boolean }) => void;
  onUnsyncedChanges?: (data: { number: number }) => void;
};

/** `@hocuspocus/provider` in memory: each provider syncs its doc from a seeded copy when it attaches. */
function fakeHocuspocus() {
  const server = new Map<string, Y.Doc>();
  const project = new Y.Doc();
  seedProjectDoc(
    project,
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {
        a: { key: "a", id: "a", kind: "scene", path: "a.json", created: { at: 0, by: "seed" } },
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  server.set("project:p", project);
  const providers = new Map<string, Config>();
  const mod = {
    WebSocketStatus: { Connected: "connected", Connecting: "connecting" },
    HocuspocusProviderWebsocket: class {
      status = "connected";
      destroy() {}
    },
    HocuspocusProvider: class {
      awareness = {};
      constructor(private config: Config) {
        providers.set(config.name, config);
      }
      attach() {
        const from = server.get(this.config.name) ?? new Y.Doc();
        Y.applyUpdate(this.config.document, Y.encodeStateAsUpdate(from));
        queueMicrotask(() => this.config.onSynced?.({ state: true }));
      }
      detach() {}
      destroy() {
        providers.delete(this.config.name);
      }
    },
  } as unknown as HocuspocusModule;
  return { mod, providers };
}

const origin: DocOrigin = { kind: "user", userId: "u", name: "U" };

describe("unsynced updates", () => {
  it("reach the connection's state from each provider's onUnsyncedChanges, summed over its docs", async () => {
    const { mod, providers } = fakeHocuspocus();
    const link = connectProjectSession({
      project: "p",
      registry: createRegistry(null),
      kinds: createKindRegistry(null),
      origin,
      transport: hocuspocusTransport(mod),
      url: "ws://dev.test/__scene-collab",
    });
    await expect.poll(() => link.getState().status).toBe("live");
    expect(link.getState().unsynced).toBe(0);
    providers.get("project:p")!.onUnsyncedChanges?.({ number: 2 });
    expect(link.getState().unsynced).toBe(2);

    const session = link.getState().session!;
    await session.open("scene:p.a");
    providers.get("scene:p.a")!.onUnsyncedChanges?.({ number: 1 });
    expect(link.getState().unsynced).toBe(3);

    providers.get("project:p")!.onUnsyncedChanges?.({ number: 0 });
    expect(link.getState().unsynced).toBe(1);
    let heard = 0;
    link.subscribe(() => heard++);
    providers.get("project:p")!.onUnsyncedChanges?.({ number: 0 });
    expect(heard).toBe(0);

    session.release("scene:p.a");
    expect(link.getState().unsynced).toBe(0);
    link.destroy();
  });
});
