import type { Sha256 } from "../project/types";
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import {
  frameMessageSchema,
  HOST_HANDSHAKE_TIMEOUT_MS,
  HOST_PROTOCOL_VERSION,
  HOST_REQUEST_TIMEOUT_MS,
  HOST_WELCOME_TIMEOUT_MS,
  HOST_REQUESTS,
  hostHandshakeSchema,
  hostMessageSchema,
  withinHostMessageCap,
  type HostEvents,
  type HostFeature,
  type HostRequestMethod,
  type HostRequestParams,
  type HostRequestResult,
  type HostWelcome,
  type LiveStateMessage,
} from "./host-protocol";

/** The frame's end of the `jams-host` channel, open once the page has answered `hello`. */
export type HostChannel = {
  /** The page's answer to `hello`. */
  readonly welcome: HostWelcome;
  /** How many of the page's messages were dropped: over the size cap, not the protocol's shape, or a reply to nothing. */
  readonly dropped: number;
  /**
   * One request; rejects with a `HostRequestError` carrying the page's
   * issue, or `save-store-failed` when the channel closes first, the page
   * doesn't answer within the channel's `requestTimeoutMs`, or the page's
   * result isn't the method's.
   */
  request<M extends HostRequestMethod>(
    method: M,
    params: HostRequestParams<M>,
  ): Promise<HostRequestResult<M>>;
  /** Listens for one of the page's events; returns the unsubscribe. */
  on<E extends keyof HostEvents>(event: E, fn: (data: HostEvents[E]) => void): () => void;
  /** Reports the game's boot state to the page. */
  state(state: "loading" | "ready" | "error", issue?: SceneIssue): void;
  /** Hands the page a file to offer as a download button; the frame can't start downloads itself. */
  offerDownload(name: string, contentType: string, bytes: ArrayBuffer): void;
  /** Reports where one scene's live version stands. */
  liveState(message: LiveStateMessage): void;
  close(): void;
};

export type ConnectHostOptions = {
  /** What the frame says in `hello`. */
  hello: { engine: string; release: Sha256; game: string };
  /** How long to wait for the page's port; default `HOST_HANDSHAKE_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** How long to wait for `welcome` once the port arrived; default `HOST_WELCOME_TIMEOUT_MS`. */
  welcomeTimeoutMs?: number;
  /** How long each later request waits for the page's reply; default `HOST_REQUEST_TIMEOUT_MS`. */
  requestTimeoutMs?: number;
  /** The frame's window; default the global one. */
  window?: Window;
  /** What the frame supports, sent in `hello`; none by default, and an empty list sends none. */
  features?: readonly HostFeature[];
};

/** A request the page refused or the channel couldn't carry: `issue` is the page's own, passed on unchanged. */
export class HostRequestError extends Error {
  readonly issue: SceneIssue;
  constructor(issue: SceneIssue) {
    super(issue.message);
    this.name = "HostRequestError";
    this.issue = issue;
  }
}

const channelFailed = (message: string): HostRequestError =>
  new HostRequestError(makeIssue("save-store-failed", { message }));

type Pending = {
  method: HostRequestMethod;
  resolve(result: unknown): void;
  reject(error: HostRequestError): void;
  timer?: ReturnType<typeof setTimeout>;
};

const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`;

type Listeners = { [E in keyof HostEvents]: Set<(data: HostEvents[E]) => void> };

/** A listener that throws is reported, never let into the channel's own handling. */
function deliver<T>(fns: Iterable<(data: T) => void>, data: T): void {
  for (const fn of [...fns]) {
    try {
      fn(data);
    } catch (error) {
      globalThis.reportError?.(error);
    }
  }
}

type OpenChannel = HostChannel & {
  setWelcome(w: HostWelcome): void;
  /** `hello`, bounded by `connectHost`'s welcome timeout rather than the request one. */
  hello(params: HostRequestParams<"hello">): Promise<HostWelcome>;
};

/** The channel over `port`; `welcome` is set once `hello` is answered. */
function openChannel(port: MessagePort, requestTimeoutMs: number): OpenChannel {
  let nextId = 0;
  let dropped = 0;
  let closed = false;
  let welcome: HostWelcome | null = null;
  const pending = new Map<number, Pending>();
  const listeners: Listeners = {
    "saves.changed": new Set(),
    pause: new Set(),
    resume: new Set(),
    "live.update": new Set(),
    "recording.request": new Set(),
  };

  const receive = (data: unknown) => {
    if (closed) return;
    let parsed: ReturnType<typeof hostMessageSchema.safeParse> | null = null;
    try {
      parsed = withinHostMessageCap(data) ? hostMessageSchema.safeParse(data) : null;
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      dropped++;
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "reply": {
        const waiting = pending.get(message.id);
        if (!waiting) {
          dropped++;
          return;
        }
        settle(message.id);
        if (!message.ok) {
          waiting.reject(new HostRequestError(message.issue));
          return;
        }
        const result = HOST_REQUESTS[waiting.method].result.safeParse(message.result);
        if (result.success) waiting.resolve(result.data);
        else {
          dropped++;
          waiting.reject(channelFailed(`the page's answer to ${waiting.method} isn't valid`));
        }
        return;
      }
      case "saves.changed":
        deliver(listeners["saves.changed"], message.saves);
        return;
      case "pause":
      case "resume":
      case "recording.request":
        deliver(listeners[message.type], undefined);
        return;
      case "live.update":
        deliver(listeners["live.update"], message.live);
        return;
    }
  };

  /** Posts `message` when it is the protocol's and fits its cap; false when it isn't sent. */
  const post = (message: unknown): boolean => {
    if (closed || !withinHostMessageCap(message)) return false;
    if (!frameMessageSchema.safeParse(message).success) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  };

  /** Forgets request `id` and its timer. */
  function settle(id: number): void {
    const waiting = pending.get(id);
    if (waiting?.timer !== undefined) globalThis.clearTimeout(waiting.timer);
    pending.delete(id);
  }

  function send<M extends HostRequestMethod>(
    method: M,
    params: HostRequestParams<M>,
    timeoutMs: number | null,
  ): Promise<HostRequestResult<M>> {
    if (closed)
      return Promise.reject(channelFailed(`${method}: the channel to the page is closed`));
    const id = nextId++;
    return new Promise<HostRequestResult<M>>((resolve, reject) => {
      const waiting: Pending = { method, resolve: resolve as (r: unknown) => void, reject };
      pending.set(id, waiting);
      if (!post({ type: method, id, params })) {
        pending.delete(id);
        reject(channelFailed(`${method}: the request isn't one the channel can carry`));
        return;
      }
      if (timeoutMs !== null)
        waiting.timer = globalThis.setTimeout(() => {
          pending.delete(id);
          reject(channelFailed(`${method}: the page didn't answer within ${seconds(timeoutMs)}`));
        }, timeoutMs);
    });
  }

  port.onmessage = (event: MessageEvent) => receive(event.data);
  port.start();

  return {
    get welcome() {
      if (!welcome) throw new Error("the page hasn't answered hello yet");
      return welcome;
    },
    get dropped() {
      return dropped;
    },
    setWelcome(w) {
      welcome = w;
    },
    hello: (params) => send("hello", params, null),
    request: (method, params) => send(method, params, requestTimeoutMs),
    on(event, fn) {
      const set = listeners[event] as Set<typeof fn>;
      if (!closed) set.add(fn);
      return () => void set.delete(fn);
    },
    state(state, issue) {
      post(
        issue ? { type: "state", jamsState: state, issue } : { type: "state", jamsState: state },
      );
    },
    offerDownload(name, contentType, bytes) {
      post({ type: "download", name, contentType, bytes });
    },
    liveState(message) {
      post({ ...message, type: "live.state" });
    },
    close() {
      if (closed) return;
      closed = true;
      port.onmessage = null;
      port.close();
      for (const waiting of pending.values()) {
        if (waiting.timer !== undefined) globalThis.clearTimeout(waiting.timer);
        waiting.reject(channelFailed(`${waiting.method}: the channel to the page closed`));
      }
      pending.clear();
      for (const set of Object.values(listeners)) set.clear();
    },
  };
}

/**
 * Opens the channel to the page that frames this game: posts
 * `jams:frame-ready` to the parent window, keeps the port of the first
 * `jams:host` it answers with, then sends `hello`. Resolves null when the
 * frame has no parent, no port arrives within `timeoutMs`, or no `welcome`
 * within `welcomeTimeoutMs` after it;
 * the game then plays as a plain standalone build. Every other window
 * message is ignored. Each request after `hello` waits `requestTimeoutMs`
 * for its reply.
 */
export function connectHost(opts: ConnectHostOptions): Promise<HostChannel | null> {
  const win = opts.window ?? (typeof window === "undefined" ? undefined : window);
  const parent = win?.parent;
  if (!win || !parent || parent === win) return Promise.resolve(null);
  const timeoutMs = opts.timeoutMs ?? HOST_HANDSHAKE_TIMEOUT_MS;

  return new Promise((resolve) => {
    let channel: OpenChannel | null = null;
    let settled = false;
    const finish = (welcome: HostWelcome | null) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      win.removeEventListener("message", onMessage);
      if (welcome && channel) {
        channel.setWelcome(welcome);
        resolve(channel);
      } else {
        channel?.close();
        resolve(null);
      }
    };
    let timer = globalThis.setTimeout(() => finish(null), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      if (channel || event.source !== parent) return;
      const port = event.ports[0];
      if (!port || !hostHandshakeSchema.safeParse(event.data).success) return;
      win.removeEventListener("message", onMessage);
      globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(
        () => finish(null),
        opts.welcomeTimeoutMs ?? HOST_WELCOME_TIMEOUT_MS,
      );
      const opened = openChannel(port, opts.requestTimeoutMs ?? HOST_REQUEST_TIMEOUT_MS);
      channel = opened;
      const features = opts.features ?? [];
      opened
        .hello(features.length > 0 ? { ...opts.hello, features: [...features] } : opts.hello)
        .then(finish, () => finish(null));
    };
    win.addEventListener("message", onMessage);
    try {
      parent.postMessage({ type: "jams:frame-ready", protocol: HOST_PROTOCOL_VERSION }, "*");
    } catch {
      finish(null);
    }
  });
}

/** Whether the page asked this frame to look for a host: `?host=jams` on its URL. */
export function hostRequested(href: string | undefined): boolean {
  if (href === undefined) return false;
  try {
    return new URL(href).searchParams.get("host") === "jams";
  } catch {
    return false;
  }
}
