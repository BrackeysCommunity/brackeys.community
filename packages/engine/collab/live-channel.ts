import type { EntitySelector } from "../game/types";
import type { InputScript } from "../headless/playtest-types";
import type { RuntimeTimings } from "../runtime/timings";
import type { StepEvent } from "../runtime/types";
import type { GameInstance, GameMode, GamePhase, GameStoreState, PlayOutcome } from "../types";
import type { AwarenessLike, PRESENCE_FIELD } from "./types";

// This module ships in the canvas-sync image and stays free of value imports.

/** A live message's largest encoded size; the relays drop anything bigger without closing. */
export const LIVE_MESSAGE_MAX_BYTES = 1.5 * 1024 * 1024;
/** A live frame's largest PNG; base64 keeps it inside `LIVE_MESSAGE_MAX_BYTES`. */
export const LIVE_FRAME_MAX_BYTES = 1024 * 1024;
/** How long a requester waits for an answer before `live-no-editor`. */
export const LIVE_REQUEST_TIMEOUT_MS = 2000;
/** The most ticks one `step` runs; they run synchronously in the editor's tab. */
export const LIVE_STEP_MAX_TICKS = 60 * 60 * 10;
/** The events a `state` answer carries when the request gives no `limit`: the newest. */
export const LIVE_STATE_EVENTS = 500;
/** A requester's extra wait per tick a `step` asks for: a slow tab's pace, well under the kitchen sink's. */
const STEP_WAIT_MS_PER_TICK = 1;

/** What an agent asks the editor that has a scene open. */
export type LiveRequest =
  | {
      t: "frame";
      id: string;
      opts: { width?: number; height?: number; viewport?: number; debug?: boolean };
    }
  | {
      t: "play";
      id: string;
      action: "play" | "pause" | "resume" | "step" | "stop";
      ticks?: number;
      from?: "start" | "here";
      script?: InputScript;
    }
  | {
      t: "state";
      id: string;
      select?: readonly ("store" | "entities" | "events" | "timings")[];
      entities?: EntitySelector;
      /** The newest this many events; default 500. */
      limit?: number;
    };

export type LiveErrorCode = "live-no-editor" | "live-refused" | "frame-too-large";

/** The editor's answer to the request with the same `id`. */
export type LiveResponse =
  | {
      t: "frame";
      id: string;
      ok: true;
      /** Base64. */
      png: string;
      width: number;
      height: number;
      tick: number;
      mode: GameMode;
    }
  | { t: "play"; id: string; ok: true; tick: number; phase: GamePhase; outcome: PlayOutcome | null }
  | {
      t: "state";
      id: string;
      ok: true;
      store?: Pick<GameStoreState, "phase" | "tick" | "mode" | "game" | "dialogue">;
      entities?: readonly unknown[];
      events?: readonly StepEvent[];
      /** How many events the log holds; more than `events` when the answer carries only the newest. */
      eventsTotal?: number;
      timings?: RuntimeTimings | null;
    }
  | {
      t: LiveRequest["t"];
      id: string;
      ok: false;
      code: LiveErrorCode;
      message: string;
    };

/**
 * A doc's provider as the live channel uses it: stateless messages, and the
 * doc's awareness when it has one (a responder advertises itself there and
 * a requester checks it before waiting).
 */
export type StatelessProvider = {
  sendStateless(payload: string): void;
  on(event: "stateless", fn: (e: { payload: string }) => void): void;
  off(event: "stateless", fn: (e: { payload: string }) => void): void;
  awareness?: AwarenessLike | null;
};

export type LiveResponderOptions = {
  /** "Let agents drive Play": false answers `live-refused`. Read per request and advertised. */
  enabled: () => boolean;
  /** Whether the scene is on screen here; default true. Advertised, so a visible editor wins the election. */
  visible?: () => boolean;
  /** Calls `changed` whenever `enabled()` or `visible()` may have changed, to re-advertise; returns the unsubscribe. */
  watch?: (changed: () => void) => () => void;
  game: () => GameInstance | null;
  /** The canvas as PNG bytes at the requested size, downscaled to fit `LIVE_FRAME_MAX_BYTES` where it can. */
  render: (req: LiveRequest & { t: "frame" }) => Promise<Uint8Array>;
  /**
   * Runs a `play` request's `play` action through the host's own Play, so
   * recordings and history behave as for a click. Without it a `play`
   * action is refused; the other actions drive `game()` directly.
   */
  play?: (req: LiveRequest & { t: "play" }) => void | Promise<void>;
};

export interface LiveResponder {
  /** Answers requests on `provider` while elected; returns the detach. */
  attach(provider: StatelessProvider, opts: LiveResponderOptions): () => void;
}

/**
 * A presence entry as the election reads it: `live` while a responder is
 * attached, `drives` while its "Let agents drive Play" is on, `hidden`
 * while its scene is off screen.
 */
export type LivePresence = { clientId: number; live?: boolean; drives?: boolean; hidden?: boolean };

const SCENE_FIELD: typeof PRESENCE_FIELD = "scene";

const rank = (e: LivePresence): number => (e.drives === true ? 0 : 2) + (e.hidden === true ? 1 : 0);

/**
 * Which client answers, among entries advertising `live: true`: one that
 * drives Play before one that only refuses, a visible one before a hidden
 * one, then the lowest client id. Null for none.
 */
export function electResponder(entries: readonly LivePresence[]): number | null {
  let best: LivePresence | null = null;
  for (const e of entries) {
    if (e.live !== true) continue;
    if (!best || rank(e) < rank(best) || (rank(e) === rank(best) && e.clientId < best.clientId))
      best = e;
  }
  return best?.clientId ?? null;
}

/** Every awareness state's live flags, this client's own included. */
export function livePresence(awareness: AwarenessLike): LivePresence[] {
  const out: LivePresence[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    const p = state[SCENE_FIELD] as
      | { live?: unknown; drives?: unknown; hidden?: unknown }
      | undefined;
    out.push({
      clientId,
      live: p?.live === true,
      ...(p?.drives === true ? { drives: true } : {}),
      ...(p?.hidden === true ? { hidden: true } : {}),
    });
  }
  return out;
}

/** Whether this client is the one that answers; true without awareness, where it is alone. */
export function electedHere(awareness: AwarenessLike | null | undefined): boolean {
  return !awareness || electResponder(livePresence(awareness)) === awareness.clientID;
}

/** The UTF-8 size of a stateless payload. */
export function liveMessageBytes(payload: string): number {
  return new TextEncoder().encode(payload).byteLength;
}

/** Whether a relay passes a doc's stateless message on: at most `LIVE_MESSAGE_MAX_BYTES`. */
export function relayableStateless(payload: string): boolean {
  // Each UTF-16 unit encodes to at most 3 bytes, so short payloads skip the encode.
  if (payload.length * 3 <= LIVE_MESSAGE_MAX_BYTES) return true;
  if (payload.length > LIVE_MESSAGE_MAX_BYTES) return false;
  return liveMessageBytes(payload) <= LIVE_MESSAGE_MAX_BYTES;
}

const isRequestType = (t: unknown): t is LiveRequest["t"] =>
  t === "frame" || t === "play" || t === "state";
const isPlayAction = (a: string): boolean =>
  a === "play" || a === "pause" || a === "resume" || a === "step" || a === "stop";

type Parsed = { t: LiveRequest["t"]; id: string; ok?: unknown } & Record<string, unknown>;

/** A live request or answer: a JSON object with `t` one of the request types and a string `id`. */
export function parseLiveMessage(payload: string): Parsed | null {
  if (payload.length === 0 || payload[0] !== "{") return null;
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const m = value as Partial<Parsed>;
  if (typeof m.id !== "string" || !isRequestType(m.t)) return null;
  return m as Parsed;
}

/** Whether a relay passes a stateless message on at all: only live requests and answers. */
export const isLiveMessage = (payload: string): boolean => parseLiveMessage(payload) !== null;

/** A live request, not an answer (answers carry `ok`). */
export function parseLiveRequest(payload: string): LiveRequest | null {
  const m = parseLiveMessage(payload);
  return m && m.ok === undefined ? (m as unknown as LiveRequest) : null;
}

function failure(
  t: LiveRequest["t"],
  id: string,
  code: LiveErrorCode,
  message: string,
): LiveResponse {
  return { t, id, ok: false, code, message };
}

const BASE64_CHUNK = 0x8000;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** A PNG's pixel size from its IHDR chunk; null for bytes that aren't a PNG. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function plainClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

async function answer(req: LiveRequest, opts: LiveResponderOptions): Promise<LiveResponse> {
  if (!opts.enabled()) {
    return failure(
      req.t,
      req.id,
      "live-refused",
      "This editor doesn't let agents drive Play: turn on Let agents drive Play there.",
    );
  }
  const game = opts.game();
  if (!game) return failure(req.t, req.id, "live-no-editor", "The editor has no game running.");
  const store = () => game.getStore().state;
  switch (req.t) {
    case "frame": {
      const png = await opts.render(req);
      if (png.byteLength > LIVE_FRAME_MAX_BYTES) {
        return failure(
          "frame",
          req.id,
          "frame-too-large",
          `The frame is ${png.byteLength} bytes after downscaling, over the ${LIVE_FRAME_MAX_BYTES}-byte cap.`,
        );
      }
      const size = pngSize(png) ?? { width: req.opts.width ?? 0, height: req.opts.height ?? 0 };
      const s = store();
      return {
        t: "frame",
        id: req.id,
        ok: true,
        png: base64(png),
        ...size,
        tick: s.tick,
        mode: s.mode,
      };
    }
    case "play": {
      if (!isPlayAction(req.action)) {
        return failure("play", req.id, "live-refused", `Unknown play action "${req.action}".`);
      }
      const ticks = req.ticks ?? 1;
      if (
        req.action === "step" &&
        (!Number.isInteger(ticks) || ticks < 1 || ticks > LIVE_STEP_MAX_TICKS)
      ) {
        return failure(
          "play",
          req.id,
          "live-refused",
          `step takes a whole number of ticks from 1 to ${LIVE_STEP_MAX_TICKS}: ${String(req.ticks)}.`,
        );
      }
      if (req.action === "play") {
        if (!opts.play) {
          return failure(
            "play",
            req.id,
            "live-refused",
            "This editor can't start Play on request.",
          );
        }
        await opts.play(req);
      } else if (req.action === "pause") game.pause();
      else if (req.action === "resume") game.resume();
      else if (req.action === "step") game.step(ticks);
      else game.stop();
      const s = store();
      return {
        t: "play",
        id: req.id,
        ok: true,
        tick: s.tick,
        phase: s.phase,
        outcome: plainClone(s.session?.outcome ?? null),
      };
    }
    case "state": {
      const select = new Set(req.select ?? ["store"]);
      const out: LiveResponse & { t: "state"; ok: true } = { t: "state", id: req.id, ok: true };
      const s = store();
      if (select.has("store")) {
        out.store = plainClone({
          phase: s.phase,
          tick: s.tick,
          mode: s.mode,
          game: s.game,
          dialogue: s.dialogue,
        });
      }
      if (select.has("entities"))
        out.entities = plainClone(await game.debug.entities(req.entities));
      if (select.has("events")) {
        const all = game.debug.events.list();
        const limit =
          req.limit !== undefined && Number.isInteger(req.limit) && req.limit >= 0
            ? req.limit
            : LIVE_STATE_EVENTS;
        out.events = plainClone(limit < all.length ? all.slice(all.length - limit) : all);
        out.eventsTotal = all.length;
      }
      if (select.has("timings")) out.timings = plainClone(s.timings);
      return out;
    }
  }
}

/**
 * `res` encoded within what the relays pass: a `state` answer over the cap
 * keeps halving its events (the newest stay, `eventsTotal` says how many
 * there were); anything still over is refused, since a relay would drop it
 * and leave the requester waiting.
 */
function encodeAnswer(res: LiveResponse): string {
  let text = JSON.stringify(res);
  if (relayableStateless(text)) return text;
  if (res.t === "state" && res.ok && res.events) {
    let events = res.events;
    while (events.length > 0 && !relayableStateless(text)) {
      events = events.slice(Math.ceil(events.length / 2));
      text = JSON.stringify({ ...res, events });
    }
    if (relayableStateless(text)) return text;
  }
  return JSON.stringify(
    failure(
      res.t,
      res.id,
      "live-refused",
      `The answer is ${liveMessageBytes(text)} bytes, over the ${LIVE_MESSAGE_MAX_BYTES}-byte cap the relays pass: ask for less (fewer entities, or none).`,
    ),
  );
}

export function createLiveResponder(): LiveResponder {
  return {
    attach(provider, opts) {
      const awareness = provider.awareness ?? null;
      let advertised: string | null = null;
      const advertise = (live: boolean) => {
        if (!awareness) return;
        const flags = {
          live,
          drives: live && opts.enabled(),
          hidden: live && opts.visible?.() === false,
        };
        const key = JSON.stringify(flags);
        if (key === advertised) return;
        advertised = key;
        const prev = (awareness.getLocalState()?.[SCENE_FIELD] ?? {}) as Record<string, unknown>;
        awareness.setLocalStateField(SCENE_FIELD, { ...prev, ...flags });
      };
      let detached = false;
      const onStateless = ({ payload }: { payload: string }) => {
        const req = parseLiveRequest(payload);
        if (!req || !electedHere(awareness)) return;
        void answer(req, opts)
          .catch((e: unknown) =>
            failure(req.t, req.id, "live-refused", e instanceof Error ? e.message : String(e)),
          )
          .then((res) => {
            if (!detached) provider.sendStateless(encodeAnswer(res));
          });
      };
      provider.on("stateless", onStateless);
      advertise(true);
      const unwatch = opts.watch?.(() => {
        if (!detached) advertise(true);
      });
      return () => {
        if (detached) return;
        detached = true;
        unwatch?.();
        provider.off("stateless", onStateless);
        advertise(false);
      };
    },
  };
}

/** How long a requester waits by default: longer for a `step`, which runs in the editor's tab. */
function answerWaitMs(req: LiveRequest): number {
  if (req.t !== "play" || req.action !== "step") return LIVE_REQUEST_TIMEOUT_MS;
  const ticks = Number.isFinite(req.ticks) ? (req.ticks ?? 1) : 1;
  return (
    LIVE_REQUEST_TIMEOUT_MS +
    Math.min(Math.max(ticks, 1), LIVE_STEP_MAX_TICKS) * STEP_WAIT_MS_PER_TICK
  );
}

/**
 * Sends `req` and resolves with its answer, or `live-no-editor` after
 * `timeoutMs`, or at once when the provider's awareness shows no responder.
 * The default wait is `LIVE_REQUEST_TIMEOUT_MS`, plus a millisecond per
 * tick a `step` asks for.
 */
export function liveRequest(
  provider: StatelessProvider,
  req: LiveRequest,
  opts?: { timeoutMs?: number },
): Promise<LiveResponse> {
  const noEditor = (message: string) => failure(req.t, req.id, "live-no-editor", message);
  if (provider.awareness && electResponder(livePresence(provider.awareness)) === null) {
    return Promise.resolve(noEditor("No editor with this scene open answers live requests."));
  }
  const timeoutMs = opts?.timeoutMs ?? answerWaitMs(req);
  return new Promise((resolve) => {
    const done = (res: LiveResponse) => {
      clearTimeout(timer);
      provider.off("stateless", onStateless);
      resolve(res);
    };
    const onStateless = ({ payload }: { payload: string }) => {
      const m = parseLiveMessage(payload);
      if (m && m.id === req.id && m.t === req.t && typeof m.ok === "boolean") {
        done(m as unknown as LiveResponse);
      }
    };
    const timer = setTimeout(
      () => done(noEditor(`No editor answered within ${timeoutMs} ms.`)),
      timeoutMs,
    );
    provider.on("stateless", onStateless);
    provider.sendStateless(JSON.stringify(req));
  });
}
