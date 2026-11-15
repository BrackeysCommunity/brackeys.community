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
  /** Read per request: false answers `live-refused`. */
  enabled: () => boolean;
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

/** A presence entry as the election reads it. */
export type LivePresence = { clientId: number; live?: boolean };

const SCENE_FIELD: typeof PRESENCE_FIELD = "scene";

/** Which client answers: the lowest client id among entries advertising `live: true`; null for none. */
export function electResponder(entries: readonly LivePresence[]): number | null {
  let best: number | null = null;
  for (const e of entries) {
    if (e.live === true && (best === null || e.clientId < best)) best = e.clientId;
  }
  return best;
}

/** Every awareness state's `live` flag, this client's own included. */
export function livePresence(awareness: AwarenessLike): LivePresence[] {
  const out: LivePresence[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    const presence = state[SCENE_FIELD] as { live?: unknown } | undefined;
    out.push({ clientId, live: presence?.live === true });
  }
  return out;
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

const isRequestType = (t: string): boolean => t === "frame" || t === "play" || t === "state";
const isPlayAction = (a: string): boolean =>
  a === "play" || a === "pause" || a === "resume" || a === "step" || a === "stop";

type Parsed = { t: string; id: string; ok?: unknown } & Record<string, unknown>;

function parse(payload: string): Parsed | null {
  if (payload.length === 0 || payload[0] !== "{") return null;
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const m = value as Partial<Parsed>;
  if (typeof m.t !== "string" || typeof m.id !== "string" || !isRequestType(m.t)) return null;
  return m as Parsed;
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
      if (select.has("events")) out.events = plainClone(game.debug.events.list());
      if (select.has("timings")) out.timings = plainClone(s.timings);
      return out;
    }
  }
}

export function createLiveResponder(): LiveResponder {
  return {
    attach(provider, opts) {
      const awareness = provider.awareness ?? null;
      const advertise = (live: boolean) => {
        if (!awareness) return;
        const prev = (awareness.getLocalState()?.[SCENE_FIELD] ?? {}) as Record<string, unknown>;
        awareness.setLocalStateField(SCENE_FIELD, { ...prev, live });
      };
      const elected = () =>
        !awareness || electResponder(livePresence(awareness)) === awareness.clientID;
      let detached = false;
      const onStateless = ({ payload }: { payload: string }) => {
        const m = parse(payload);
        if (!m || m.ok !== undefined || !elected()) return;
        const req = m as unknown as LiveRequest;
        void answer(req, opts)
          .catch((e: unknown) =>
            failure(req.t, req.id, "live-refused", e instanceof Error ? e.message : String(e)),
          )
          .then((res) => {
            if (!detached) provider.sendStateless(JSON.stringify(res));
          });
      };
      provider.on("stateless", onStateless);
      advertise(true);
      return () => {
        if (detached) return;
        detached = true;
        provider.off("stateless", onStateless);
        advertise(false);
      };
    },
  };
}

/**
 * Sends `req` and resolves with its answer, or `live-no-editor` after
 * `timeoutMs` (default `LIVE_REQUEST_TIMEOUT_MS`), or at once when the
 * provider's awareness shows no responder.
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
  const timeoutMs = opts?.timeoutMs ?? LIVE_REQUEST_TIMEOUT_MS;
  return new Promise((resolve) => {
    const done = (res: LiveResponse) => {
      clearTimeout(timer);
      provider.off("stateless", onStateless);
      resolve(res);
    };
    const onStateless = ({ payload }: { payload: string }) => {
      const m = parse(payload);
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
