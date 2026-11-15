// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { fakeAudioBackend, type FakeAudioBackend } from "../../audio/fake";
import { renderSynth } from "../../audio/synth";
import {
  createProjectSession,
  layoutFromDoc,
  layoutToDoc,
  memoryDocHost,
  readLog,
  seedProjectDoc,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { createRegistry, defineGame } from "../../game/index";
import {
  createKindRegistry,
  parseAssetDoc,
  SYNTH_KIND,
  synthKind,
  type AssetEntry,
  type DocLayout,
  type SynthFile,
} from "../../project/index";
import { EditorAudioProvider } from "../audio/editor-audio";
import type { EditorStorage } from "../host";
import { KitProvider } from "../kit/index";
import {
  SYNTH_AUDITION_DELAY_MS,
  SYNTH_SPEAKER_KEY,
  SynthPanel,
} from "../panels/assets/SynthPanel";

const game = defineGame({
  id: "yard",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);
const kinds = createKindRegistry(game);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const PROJECT = "yard";
const LAYOUT = synthKind.layout as DocLayout;

const PATCH: SynthFile = {
  kind: SYNTH_KIND,
  v: 1,
  wave: "square",
  freq: 440,
  sustainMs: 60,
  decayMs: 120,
};
const ENTRY: AssetEntry = {
  key: "kzap",
  id: "zap",
  kind: SYNTH_KIND,
  path: "zap.json",
  created: { at: 0, by: "seed" },
};
const DOC = `asset:${PROJECT}.kzap`;

const sessions: ProjectSession[] = [];
let backend: FakeAudioBackend;
let made: number;
let stored: Map<string, string>;

async function open() {
  const host = memoryDocHost();
  seedProjectDoc(
    host.doc(`project:${PROJECT}`),
    {
      meta: { projectId: PROJECT, layout: 1, name: "Yard" },
      assets: { [ENTRY.key]: ENTRY },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  layoutToDoc(host.doc(DOC), LAYOUT, PATCH);
  const session = await createProjectSession({
    project: PROJECT,
    openDoc: host.client().openDoc,
    origin: ada,
    registry,
    kinds,
  });
  sessions.push(session);
  return session;
}

const notify = { error: vi.fn() };

function mount(session: ProjectSession) {
  const storage: EditorStorage = {
    get: (key) => stored.get(key) ?? null,
    set: (key, value) => void stored.set(key, value),
  };
  const view = render(
    <KitProvider host={{ storage }}>
      <EditorAudioProvider
        source={{ runtime: () => null, view: () => null, fetchClip: () => Promise.reject() }}
        backend={() => {
          made++;
          return backend;
        }}
      >
        <SynthPanel
          asset={{ entry: ENTRY, onClose: () => {}, notify }}
          session={session}
          registry={registry}
        />
      </EditorAudioProvider>
    </KitProvider>,
  );
  return within(view.container);
}

type Panel = ReturnType<typeof mount>;

const patchOf = (session: ProjectSession) =>
  layoutFromDoc(session.get(DOC)!.doc, LAYOUT) as unknown as SynthFile;
const plays = () => backend.log.filter((c) => c.op === "play");

/** Lets the doc open and the panel draw its fields. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function typeInto(panel: Panel, name: string, text: string) {
  const input = panel.getByRole("textbox", { name });
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no 2D canvas.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  backend = fakeAudioBackend({ state: "running" });
  made = 0;
  stored = new Map();
});

afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the synth patch panel", () => {
  it("draws every field of the patch with the schema's bounds", async () => {
    const panel = mount(await open());
    await settle();
    const freq = panel.getByRole("slider", { name: "freq slider" });
    expect([freq.getAttribute("min"), freq.getAttribute("max")]).toEqual(["20", "8000"]);
    for (const name of ["sustainMs", "decayMs", "attackMs", "punch", "volume", "duty", "seed"])
      expect(panel.getByRole("textbox", { name })).toBeTruthy();
    for (const block of ["jump", "vibrato", "lowpass", "highpass"])
      expect(panel.getByRole("switch", { name: `${block} on` })).toBeTruthy();
    expect(panel.getByRole("combobox", { name: "wave" })).toBeTruthy();
  });

  it("a slider writes the field on release, and a block's switch adds it", async () => {
    const session = await open();
    const panel = mount(session);
    await settle();
    await act(async () => {
      fireEvent.keyDown(panel.getByRole("slider", { name: "punch slider" }), { key: "End" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(patchOf(session).punch).toBe(1);
    await act(async () => {
      fireEvent.click(panel.getByRole("switch", { name: "vibrato on" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(patchOf(session).vibrato).toEqual({ semitones: 0.5, hz: 6 });
    expect(panel.getByRole("textbox", { name: "vibrato.hz" })).toBeTruthy();
    expect(readLog(session.get(DOC)!.doc)).toHaveLength(2);
  });

  it("a preset button writes a valid patch as one undo step and auditions it once", async () => {
    const session = await open();
    const panel = mount(session);
    await settle();
    await act(async () => {
      fireEvent.click(panel.getByRole("button", { name: "pickup" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    const next = patchOf(session);
    expect(next).not.toEqual(PATCH);
    expect(parseAssetDoc(synthKind, next, { registry, project: null }).ok).toBe(true);
    expect(readLog(session.get(DOC)!.doc)).toHaveLength(1);
    expect(made).toBe(1);
    await advance(SYNTH_AUDITION_DELAY_MS * 4);
    expect(plays()).toHaveLength(1);
    expect(backend.log.filter((c) => c.op === "buffer")).toEqual([
      expect.objectContaining({ length: renderSynth(next).length, channels: 1 }),
    ]);
    act(() => void session.undo());
    expect(patchOf(session)).toEqual(PATCH);
    expect(session.canUndo()).toBe(false);
  });

  it("a field change auditions 150 ms later; nothing sounds before a gesture in the panel", async () => {
    const session = await open();
    const panel = mount(session);
    await settle();
    await advance(SYNTH_AUDITION_DELAY_MS * 2);
    expect(made).toBe(0);

    await typeInto(panel, "freq", "600");
    expect(patchOf(session).freq).toBe(600);
    await advance(SYNTH_AUDITION_DELAY_MS - 1);
    expect(plays()).toHaveLength(0);
    await advance(1);
    expect(made).toBe(1);
    expect(plays()).toHaveLength(1);
    expect(backend.log.find((c) => c.op === "buffer")).toMatchObject({
      length: renderSynth({ ...PATCH, freq: 600 }).length,
    });

    await typeInto(panel, "freq", "700");
    await typeInto(panel, "freq", "800");
    await advance(SYNTH_AUDITION_DELAY_MS);
    expect(plays()).toHaveLength(2);
  });

  it("stays silent with the speaker off, kept per viewer", async () => {
    const session = await open();
    const panel = mount(session);
    await settle();
    const speaker = panel.getByRole("button", { name: "Hear changes" });
    expect(speaker.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(speaker);
    expect(speaker.getAttribute("aria-pressed")).toBe("false");
    expect(stored.get(SYNTH_SPEAKER_KEY)).toBe("false");
    await typeInto(panel, "decayMs", "300");
    await act(async () => {
      fireEvent.click(panel.getByRole("button", { name: "Mutate" }));
      await vi.advanceTimersByTimeAsync(SYNTH_AUDITION_DELAY_MS * 4);
    });
    expect(patchOf(session).decayMs).not.toBe(PATCH.decayMs);
    expect(plays()).toHaveLength(0);

    cleanup();
    const again = mount(session);
    await settle();
    expect(again.getByRole("button", { name: "Hear changes" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("redraws the waveform from the new render", async () => {
    const rects: number[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          clearRect: () => rects.splice(0),
          fillRect: (_x: number, _y: number, _w: number, h: number) => void rects.push(h),
          fillStyle: "",
        }) as never,
    );
    const session = await open();
    const panel = mount(session);
    await settle();
    const wave = panel.getByRole("img", { name: "Waveform" });
    expect(wave.getAttribute("data-samples")).toBe(String(renderSynth(PATCH).length));
    const before = [...rects];
    expect(before.length).toBeGreaterThan(0);
    await typeInto(panel, "sustainMs", "900");
    const next = { ...PATCH, sustainMs: 900 };
    expect(wave.getAttribute("data-samples")).toBe(String(renderSynth(next).length));
    expect(rects).not.toEqual(before);
  });
});
