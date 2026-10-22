import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import type { Redis as RedisExtension } from "@hocuspocus/extension-redis";

import { ResilientRelay } from "./redis.ts";

/** Stands in for extension-redis: records calls, and its subscribe can hang. */
function fakeRelay() {
  const sub = Object.assign(new EventEmitter(), { status: "connecting", disconnect() {} });
  const pub = { status: "connecting", disconnect() {} };
  const calls: string[] = [];
  let hang = false;
  const relay = {
    pub,
    sub,
    async onConfigure() {},
    afterLoadDocument({ documentName }: { documentName: string }) {
      calls.push(`load:${documentName}`);
      return hang ? new Promise<void>(() => {}) : Promise.resolve();
    },
    async onChange({ documentName }: { documentName: string }) {
      calls.push(`change:${documentName}`);
    },
    async onAwarenessUpdate() {
      calls.push("awareness");
    },
    async beforeUnloadDocument({ documentName }: { documentName: string }) {
      calls.push(`beforeUnload:${documentName}`);
    },
    async afterUnloadDocument({ documentName }: { documentName: string }) {
      calls.push(`unload:${documentName}`);
    },
    async onDestroy() {
      throw new Error("Stream isn't writeable");
    },
  };
  const up = () => {
    pub.status = "ready";
    sub.status = "ready";
    sub.emit("ready");
  };
  return {
    relay,
    calls,
    up,
    down: () => {
      pub.status = "reconnecting";
      sub.status = "reconnecting";
    },
    hangSubscribes: () => {
      hang = true;
    },
  };
}

function setup() {
  const fake = fakeRelay();
  const documents = new Map<string, object>();
  const extension = new ResilientRelay(fake.relay as unknown as RedisExtension, 50);
  void extension.onConfigure({ instance: { documents } } as never);
  const load = async (name: string) => {
    const document = {};
    await extension.afterLoadDocument({ documentName: name, document } as never);
    documents.set(name, document);
  };
  const unload = async (name: string) => {
    await extension.beforeUnloadDocument({ documentName: name } as never);
    documents.delete(name);
    await extension.afterUnloadDocument({ documentName: name, instance: { documents } } as never);
  };
  return { ...fake, extension, documents, load, unload };
}

describe("ResilientRelay", () => {
  it("loads and edits without touching Redis while it's down", async () => {
    const { extension, calls, load } = setup();
    await load("canvas:a");
    await extension.onChange({ documentName: "canvas:a" } as never);
    await extension.onAwarenessUpdate({ documentName: "canvas:a" } as never);
    expect(calls).toEqual([]);
  });

  it("never runs a store hook, so a lock held elsewhere can't skip a store", () => {
    const { extension } = setup();
    expect("onStoreDocument" in extension).toBe(false);
    expect("afterStoreDocument" in extension).toBe(false);
  });

  it("subscribes what loaded without Redis once it's back, and re-announces the rest", async () => {
    const { calls, load, up } = setup();
    await load("canvas:a");
    up();
    await load("canvas:b");
    await Bun.sleep(0);
    expect(calls).toEqual(["load:canvas:a", "load:canvas:b"]);
    calls.length = 0;
    // A later reconnect: both are subscribed, so both just announce their state.
    up();
    await Bun.sleep(0);
    expect(calls.sort()).toEqual(["change:canvas:a", "change:canvas:b"]);
  });

  it("goes on without the relay when a subscribe hangs", async () => {
    const { calls, load, up, hangSubscribes } = setup();
    up();
    hangSubscribes();
    const started = performance.now();
    await load("canvas:a");
    expect(performance.now() - started).toBeLessThan(500);
    expect(calls).toEqual(["load:canvas:a"]);
  });

  it("delays and unsubscribes an unload only for documents it relays", async () => {
    const { calls, load, unload, up } = setup();
    await load("canvas:a");
    await unload("canvas:a");
    expect(calls).toEqual([]);
    calls.length = 0;
    up();
    await load("canvas:b");
    await unload("canvas:b");
    expect(calls).toEqual(["load:canvas:b", "beforeUnload:canvas:b", "unload:canvas:b"]);
  });

  it("shuts down even when Redis refuses the teardown", async () => {
    const { extension } = setup();
    await extension.onDestroy();
  });
});
