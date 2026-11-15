// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { AUDIO_KIND } from "../../project/kinds/audio";
import { SOUND_KIND, soundKind, type SoundFile } from "../../project/kinds/sound";
import { SYNTH_DEFAULTS } from "../../project/kinds/synth";
import { EditorAudioProvider } from "../audio/editor-audio";
import type { EditorStorage } from "../host";
import { KitProvider } from "../kit/index";
import { SoundPanel } from "../panels/assets/SoundPanel";
import {
  SYNTH_AUDITION_DELAY_MS,
  SYNTH_SPEAKER_KEY,
  SynthPanel,
  waveformPath,
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

/** A key on the named knob, and the write it makes. */
async function press(panel: Panel, name: string, key: string) {
  await act(async () => {
    fireEvent.keyDown(panel.getByRole("slider", { name }), { key });
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Types `text` into the named knob's value, as Enter on it opens. */
async function typeInto(panel: Panel, name: string, text: string) {
  await act(async () => {
    fireEvent.keyDown(panel.getByRole("slider", { name }), { key: "Enter" });
  });
  const input = panel.getByRole("textbox", { name: `${name} value` });
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
  it("lays the patch out as a synth's modules, a knob per field with the schema's bounds", async () => {
    const panel = mount(await open());
    await settle();
    const rack = panel.getByRole("group", { name: "Synth controls" });
    const modules = [...rack.querySelectorAll("section")].map((m) => m.getAttribute("aria-label"));
    expect(modules).toEqual([
      "Osc 1",
      "Osc 2",
      "Osc 3",
      "Mixer",
      "Filter",
      "Filter envelope",
      "Amp envelope",
      "Pitch",
      "Jump",
      "LFO",
      "Vibrato",
      "Low-pass 12",
      "High-pass",
    ]);
    const freq = panel.getByRole("slider", { name: "Osc 1 freq" });
    expect([freq.getAttribute("aria-valuemin"), freq.getAttribute("aria-valuemax")]).toEqual([
      "20",
      "8000",
    ]);
    // 440 Hz is where a reset puts it, so it reads as the default.
    expect(freq.getAttribute("aria-valuetext")).toBe("440 Hz, default");
    for (const block of ["Osc 2", "Osc 3", "Filter", "Filter envelope", "LFO", "Jump", "Vibrato"])
      expect(panel.getByRole("switch", { name: `${block} on` })).toBeTruthy();
    expect(panel.getByRole("slider", { name: "Osc 1 wave" }).getAttribute("aria-valuetext")).toBe(
      "Square",
    );
    // An unset duty or volume shows the renderer's default, marked as one.
    expect(panel.getByRole("slider", { name: "Osc 1 width" }).getAttribute("aria-valuetext")).toBe(
      `${SYNTH_DEFAULTS.duty}, default`,
    );
    expect(
      panel.getByRole("slider", { name: "Amp envelope volume" }).getAttribute("aria-valuenow"),
    ).toBe(String(SYNTH_DEFAULTS.volume));
    // A switched-off module's knobs show what switching it on sets, and take no turns.
    const cutoff = panel.getByRole("slider", { name: "Filter cutoff" });
    expect(cutoff.getAttribute("aria-disabled")).toBe("true");
    expect(cutoff.getAttribute("aria-valuenow")).toBe("2000");
  });

  it("a knob writes the field, a module's switch adds its block, each one undo step", async () => {
    const session = await open();
    const panel = mount(session);
    await settle();
    await press(panel, "Amp envelope punch", "End");
    expect(patchOf(session).punch).toBe(1);
    await act(async () => {
      fireEvent.click(panel.getByRole("switch", { name: "Vibrato on" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(patchOf(session).vibrato).toEqual({ semitones: 0.5, hz: 6 });
    await press(panel, "Vibrato rate", "ArrowUp");
    expect(patchOf(session).vibrato).toEqual({ semitones: 0.5, hz: 6.1 });
    await act(async () => {
      fireEvent.click(panel.getByRole("switch", { name: "Filter on" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await press(panel, "Filter emphasis", "End");
    expect(patchOf(session).filter).toEqual({ cutoff: 2_000, resonance: 1 });
    expect(parseAssetDoc(synthKind, patchOf(session), { registry, project: null }).ok).toBe(true);
    expect(readLog(session.get(DOC)!.doc)).toHaveLength(5);
    act(() => void session.undo());
    expect(patchOf(session).filter).toEqual({ cutoff: 2_000, resonance: 0.3 });
  });

  it("a drag previews the waveform and writes once, on release", async () => {
    const session = await open();
    const panel = mount(session);
    await settle();
    const wave = panel.getByRole("img", { name: "Waveform" });
    const gate = panel.getByRole("slider", { name: "Amp envelope gate" });
    await act(async () => {
      fireEvent.pointerDown(gate, { clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerMove(window, { clientY: 280, pointerId: 1 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(Number(wave.getAttribute("data-samples"))).toBeGreaterThan(renderSynth(PATCH).length);
    expect(patchOf(session).sustainMs).toBe(PATCH.sustainMs);
    await act(async () => {
      fireEvent.pointerMove(window, { clientY: 260, pointerId: 1 });
      fireEvent.pointerUp(window, { clientY: 260, pointerId: 1 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(patchOf(session).sustainMs).toBe(460);
    expect(readLog(session.get(DOC)!.doc)).toHaveLength(1);
    expect(wave.getAttribute("data-samples")).toBe(
      String(renderSynth({ ...PATCH, sustainMs: 460 }).length),
    );
  });

  it("double-click unsets an optional field and puts a required one back to its start", async () => {
    const session = await open();
    const panel = mount(session);
    await settle();
    await press(panel, "Amp envelope punch", "End");
    await typeInto(panel, "Osc 1 freq", "1000");
    expect(patchOf(session)).toMatchObject({ punch: 1, freq: 1_000 });
    for (const name of ["Amp envelope punch", "Osc 1 freq"])
      await act(async () => {
        fireEvent.doubleClick(panel.getByRole("slider", { name }));
        await vi.advanceTimersByTimeAsync(0);
      });
    expect(patchOf(session).punch).toBeUndefined();
    expect(patchOf(session).freq).toBe(440);
  });

  it("turns a wave knob through the waves, and rolls the noise seed from the mixer", async () => {
    const session = await open();
    const panel = mount(session);
    await settle();
    await press(panel, "Osc 1 wave", "ArrowUp");
    expect(patchOf(session).wave).toBe("saw");
    await act(async () => {
      fireEvent.click(panel.getByRole("button", { name: "New noise" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(patchOf(session).seed).toBeGreaterThanOrEqual(1);
    expect(parseAssetDoc(synthKind, patchOf(session), { registry, project: null }).ok).toBe(true);
  });

  it("a preset button writes a valid patch as one undo step and auditions it once", async () => {
    const session = await open();
    const panel = mount(session);
    await settle();
    await act(async () => {
      fireEvent.click(panel.getByRole("button", { name: "Pickup" }));
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

    await typeInto(panel, "Osc 1 freq", "600");
    expect(patchOf(session).freq).toBe(600);
    await advance(SYNTH_AUDITION_DELAY_MS - 1);
    expect(plays()).toHaveLength(0);
    await advance(1);
    expect(made).toBe(1);
    expect(plays()).toHaveLength(1);
    expect(backend.log.find((c) => c.op === "buffer")).toMatchObject({
      length: renderSynth({ ...PATCH, freq: 600 }).length,
    });

    await typeInto(panel, "Osc 1 freq", "700");
    await typeInto(panel, "Osc 1 freq", "800");
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
    await typeInto(panel, "Amp envelope release", "300");
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

  it("follows the speaker choice another tab makes", async () => {
    const panel = mount(await open());
    await settle();
    const speaker = panel.getByRole("button", { name: "Hear changes" });
    expect(speaker.getAttribute("aria-pressed")).toBe("true");
    stored.set(SYNTH_SPEAKER_KEY, "false");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: SYNTH_SPEAKER_KEY }));
    });
    expect(speaker.getAttribute("aria-pressed")).toBe("false");
    stored.set(SYNTH_SPEAKER_KEY, "true");
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(speaker.getAttribute("aria-pressed")).toBe("true");
  });

  it("labels the presets in sentence case and puts Mutate at the end of their heading", async () => {
    const panel = mount(await open());
    await settle();
    const presets = panel.getByRole("region", { name: "Presets" });
    const labels = [...presets.querySelectorAll("[data-preset]")].map((b) => b.textContent);
    expect(labels).toContain("Power-up");
    expect(labels).toContain("Pickup");
    const head = presets.querySelector(".je-insp-section-head")!;
    expect(head.lastElementChild?.textContent).toBe("Mutate");
    expect(head.querySelector(".je-insp-section-title")).not.toBeNull();
  });

  it("redraws the waveform from the new render, in the text colour", async () => {
    const session = await open();
    const panel = mount(session);
    await settle();
    const wave = panel.getByRole("img", { name: "Waveform" });
    expect(wave.getAttribute("data-samples")).toBe(String(renderSynth(PATCH).length));
    const path = () => wave.querySelector("path")!;
    expect(path().getAttribute("fill")).toBe("currentColor");
    const before = path().getAttribute("d");
    expect(before).toBe(waveformPath(renderSynth(PATCH)));
    await typeInto(panel, "Amp envelope gate", "900");
    const next = { ...PATCH, sustainMs: 900 };
    expect(wave.getAttribute("data-samples")).toBe(String(renderSynth(next).length));
    expect(path().getAttribute("d")).toBe(waveformPath(renderSynth(next)));
    expect(path().getAttribute("d")).not.toBe(before);
  });
});

describe("the sound panel's variant picker", () => {
  const CLIP: AssetEntry = {
    key: "kboom",
    id: "boom",
    kind: AUDIO_KIND,
    path: "boom.wav",
    created: { at: 0, by: "seed" },
    sha256: "c".repeat(64),
    bytes: 64,
    meta: { format: "wav", durationMs: 420, sampleRate: 44_100, channels: 1 },
  };
  const SOUND: AssetEntry = {
    key: "khit",
    id: "hit",
    kind: SOUND_KIND,
    path: "hit.sound.json",
    created: { at: 0, by: "seed" },
  };
  const SOUND_DOC = `asset:${PROJECT}.khit`;
  const SOUND_LAYOUT = soundKind.layout as DocLayout;
  const soundOf = (session: ProjectSession) =>
    layoutFromDoc(session.get(SOUND_DOC)!.doc, SOUND_LAYOUT) as unknown as SoundFile;

  it("lists a patch beside the clips, and adds the picked one as one undo step", async () => {
    vi.useRealTimers();
    const host = memoryDocHost();
    seedProjectDoc(
      host.doc(`project:${PROJECT}`),
      {
        meta: { projectId: PROJECT, layout: 1, name: "Yard" },
        assets: { [ENTRY.key]: ENTRY, [CLIP.key]: CLIP, [SOUND.key]: SOUND },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    layoutToDoc(host.doc(DOC), LAYOUT, PATCH);
    layoutToDoc(host.doc(SOUND_DOC), SOUND_LAYOUT, {
      kind: SOUND_KIND,
      v: 1,
      bus: "sfx",
      variants: [],
    } satisfies SoundFile);
    const session = await createProjectSession({
      project: PROJECT,
      openDoc: host.client().openDoc,
      origin: ada,
      registry,
      kinds,
    });
    sessions.push(session);
    const view = render(
      <KitProvider host={{ storage: null }}>
        <SoundPanel
          asset={{ entry: SOUND, onClose: () => {}, notify }}
          session={session}
          registry={registry}
        />
      </KitProvider>,
    );
    const add = await waitFor(() =>
      within(view.container).getByRole("combobox", { name: "variants.add" }),
    );
    const row = add.closest(".je-insp-field") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Show options" }));
    const options = await waitFor(() => {
      const found = screen.getAllByRole("option");
      expect(found).toHaveLength(2);
      return found;
    });
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("boom.wav"),
      expect.stringContaining("zap.json"),
    ]);
    const patch = options.find((o) => o.textContent?.includes(SYNTH_KIND))!;
    await act(async () => {
      fireEvent.mouseMove(patch);
      fireEvent.click(patch);
    });
    await waitFor(() => expect(soundOf(session).variants).toEqual([{ clip: ENTRY.id }]));
    expect(readLog(session.get(SOUND_DOC)!.doc)).toHaveLength(1);
    act(() => void session.undo());
    await waitFor(() => expect(soundOf(session).variants).toEqual([]));
  });
});
