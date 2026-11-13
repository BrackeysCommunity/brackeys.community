import type { SaveStore } from "@jams/engine";
import { makeIssue, type SceneIssue } from "@jams/engine/scene";
import {
  frameMessageSchema,
  frameReadySchema,
  HOST_PROTOCOL_VERSION,
  withinHostMessageCap,
  type FrameMessage,
  type HostMessage,
  type HostSaves,
} from "@jams/engine/standalone";

import { SITE } from "@/lib/legal-meta";

import {
  HOST_DOWNLOAD_INTERVAL_SECONDS,
  HOST_PREFS_WRITES_PER_SECOND,
  HOST_SAVE_REQUESTS_PER_SECOND,
  SITE_SAVE_LIMITS,
} from "./limits";
import { prefsRefusal, siteSaveRefusal } from "./local-saves";

export type SaveMode = "site" | "own" | "none";

export type HostServerOptions = {
  iframe: HTMLIFrameElement;
  release: { id: string; gameId: string; projectId: string };
  /** This browser's saves signed out, the save API's signed in; read on every request. */
  saves: () => SaveStore;
  describe: () => string;
  /** Where the project saves; a function when it can change while the page is open. */
  mode: SaveMode | (() => SaveMode);
  /** The project plays online; `welcome` tells the frame. Default false. */
  online?: boolean;
  prefs: {
    load(): { remap: unknown; prefs: unknown };
    save(store: "remap" | "prefs", value: unknown): void;
  };
  /** Who plays, as `welcome` says; signed out when absent. */
  player?: () => { signedIn: boolean; name: string | null };
  onState?(s: { jamsState: string; issue?: SceneIssue }): void;
  onDownload?(d: { name: string; contentType: string; bytes: ArrayBuffer }): void;
  sessionToken?(sessionId: string): Promise<{ token: string; url: string }>;
};

export type HostServer = {
  /** Tells the frame where saves go now: after a claim, or when the store, its limits or the mode change. */
  notifySavesChanged(): void;
  pause(): void;
  resume(): void;
  /** How many of the frame's messages were dropped: over the cap, not the protocol's, or throttled events. */
  readonly dropped: number;
  dispose(): void;
};

export const HOST_THROTTLED_MESSAGE = "Too many save requests; try again in a moment.";
export const HOST_NO_SITE_SAVES_MESSAGE = `This game doesn't save to ${SITE.name}.`;
export const HOST_NO_SITE_SAVES_HINT =
  "Its publisher set it to save on its own servers or not at all.";

/** How often each kind of message may arrive: `max` within `windowMs`. */
export const HOST_RATES = {
  saves: { max: HOST_SAVE_REQUESTS_PER_SECOND, windowMs: 1_000 },
  prefs: { max: HOST_PREFS_WRITES_PER_SECOND, windowMs: 1_000 },
  download: { max: 1, windowMs: HOST_DOWNLOAD_INTERVAL_SECONDS * 1_000 },
} as const;

type RateName = keyof typeof HOST_RATES;

/** A sliding window of arrival times; `take` is false once the window is full. */
function rateWindow(rate: { max: number; windowMs: number }) {
  const times: number[] = [];
  return {
    take(now: number): boolean {
      while (times.length > 0 && (times[0] ?? 0) <= now - rate.windowMs) times.shift();
      if (times.length >= rate.max) return false;
      times.push(now);
      return true;
    },
  };
}

/** A request the page refuses; its issue goes back to the frame unchanged. */
class Refusal extends Error {
  readonly issue: SceneIssue;
  constructor(issue: SceneIssue) {
    super(issue.message);
    this.issue = issue;
  }
}

const storeFailed = (message: string) => new Refusal(makeIssue("save-store-failed", { message }));

const notSiteSaves = () =>
  new Refusal(
    makeIssue("save-forbidden", {
      message: HOST_NO_SITE_SAVES_MESSAGE,
      hint: HOST_NO_SITE_SAVES_HINT,
    }),
  );

type MessageOf<T extends FrameMessage["type"]> = Extract<FrameMessage, { type: T }>;

/** One row per message type: the rate it counts against, and what the page does with it. */
type Row<T extends FrameMessage["type"]> = {
  rate?: RateName;
  handle(message: MessageOf<T>): unknown;
};
type DispatchTable = { [T in FrameMessage["type"]]: Row<T> };

/**
 * The play page's end of the `jams-host` channel. It answers only a
 * `jams:frame-ready` from its own iframe's window on an opaque origin,
 * transfers a fresh port (again whenever the frame reloads), and serves
 * every message on it from one dispatch table: validated with the engine's
 * protocol schemas, capped, and throttled. Malformed messages are dropped
 * and counted, never answered.
 */
export function createHostServer(opts: HostServerOptions): HostServer {
  const page = opts.iframe.ownerDocument.defaultView ?? window;
  const { gameId } = opts.release;
  const rates = {
    saves: rateWindow(HOST_RATES.saves),
    prefs: rateWindow(HOST_RATES.prefs),
    download: rateWindow(HOST_RATES.download),
  };
  let port: MessagePort | null = null;
  let dropped = 0;
  let disposed = false;

  const modeNow = (): SaveMode => (typeof opts.mode === "function" ? opts.mode() : opts.mode);
  /** Site writes are refused for a game that saves on its own servers or not at all. */
  const siteSaves = () => modeNow() === "site";

  const savesNow = (): HostSaves => {
    const store = opts.saves();
    return {
      describe: opts.describe(),
      limits: {
        maxBytes: Math.min(SITE_SAVE_LIMITS.maxBytes, store.limits?.maxBytes ?? Infinity),
        maxSlots: Math.min(SITE_SAVE_LIMITS.maxSlots, store.limits?.maxSlots ?? Infinity),
      },
      mode: modeNow(),
    };
  };

  const post = (target: MessagePort | null, message: HostMessage): void => {
    if (disposed || !target) return;
    try {
      target.postMessage(message);
    } catch {
      // A port the frame has gone from takes nothing; the next frame-ready opens another.
    }
  };

  const ownGame = (named: string) => {
    if (named !== gameId)
      throw storeFailed(`This page keeps saves for "${gameId}", not "${named}".`);
  };

  const table: DispatchTable = {
    hello: {
      handle({ params }) {
        if (params.game !== gameId || params.release !== opts.release.id) {
          throw new Refusal(
            makeIssue("release-forbidden", {
              message: "This frame isn't the release this page opened.",
            }),
          );
        }
        return {
          player: opts.player?.() ?? { signedIn: false, name: null },
          saves: savesNow(),
          prefs: opts.prefs.load(),
          online: opts.online ?? false,
        };
      },
    },
    "saves.list": {
      rate: "saves",
      async handle({ params }) {
        ownGame(params.gameId);
        return siteSaves() ? [...(await opts.saves().list(gameId))] : [];
      },
    },
    "saves.read": {
      rate: "saves",
      async handle({ params }) {
        ownGame(params.gameId);
        return siteSaves() ? await opts.saves().read(gameId, params.slot) : null;
      },
    },
    "saves.write": {
      rate: "saves",
      async handle({ params }) {
        ownGame(params.gameId);
        if (!siteSaves()) throw notSiteSaves();
        const store = opts.saves();
        const refused = await siteSaveRefusal(params, async () =>
          (await store.list(gameId)).map((s) => s.slot),
        );
        if (refused) return { ok: false, issue: refused };
        return store.write(gameId, params.slot, params.text);
      },
    },
    "saves.remove": {
      rate: "saves",
      async handle({ params }) {
        ownGame(params.gameId);
        if (siteSaves()) await opts.saves().remove(gameId, params.slot);
        return null;
      },
    },
    "prefs.save": {
      rate: "prefs",
      handle({ params }) {
        const refused = prefsRefusal(params.value);
        if (refused) throw new Refusal(refused);
        opts.prefs.save(params.store, params.value);
        return null;
      },
    },
    "session.token": {
      async handle({ params }) {
        if (!opts.sessionToken) {
          throw new Refusal(
            makeIssue("release-forbidden", {
              message: `This game doesn't play online on ${SITE.name}.`,
            }),
          );
        }
        return opts.sessionToken(params.sessionId);
      },
    },
    state: {
      handle(message) {
        opts.onState?.(
          message.issue
            ? { jamsState: message.jamsState, issue: message.issue }
            : { jamsState: message.jamsState },
        );
      },
    },
    download: {
      rate: "download",
      handle(message) {
        opts.onDownload?.({
          name: message.name,
          contentType: message.contentType,
          bytes: message.bytes,
        });
      },
    },
    // This page sends no live versions, so a frame's reports about them have nothing to update.
    "live.state": { handle() {} },
  };

  const answer = async (from: MessagePort, id: number, run: () => unknown) => {
    let reply: HostMessage;
    try {
      reply = { type: "reply", id, ok: true, result: await run() };
    } catch (error) {
      const issue =
        error instanceof Refusal
          ? error.issue
          : makeIssue("save-store-failed", {
              message: `The page couldn't answer: ${error instanceof Error ? error.message : String(error)}`,
            });
      reply = { type: "reply", id, ok: false, issue };
    }
    if (!withinHostMessageCap(reply)) {
      reply = {
        type: "reply",
        id,
        ok: false,
        issue: makeIssue("save-store-failed", { message: "The page's answer was too large." }),
      };
    }
    post(from, reply);
  };

  const receive = (from: MessagePort, data: unknown) => {
    if (disposed || from !== port) return;
    let parsed: ReturnType<typeof frameMessageSchema.safeParse> | null;
    try {
      parsed = withinHostMessageCap(data) ? frameMessageSchema.safeParse(data) : null;
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      dropped++;
      return;
    }
    const message = parsed.data;
    const row = table[message.type] as Row<typeof message.type>;
    const isRequest = "id" in message;
    if (row.rate && !rates[row.rate].take(Date.now())) {
      if (isRequest)
        void answer(from, message.id, () => Promise.reject(storeFailed(HOST_THROTTLED_MESSAGE)));
      else dropped++;
      return;
    }
    if (isRequest) {
      void answer(from, message.id, () => row.handle(message));
      return;
    }
    try {
      row.handle(message);
    } catch (error) {
      globalThis.reportError?.(error);
    }
  };

  const onWindowMessage = (event: MessageEvent) => {
    if (disposed) return;
    const frame = opts.iframe.contentWindow;
    if (!frame || event.source !== frame || event.origin !== "null") return;
    if (!frameReadySchema.safeParse(event.data).success) return;
    port?.close();
    const channel = new MessageChannel();
    const mine = channel.port1;
    port = mine;
    mine.onmessage = (e: MessageEvent) => receive(mine, e.data);
    mine.start();
    try {
      frame.postMessage({ type: "jams:host", protocol: HOST_PROTOCOL_VERSION }, "*", [
        channel.port2,
      ]);
    } catch {
      mine.close();
      port = null;
    }
  };

  page.addEventListener("message", onWindowMessage);

  return {
    notifySavesChanged() {
      post(port, { type: "saves.changed", saves: savesNow() });
    },
    pause() {
      post(port, { type: "pause" });
    },
    resume() {
      post(port, { type: "resume" });
    },
    get dropped() {
      return dropped;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      page.removeEventListener("message", onWindowMessage);
      if (port) {
        port.onmessage = null;
        port.close();
        port = null;
      }
    },
  };
}
