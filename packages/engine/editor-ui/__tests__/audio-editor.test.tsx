// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { fakeAudioBackend, type FakeAudioBackend } from "../../audio/fake";
import {
  createProjectSession,
  layoutFromDoc,
  layoutToDoc,
  memoryDocHost,
  readLog,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  type MemoryDocHost,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { createEditorSession, type EditorSession } from "../../editor/index";
import { createGame } from "../../engine";
import { createRegistry, defineGame } from "../../game/index";
import type { EngineContext, GameDefinition } from "../../game/types";
import {
  createKindRegistry,
  type AssetEntry,
  type AssetKey,
  type DocLayout,
  type ProjectRuntimeView,
} from "../../project/index";
import { soundKind, type SoundFile } from "../../project/kinds/sound";
import { synthKind, type SynthFile } from "../../project/kinds/synth";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import type { GameInstance } from "../../types";
import { EditorAudioProvider, playAudioBackend } from "../audio/editor-audio";
import type { EditorControls } from "../frame/keys";
import { hostStorage, type EditorNotify } from "../host";
import { KitProvider } from "../kit/index";
import { SoundPanel } from "../panels/assets/SoundPanel";
import { EditorInspector } from "../panels/EditorInspector";
import { EditorPlayBar } from "../panels/EditorPlayBar";
import { EditorProject, type EditorProjectLink } from "../panels/EditorProject";
import { AssetPanel } from "../panels/project-tree/asset-panel";
import { createPending } from "../pending/pending";
import { PendingProvider } from "../pending/use-pending";

vi.mock("../../renderer", async () =>
  (await import("../../__tests__/fixtures/frame-clock")).stubRenderer(),
);

const notify: EditorNotify = Object.assign(vi.fn(), {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
});
const registry = createRegistry();
const kinds = createKindRegistry(null);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const PROJECT = "yard";
const SCENE_DOC = `scene:${PROJECT}.klevel`;
const HASH = "c".repeat(64);

const created = { at: 1, by: "seed" };
const entry = (key: string, id: string, kind: string, path: string, extra = {}): AssetEntry => ({
  key,
  id,
  kind,
  path,
  created,
  ...extra,
});

const BOOM = entry("kboom", "boom", "audio", "sfx/boom.wav", {
  sha256: HASH,
  bytes: 64,
  meta: { format: "wav", durationMs: 420, sampleRate: 44_100, channels: 1 },
});
const BLIP = entry("kblip", "blip", "synth", "sfx/blip.synth.json");
const HIT = entry("khit", "hit", "sound", "sfx/hit.sound.json");

const BLIP_PATCH: SynthFile = {
  kind: "synth",
  v: 1,
  wave: "square",
  freq: 440,
  sustainMs: 100,
  decayMs: 50,
};
const HIT_SOUND: SoundFile = {
  kind: "sound",
  v: 1,
  bus: "ui",
  volume: 0.5,
  variants: [{ clip: "boom" }],
};

const scene = (): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "level",
  bounds: [0, 0, 400, 300],
  entities: [{ id: "horn", type: "marker", at: [10, 10], behaviors: { audio: { sound: "hit" } } }],
});

/** The runtime view the provider reads: the clip's info, the patch and the sound. */
const runtime: ProjectRuntimeView = {
  settings: {},
  engine: {},
  table: () => [],
  inputMap: null,
  asset: (id) => (id === "boom" ? { id, kind: "audio", sha256: HASH, bytes: 64 } : undefined),
  doc: <T,>(kind: string, id: string): T | undefined =>
    (kind === "synth" && id === "blip"
      ? BLIP_PATCH
      : kind === "sound" && id === "hit"
        ? HIT_SOUND
        : undefined) as T | undefined,
  docs: () => [],
};

const sessions: ProjectSession[] = [];
const editors: EditorSession[] = [];
const games: GameInstance[] = [];

async function project(): Promise<{ host: MemoryDocHost; session: ProjectSession }> {
  const host = memoryDocHost();
  const assets = [entry("klevel", "level", "scene", "scenes/level.json"), BOOM, BLIP, HIT];
  seedProjectDoc(
    host.doc(`project:${PROJECT}`),
    {
      meta: { projectId: PROJECT, layout: 1, name: "Yard" },
      assets: Object.fromEntries(assets.map((a) => [a.key, a])),
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(scene(), { doc: host.doc(SCENE_DOC), key: sequentialKeys("s") });
  layoutToDoc(host.doc(`asset:${PROJECT}.kblip`), synthKind.layout as DocLayout, BLIP_PATCH);
  layoutToDoc(host.doc(`asset:${PROJECT}.khit`), soundKind.layout as DocLayout, HIT_SOUND);
  const session = await createProjectSession({
    project: PROJECT,
    openDoc: host.client().openDoc,
    origin: ada,
    registry,
    kinds,
  });
  sessions.push(session);
  return { host, session };
}

/** The editor's providers, over a fake backend made on the first play. */
function rig(opts: { fetchClip?: () => Promise<ArrayBuffer>; decodedSeconds?: number } = {}) {
  const backends: FakeAudioBackend[] = [];
  const make = vi.fn(() => {
    const b = fakeAudioBackend(
      opts.decodedSeconds !== undefined ? { decodedSeconds: opts.decodedSeconds } : {},
    );
    backends.push(b);
    return b;
  });
  const fetchClip = vi.fn(opts.fetchClip ?? (() => Promise.resolve(new ArrayBuffer(64))));
  const pending = createPending({ notify });
  let view: () => ReturnType<ProjectSession["view"]> | null = () => null;
  const Wrap = ({ children }: { children: ReactNode }) => (
    <KitProvider host={{ storage: null }}>
      <PendingProvider pending={pending}>
        <EditorAudioProvider
          source={{ runtime: () => runtime, view: () => view(), fetchClip }}
          backend={make}
        >
          {children}
        </EditorAudioProvider>
      </PendingProvider>
    </KitProvider>
  );
  return {
    Wrap,
    make,
    fetchClip,
    backends,
    useView(session: ProjectSession) {
      view = () => session.view();
    },
    plays: () => backends.flatMap((b) => b.log.filter((c) => c.op === "play")),
  };
}

async function tree(r: ReturnType<typeof rig>) {
  const { session } = await project();
  r.useView(session);
  const link: EditorProjectLink = { session, doc: SCENE_DOC };
  render(
    <r.Wrap>
      <EditorProject project={link} selected={new Store<AssetKey | null>(null)} notify={notify} />
    </r.Wrap>,
  );
  const files = within(screen.getByRole("list", { name: "Files" }));
  const row = (file: string) => files.getByText(file).closest("li")!;
  const playOf = (file: string) =>
    within(row(file)).getByRole("button", { name: new RegExp(`^(Play|Stop|Decoding) ${file}`) });
  return { session, row, playOf };
}

const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

beforeAll(() => {
  // jsdom lays nothing out; dnd-kit measures rows.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() =>
    DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 20 }),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  for (const g of games.splice(0)) g.destroy();
  for (const e of editors.splice(0)) e.destroy();
  for (const s of sessions.splice(0)) s.destroy();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the project tree's play buttons", () => {
  it("play a clip, a sound and a patch once each, the backend made on the first click", async () => {
    const r = rig();
    const { playOf } = await tree(r);
    expect(r.make).not.toHaveBeenCalled();

    await click(playOf("boom.wav"));
    await waitFor(() => expect(r.plays()).toHaveLength(1));
    expect(r.make).toHaveBeenCalledTimes(1);
    const backend = r.backends[0]!;
    expect(backend.log.map((c) => c.op)).toEqual(["unlock", "decode", "play"]);
    expect(r.fetchClip).toHaveBeenCalledWith("boom");

    await click(playOf("blip.synth.json"));
    await waitFor(() => expect(r.plays()).toHaveLength(2));
    expect(backend.log.filter((c) => c.op === "buffer")).toHaveLength(1);

    await click(playOf("hit.sound.json"));
    await waitFor(() => expect(r.plays()).toHaveLength(3));
    const hit = r.plays()[2]!;
    expect(hit.op === "play" && hit.opts).toMatchObject({ bus: "ui", volume: 0.5, loop: false });
    // The clip the sound picked was decoded once, for the first play.
    expect(backend.log.filter((c) => c.op === "decode")).toHaveLength(1);
    expect(r.make).toHaveBeenCalledTimes(1);
  });

  it("show Decoding until the fake voice starts, then Stop", async () => {
    let arrive: (bytes: ArrayBuffer) => void = () => {};
    const r = rig({ fetchClip: () => new Promise((done) => (arrive = done)) });
    const { playOf } = await tree(r);
    await click(playOf("boom.wav"));
    const button = playOf("boom.wav");
    expect(button.getAttribute("aria-label")).toBe("Decoding boom.wav");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(r.plays()).toHaveLength(0);
    await act(async () => arrive(new ArrayBuffer(64)));
    await waitFor(() => expect(r.plays()).toHaveLength(1));
    expect(playOf("boom.wav").getAttribute("aria-label")).toBe("Stop boom.wav");
    expect(playOf("boom.wav").getAttribute("aria-busy")).toBeNull();
  });

  it("previews the first second after 400 ms of hover, once a click made the backend", async () => {
    const r = rig({ decodedSeconds: 3 });
    const { playOf, row } = await tree(r);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    // Hovering before any click makes no backend.
    fireEvent.pointerEnter(row("boom.wav"));
    await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
    expect(r.make).not.toHaveBeenCalled();
    fireEvent.pointerLeave(row("boom.wav"));

    await click(playOf("boom.wav"));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(r.plays()).toHaveLength(1);
    await click(playOf("boom.wav"));
    expect(playOf("boom.wav").getAttribute("aria-label")).toBe("Play boom.wav");

    fireEvent.pointerEnter(row("boom.wav"));
    await act(async () => void (await vi.advanceTimersByTimeAsync(399)));
    expect(r.plays()).toHaveLength(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(r.plays()).toHaveLength(2);
    const backend = r.backends[0]!;
    const voice =
      backend.log.at(-1)!.op === "play" ? (backend.log.at(-1) as { voice: number }).voice : -1;

    await act(async () => void (await vi.advanceTimersByTimeAsync(999)));
    expect(backend.log.some((c) => c.op === "stop" && c.voice === voice)).toBe(false);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(backend.log.some((c) => c.op === "stop" && c.voice === voice)).toBe(true);
  });
});

describe("the sound widget", () => {
  it("shows play and stop beside an audio behavior's sound and how long it plays", async () => {
    const r = rig();
    const { session } = await project();
    r.useView(session);
    const { doc } = await session.open(SCENE_DOC);
    const editor = createEditorSession({ doc, origin: ada, name: "level", registry });
    editors.push(editor);
    editor.select(["horn"]);
    render(
      <r.Wrap>
        <EditorInspector session={editor} project={session} />
      </r.Wrap>,
    );
    // The sound plays its one clip, 420 ms long, at its own pitch.
    expect(await screen.findByText("0.42 s")).toBeTruthy();
    await click(screen.getByRole("button", { name: /^Play / }));
    await waitFor(() => expect(r.plays()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Stop / })).toBeTruthy());
    await click(screen.getByRole("button", { name: /^Stop / }));
    expect(r.backends[0]!.log.at(-1)?.op).toBe("stop");
  });
});

describe("the sound panel", () => {
  it("edits a field as one editAsset batch and one undo step", async () => {
    const r = rig();
    const { session } = await project();
    r.useView(session);
    const asset = {
      entry: session.view().byId.get("hit")!,
      readOnly: false,
      onLicence: vi.fn(),
      onClose: vi.fn(),
      notify,
    };
    render(
      <r.Wrap>
        <SoundPanel asset={asset} session={session} registry={registry} />
      </r.Wrap>,
    );
    const volume = await screen.findByRole("textbox", { name: "Volume" });
    await act(async () => {
      fireEvent.change(volume, { target: { value: "0.8" } });
      fireEvent.keyDown(volume, { key: "Enter" });
    });
    const docOf = () => session.get(`asset:${PROJECT}.khit`)!.doc;
    const value = () => layoutFromDoc(docOf(), soundKind.layout as DocLayout) as SoundFile;
    await waitFor(() => expect(value().volume).toBe(0.8));
    expect(readLog(docOf())).toHaveLength(1);
    expect(session.canUndo()).toBe(true);
    act(() => void session.undo());
    await waitFor(() => expect(value().volume).toBe(0.5));
    expect(session.canUndo()).toBe(false);
    // Each variant has its own play button.
    expect(screen.getByRole("button", { name: "Play boom" })).toBeTruthy();
  });
});

describe("Sound in Play", () => {
  const silent: GameDefinition = defineGame({
    id: "silent",
    types: [],
    actions: [],
    world: { physics: "none" },
    time: { kind: "fixed", rate: 60 },
    createRuntime: (_ctx: EngineContext) => ({ snapshot: () => null }),
  }) as GameDefinition;
  const level: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    game: "silent",
    name: "level",
    bounds: [0, 0, 40, 20],
    settings: { physics: "none" },
    entities: [],
  };

  it("builds no backend while off, and one per Play while on, closed on Stop", async () => {
    document.body.appendChild(document.createElement("canvas"));
    const made: FakeAudioBackend[] = [];
    const make = vi.fn(() => {
      const b = fakeAudioBackend({ state: "running" });
      made.push(b);
      return b;
    });
    const storage = hostStorage({});
    const game = await createGame(document.querySelector("canvas")!, {
      game: silent,
      scene: level,
      audio: { backend: playAudioBackend(storage, make) },
    });
    games.push(game);
    game.start();
    game.stop();

    game.setMode("play");
    expect(make).not.toHaveBeenCalled();
    expect(game.audio).toBeNull();

    const controls = {
      game,
      host: new Store({ sceneChanged: false, livePlay: null }),
      keymap: { chordOf: () => undefined },
      onStop: vi.fn(),
      onRestart: vi.fn(),
    } as unknown as EditorControls;
    render(
      <KitProvider host={{}}>
        <EditorPlayBar {...controls} />
      </KitProvider>,
    );
    const toggle = screen.getByRole("switch", { name: "Sound in Play" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await click(toggle);
    // This Play started silent, so the sound waits for the next one.
    expect(screen.getByText("Sound starts at the next Play")).toBeTruthy();
    game.setMode("edit");
    expect(make).not.toHaveBeenCalled();

    game.setMode("play");
    expect(make).toHaveBeenCalledTimes(1);
    expect(game.audio).not.toBeNull();
    game.setMode("edit");
    expect(made[0]!.log.at(-1)?.op).toBe("close");
    expect(game.audio).toBeNull();
  });
});

describe("the asset panels' play row", () => {
  const selected = (session: ProjectSession, id: string) => ({
    entry: session.view().byId.get(id)!,
    readOnly: false,
    onLicence: vi.fn(),
    onClose: vi.fn(),
    notify,
  });

  it("opens an audio clip with its rate and channels, a play button and its length", async () => {
    const r = rig();
    const { session } = await project();
    r.useView(session);
    render(
      <r.Wrap>
        <AssetPanel {...selected(session, "boom")} />
      </r.Wrap>,
    );
    expect(screen.getByText("audio · 64 B · 44.1 kHz · mono")).toBeTruthy();
    const row = document.querySelector(".je-asset-panel > .je-asset-audition")!;
    expect(within(row as HTMLElement).getByText("0.42 s")).toBeTruthy();
    await click(within(row as HTMLElement).getByRole("button", { name: "Play boom.wav" }));
    await waitFor(() => expect(r.plays()).toHaveLength(1));
  });

  it("draws the same row for a sound as for a clip and the inspector's sound field", async () => {
    const r = rig();
    const { session } = await project();
    r.useView(session);
    const editor = createEditorSession({
      doc: (await session.open(SCENE_DOC)).doc,
      origin: ada,
      name: "level",
      registry,
    });
    editors.push(editor);
    editor.select(["horn"]);
    render(
      <r.Wrap>
        <SoundPanel asset={selected(session, "hit")} session={session} registry={registry} />
        <EditorInspector session={editor} project={session} />
      </r.Wrap>,
    );
    const rows = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>(".je-asset-audition")];
      expect(found).toHaveLength(2);
      return found;
    });
    for (const row of rows) {
      expect(within(row).getByText("0.42 s").className).toContain("je-asset-audition-length");
      expect(row.querySelector("[data-audition]")?.getAttribute("data-variant")).toBe("ghost");
    }
  });
});
