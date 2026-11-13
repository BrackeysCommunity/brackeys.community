import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createBroadcast } from "@/lib/live-broadcast";

type Handler = (...args: string[]) => void;

const bus = vi.hoisted(() => {
  const clients: { name: string; channels: Set<string>; handlers: Map<string, Handler[]> }[] = [];
  return { clients, failPublish: false };
});

vi.mock("@/lib/redis", () => ({
  createRedisClient: async (name: string) => {
    const client = { name, channels: new Set<string>(), handlers: new Map<string, Handler[]>() };
    bus.clients.push(client);
    return {
      status: "ready",
      on(event: string, fn: Handler) {
        client.handlers.set(event, [...(client.handlers.get(event) ?? []), fn]);
      },
      async subscribe(channel: string) {
        client.channels.add(channel);
      },
      async publish(channel: string, message: string) {
        if (bus.failPublish) throw new Error("redis down");
        for (const other of bus.clients) {
          if (!other.channels.has(channel)) continue;
          for (const fn of other.handlers.get("message") ?? []) fn(channel, message);
        }
        return 1;
      },
    };
  },
}));

vi.mock("@/lib/posthog-server", () => ({
  bestEffort: async (_scope: string, _ctx: unknown, fn: () => unknown) => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  },
}));

type Ping = { n: number };
const parsePing = (raw: unknown): Ping | null =>
  typeof raw === "object" && raw !== null && typeof (raw as Ping).n === "number"
    ? { n: (raw as Ping).n }
    : null;

let redisUrl: string | undefined;
let seq = 0;
const uniqueName = () => `test-broadcast-${++seq}`;

beforeEach(() => {
  redisUrl = process.env.REDIS_URL;
  bus.clients.length = 0;
  bus.failPublish = false;
});
afterEach(() => {
  if (redisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = redisUrl;
});

describe("createBroadcast without Redis", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
  });

  it("fans out locally when localWithoutRedis is set, and stops after unsubscribe", async () => {
    const live = createBroadcast<Ping>({
      name: uniqueName(),
      channel: "test:ping",
      parse: parsePing,
      localWithoutRedis: true,
    });
    const a: Ping[] = [];
    const b: Ping[] = [];
    const offA = await live.listen((event) => a.push(event));
    await live.listen((event) => b.push(event));
    await live.announce({ n: 1 });
    offA();
    await live.announce({ n: 2 });
    expect(a).toEqual([{ n: 1 }]);
    expect(b).toEqual([{ n: 1 }, { n: 2 }]);
    expect(bus.clients).toEqual([]);
  });

  it("delivers nothing locally without the option", async () => {
    const live = createBroadcast<Ping>({
      name: uniqueName(),
      channel: "test:ping",
      parse: parsePing,
    });
    const heard = vi.fn();
    await live.listen(heard);
    await live.announce({ n: 1 });
    expect(heard).not.toHaveBeenCalled();
    expect(bus.clients).toEqual([]);
  });

  it("drops a payload parse refuses", async () => {
    const live = createBroadcast<Ping>({
      name: uniqueName(),
      channel: "test:ping",
      parse: (raw) => {
        const ping = parsePing(raw);
        return ping && ping.n >= 0 ? ping : null;
      },
      localWithoutRedis: true,
    });
    const heard: Ping[] = [];
    await live.listen((event) => heard.push(event));
    await live.announce({ n: -1 });
    await live.announce({ n: 3 });
    expect(heard).toEqual([{ n: 3 }]);
  });

  it("keeps fanning out past a throwing listener", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const live = createBroadcast<Ping>({
      name: uniqueName(),
      channel: "test:ping",
      parse: parsePing,
      localWithoutRedis: true,
    });
    const later = vi.fn();
    await live.listen(() => {
      throw new Error("listener broke");
    });
    await live.listen(later);
    await live.announce({ n: 1 });
    expect(later).toHaveBeenCalledWith({ n: 1 });
    warn.mockRestore();
  });
});

describe("createBroadcast with Redis", () => {
  beforeEach(() => {
    process.env.REDIS_URL = "redis://test";
  });

  it("delivers once, through the subscriber, even with localWithoutRedis", async () => {
    const name = uniqueName();
    const live = createBroadcast<Ping>({
      name,
      channel: "test:ping",
      parse: parsePing,
      localWithoutRedis: true,
    });
    const heard: Ping[] = [];
    await live.listen((event) => heard.push(event));
    await live.listen(() => {});
    await live.announce({ n: 7 });
    expect(heard).toEqual([{ n: 7 }]);
    expect(bus.clients.map((client) => client.name).sort()).toEqual([name, `${name}-subscriber`]);
  });

  it("drops malformed and refused messages from the channel", async () => {
    const live = createBroadcast<Ping>({
      name: uniqueName(),
      channel: "test:ping",
      parse: parsePing,
    });
    const heard: Ping[] = [];
    await live.listen((event) => heard.push(event));
    const subscriber = bus.clients[0];
    for (const fn of subscriber?.handlers.get("message") ?? []) {
      fn("test:ping", "not json");
      fn("test:ping", JSON.stringify({ n: "x" }));
      fn("other:channel", JSON.stringify({ n: 1 }));
      fn("test:ping", JSON.stringify({ n: 2 }));
    }
    expect(heard).toEqual([{ n: 2 }]);
  });

  it("swallows a failing publish and delivers nothing", async () => {
    const live = createBroadcast<Ping>({
      name: uniqueName(),
      channel: "test:ping",
      parse: parsePing,
      localWithoutRedis: true,
    });
    const heard = vi.fn();
    await live.listen(heard);
    bus.failPublish = true;
    await expect(live.announce({ n: 1 })).resolves.toBeUndefined();
    expect(heard).not.toHaveBeenCalled();
  });

  it("shares one subscriber per name across instances of the module's broadcast", async () => {
    const name = uniqueName();
    const first = createBroadcast<Ping>({ name, channel: "test:ping", parse: parsePing });
    const second = createBroadcast<Ping>({ name, channel: "test:ping", parse: parsePing });
    const heard: Ping[] = [];
    await first.listen((event) => heard.push(event));
    await second.listen(() => {});
    await second.announce({ n: 4 });
    expect(heard).toEqual([{ n: 4 }]);
    expect(bus.clients.filter((client) => client.name === `${name}-subscriber`)).toHaveLength(1);
  });
});

type Note = { ids: string[] };
const encodeNote = (note: Note) => `ids=${note.ids.join(",")}`;
const decodeNote = (message: string): Note | null =>
  message.startsWith("ids=") ? { ids: message.slice(4).split(",").filter(Boolean) } : null;

describe("createBroadcast with its own wire format, delivering here", () => {
  const noteBroadcast = (name = uniqueName()) =>
    createBroadcast<Note>({
      name,
      channel: "test:note",
      encode: encodeNote,
      decode: decodeNote,
      deliverHere: true,
    });

  it("hands an announcement here at once without Redis", async () => {
    delete process.env.REDIS_URL;
    const live = noteBroadcast();
    const heard: Note[] = [];
    await live.listen((event) => heard.push(event));
    await live.announce({ ids: ["a"] });
    expect(heard).toEqual([{ ids: ["a"] }]);
    expect(bus.clients).toEqual([]);
  });

  it("hands it here, then publishes it in the wire format", async () => {
    process.env.REDIS_URL = "redis://test";
    const live = noteBroadcast();
    const heard: Note[] = [];
    await live.listen((event) => heard.push(event));
    const sent: string[] = [];
    bus.clients.push({
      name: "spy",
      channels: new Set(["test:note"]),
      handlers: new Map([["message", [(_channel: string, message: string) => sent.push(message)]]]),
    });
    await live.announce({ ids: ["a", "b"] });
    expect(sent).toEqual(["ids=a,b"]);
    // Once here at once, once more through this instance's subscriber.
    expect(heard).toEqual([{ ids: ["a", "b"] }, { ids: ["a", "b"] }]);
  });

  it("publish only publishes", async () => {
    delete process.env.REDIS_URL;
    const live = noteBroadcast();
    const heard = vi.fn();
    await live.listen(heard);
    const sent: string[] = [];
    await live.publish(
      { ids: ["a"] },
      { publish: async (_channel, message) => sent.push(message) },
    );
    expect(sent).toEqual(["ids=a"]);
    expect(heard).not.toHaveBeenCalled();
  });

  it("listens through a given subscriber and drops what decode refuses", async () => {
    delete process.env.REDIS_URL;
    const handlers: ((channel: string, message: string) => void)[] = [];
    const subscribed: string[] = [];
    const live = noteBroadcast();
    const heard: Note[] = [];
    await live.listen((event) => heard.push(event), {
      subscriber: async () => ({
        status: "ready",
        on(event, listener) {
          if (event === "message") handlers.push(listener);
        },
        async subscribe(channel) {
          subscribed.push(channel);
        },
      }),
    });
    for (const handler of handlers) {
      handler("test:note", "nonsense");
      handler("test:other", "ids=x");
      handler("test:note", "ids=c");
    }
    expect(subscribed).toEqual(["test:note"]);
    expect(heard).toEqual([{ ids: ["c"] }]);
  });
});
