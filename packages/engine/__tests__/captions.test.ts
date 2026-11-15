// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { fakeAudioBackend, type FakeAudioBackend } from "../audio/fake";
import { CLICK_PATCH } from "../audio/synth-presets";
import { createAudioSystem, type AudioSystemHandle } from "../audio/system";
import { createRegistry } from "../game/define";
import { memoryRuntimeView } from "../headless/runtime-view";
import { memoryPrefsStore, type PrefsStore } from "../prefs";
import type { SoundFile } from "../project/kinds/sound";
import { DIALOGUE_VOICE_KEY } from "../runtime/behaviors/dialogue";
import type { AudioRequest } from "../runtime/present";
import type { StringTable } from "../text/strings";
import type { GameInstance } from "../types";
import {
  CAPTION_MS_DEFAULT,
  captionsPreference,
  createCaptions,
  type GameCaptions,
} from "../ui/captions";
import type { UiContext, UiHandle } from "../ui/types";

const TICK_MS = 1000 / 60;

const sound = (over: Partial<SoundFile> = {}): SoundFile => ({
  kind: "sound",
  v: 1,
  bus: "sfx",
  variants: [{ clip: "blip" }],
  ...over,
});

const TEXT: Record<string, Record<string, string>> = {
  en: { "caption.hit": "[Thud]", "talk.hello": "Hello, [b]traveller[/b]." },
  ar: { "caption.hit": "[ارتطام]" },
};

function table(locale: string): StringTable {
  const strings = TEXT[locale] ?? {};
  return {
    get: (key) => strings[key] ?? `[${key}]`,
    has: (key) => key in strings,
    locale,
    direction: locale === "ar" ? "rtl" : "ltr",
  };
}

type Handler = (payload: unknown) => void;

type Rig = {
  backend: FakeAudioBackend;
  system: AudioSystemHandle;
  captions: GameCaptions;
  prefs: PrefsStore;
  ui: UiHandle;
  root: HTMLElement;
  setLocale(locale: string): void;
  shown(): string[];
};

let rig: Rig | null = null;

function build(opts: { ms?: number; requested?: boolean; saved?: boolean } = {}): Rig {
  const handlers = new Map<string, Set<Handler>>();
  const emit = (event: string, payload: unknown) => {
    for (const fn of handlers.get(event) ?? []) fn(payload);
  };
  const prefs = memoryPrefsStore();
  if (opts.saved !== undefined) prefs.save("captions-test", { captions: opts.saved });
  const captions = captionsPreference({
    prefs,
    gameId: () => "captions-test",
    changed: (enabled) => emit("captions:change", { enabled }),
    ...(opts.requested !== undefined ? { requested: () => opts.requested === true } : {}),
  });
  let locale = "en";
  const game = {
    on: (event: string, fn: Handler) => {
      let set = handlers.get(event);
      if (!set) handlers.set(event, (set = new Set()));
      set.add(fn);
    },
    off: (event: string, fn: Handler) => void handlers.get(event)?.delete(fn),
    captions,
    project: () => null,
  } as unknown as GameInstance;

  const canvas = document.createElement("canvas");
  const root = document.createElement("div");
  document.body.append(canvas, root);
  const ctx = {
    root,
    canvas,
    game,
    slice: () => null,
    watch: () => () => {},
    settings: {},
    reducedMotion: false,
    assetUrl: () => null,
    strings: () => table(locale),
  } as UiContext;
  const ui = createCaptions(ctx, opts.ms !== undefined ? { ms: opts.ms } : {});

  const backend = fakeAudioBackend({ state: "running" });
  const system = createAudioSystem({
    backend,
    project: memoryRuntimeView({
      docs: {
        sound: {
          hit: sound({ caption: "caption.hit" }),
          quiet: sound(),
          "vo-hello": sound({ bus: "voice" }),
        },
        synth: { blip: CLICK_PATCH },
      },
    }),
    registry: createRegistry(null),
    fetchClip: async () => new ArrayBuffer(8),
    clipUrl: (id) => `/clips/${id}`,
    poses: { get: () => undefined },
    prefs,
    gameId: "captions-test",
    tickMs: TICK_MS,
    reducedMotion: () => false,
    emit: (event, payload) => emit(event, payload),
  });

  rig = {
    backend,
    system,
    captions,
    prefs,
    ui,
    root,
    setLocale(next) {
      const from = locale;
      locale = next;
      emit("locale:change", { from, to: next });
    },
    shown: () =>
      [...root.querySelectorAll("[data-jams-caption]")].map((el) => el.textContent ?? ""),
  };
  return rig;
}

const play = (sound: string, extra: Partial<Extract<AudioRequest, { op: "play" }>> = {}) =>
  ({ op: "play", sound, ...extra }) as AudioRequest;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  rig?.ui.destroy();
  rig?.system.destroy();
  rig = null;
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("createCaptions", () => {
  it("shows a sound's caption in a polite live region and takes it down after ms", () => {
    const r = build({ saved: true });
    const region = r.root.querySelector<HTMLElement>("[data-jams-captions]");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.style.pointerEvents).toBe("none");

    r.system.tick(1, [], [play("hit"), play("quiet")]);
    expect(r.shown()).toEqual(["[Thud]"]);

    vi.advanceTimersByTime(CAPTION_MS_DEFAULT - 1);
    expect(r.shown()).toEqual(["[Thud]"]);
    vi.advanceTimersByTime(1);
    expect(r.shown()).toEqual([]);
    expect(r.root.querySelector("[data-jams-captions]")).not.toBeNull();
  });

  it("keeps each caption for the given ms, restarting a key that plays again", () => {
    const r = build({ saved: true, ms: 1000 });
    r.system.tick(1, [], [play("hit")]);
    vi.advanceTimersByTime(600);
    r.system.tick(2, [], [play("hit")]);
    expect(r.shown()).toEqual(["[Thud]"]);
    vi.advanceTimersByTime(600);
    expect(r.shown()).toEqual(["[Thud]"]);
    vi.advanceTimersByTime(400);
    expect(r.shown()).toEqual([]);
  });

  it("shows a voiced dialogue line's text, its markup removed", () => {
    const r = build({ saved: true });
    r.system.tick(1, [], [play("vo-hello", { key: DIALOGUE_VOICE_KEY, caption: "talk.hello" })]);
    expect(r.shown()).toEqual(["Hello, traveller."]);
  });

  it("raises audio:caption with the key and the audio clock's time, only when the voice starts", () => {
    const events: unknown[] = [];
    const backend = fakeAudioBackend();
    const system = createAudioSystem({
      backend,
      project: memoryRuntimeView({
        docs: { sound: { hit: sound({ caption: "caption.hit" }) }, synth: { blip: CLICK_PATCH } },
      }),
      registry: createRegistry(null),
      fetchClip: async () => new ArrayBuffer(8),
      clipUrl: (id) => `/clips/${id}`,
      poses: { get: () => undefined },
      prefs: memoryPrefsStore(),
      gameId: "captions-test",
      tickMs: TICK_MS,
      reducedMotion: () => false,
      emit: (event, payload) => void events.push([event, payload]),
    });
    system.tick(1, [], [play("hit")]);
    expect(events).toEqual([]);
    void backend.unlock();
    backend.advance(2);
    system.tick(2, [], [play("hit"), play("hit", { caption: "talk.hello" })]);
    expect(events).toEqual([
      ["audio:unlocked", undefined],
      ["audio:caption", { key: "caption.hit", at: 2 }],
      ["audio:caption", { key: "talk.hello", at: 2 }],
    ]);
    system.destroy();
  });

  it("shows nothing while the preference is off, and clears when it turns off", () => {
    const r = build({ saved: false });
    r.system.tick(1, [], [play("hit")]);
    expect(r.shown()).toEqual([]);

    r.captions.set(true);
    r.system.tick(2, [], [play("hit")]);
    expect(r.shown()).toEqual(["[Thud]"]);
    r.captions.set(false);
    expect(r.shown()).toEqual([]);
    expect(r.prefs.load("captions-test").captions).toBe(false);
  });

  it("follows the locale's text and direction", () => {
    const r = build({ saved: true });
    r.system.tick(1, [], [play("hit")]);
    r.setLocale("ar");
    const el = r.root.querySelector<HTMLElement>("[data-jams-caption]");
    expect(el?.textContent).toBe("[ارتطام]");
    expect(el?.dir).toBe("rtl");
  });

  it("removes its region and stops listening on destroy", () => {
    const r = build({ saved: true });
    r.system.tick(1, [], [play("hit")]);
    r.ui.destroy();
    expect(r.root.querySelector("[data-jams-captions]")).toBeNull();
    r.system.tick(2, [], [play("hit")]);
    expect(r.root.childElementCount).toBe(0);
  });
});

describe("captionsPreference", () => {
  it("is off by default, on where the OS asks, and a saved choice wins", () => {
    expect(build().captions.enabled()).toBe(false);
    rig?.ui.destroy();
    expect(build({ requested: true }).captions.enabled()).toBe(true);
    rig?.ui.destroy();
    const r = build({ requested: true, saved: false });
    expect(r.captions.enabled()).toBe(false);
  });

  it("raises a change only when the choice changes", () => {
    const changed: boolean[] = [];
    const prefs = memoryPrefsStore();
    const pref = captionsPreference({
      prefs,
      gameId: () => "g",
      changed: (on) => void changed.push(on),
    });
    pref.set(false);
    pref.set(true);
    pref.set(true);
    expect(changed).toEqual([true]);
    expect(prefs.load("g")).toEqual({ captions: true });
  });
});
