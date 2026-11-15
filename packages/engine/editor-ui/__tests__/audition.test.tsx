// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { fakeAudioBackend, type FakeAudioBackend } from "../../audio/fake";
import type { ProjectRuntimeView } from "../../project/index";
import type { SoundFile } from "../../project/kinds/sound";
import {
  AuditionButton,
  EditorAudioProvider,
  HOVER_PREVIEW_DELAY_MS,
  isAudibleKind,
  useEditorAudio,
  useHoverPreview,
  type EditorAudio,
} from "../audio/editor-audio";
import { KitProvider } from "../kit/index";

const HASH = "c".repeat(64);
const sound = (variants: SoundFile["variants"]): SoundFile => ({
  kind: "sound",
  v: 1,
  bus: "sfx",
  variants,
});
const SOUNDS: Record<string, SoundFile> = {
  hit: sound([{ clip: "boom" }]),
  ghost: sound([{ clip: "gone" }, { clip: "lost", weight: 3 }]),
  mixed: sound([{ clip: "gone", weight: 1000 }, { clip: "boom" }]),
  empty: sound([]),
};

const runtime: ProjectRuntimeView = {
  settings: {},
  engine: {},
  table: () => [],
  inputMap: null,
  asset: (id) => (id === "boom" ? { id, kind: "audio", sha256: HASH, bytes: 64 } : undefined),
  doc: <T,>(kind: string, id: string): T | undefined =>
    (kind === "sound" ? SOUNDS[id] : undefined) as T | undefined,
  docs: () => [],
};

/** A row as the project tree draws one: hover previews it, its play button sits inside. */
function Row({ id }: { id: string }) {
  const preview = useHoverPreview(id);
  return (
    <li data-testid={`row-${id}`} {...preview}>
      <span>{id}</span>
      <AuditionButton id={id} name={id} />
    </li>
  );
}

function rig(ids: readonly string[]) {
  const backends: FakeAudioBackend[] = [];
  const make = vi.fn(() => {
    const b = fakeAudioBackend({ decodedSeconds: 5 });
    backends.push(b);
    return b;
  });
  const audio: { current: EditorAudio | null } = { current: null };
  const Grab = () => {
    const found = useEditorAudio();
    useEffect(() => {
      audio.current = found;
    });
    return null;
  };
  render(
    <KitProvider host={{ storage: null }}>
      <EditorAudioProvider
        source={{
          runtime: () => runtime,
          view: () => null,
          fetchClip: () => Promise.resolve(new ArrayBuffer(64)),
        }}
        backend={make}
      >
        <Grab />
        <ul>
          {ids.map((id) => (
            <Row key={id} id={id} />
          ))}
        </ul>
      </EditorAudioProvider>
    </KitProvider>,
  );
  const button = (id: string) =>
    screen.getByRole("button", { name: new RegExp(`^(Play|Stop|Decoding) ${id}$`) });
  const plays = () => backends.flatMap((b) => b.log.filter((c) => c.op === "play"));
  const stops = () => backends.flatMap((b) => b.log.filter((c) => c.op === "stop"));
  return { button, plays, stops, make, audio: () => audio.current! };
}

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("isAudibleKind", () => {
  it("is true for clips, sounds and patches only", () => {
    expect(["audio", "sound", "synth"].every(isAudibleKind)).toBe(true);
    expect(["texture", "strings", "dialogue", "scene"].some(isAudibleKind)).toBe(false);
  });
});

describe("a hover preview and the play button", () => {
  it("leaves the button on Play while it previews, and a click plays the clip in full", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const r = rig(["boom"]);
    // A first click makes the backend; a second stops it.
    fireEvent.click(r.button("boom"));
    await flush();
    fireEvent.click(r.button("boom"));
    expect(r.button("boom").getAttribute("aria-label")).toBe("Play boom");

    fireEvent.pointerEnter(screen.getByTestId("row-boom"), { pointerType: "mouse" });
    await act(async () => void (await vi.advanceTimersByTimeAsync(HOVER_PREVIEW_DELAY_MS)));
    await flush();
    expect(r.plays()).toHaveLength(2);
    expect(r.audio().statuses.state.statuses.get("boom")).toBe("previewing");
    expect(r.button("boom").getAttribute("aria-label")).toBe("Play boom");

    const preview = r.plays().at(-1)!;
    fireEvent.click(r.button("boom"));
    await flush();
    expect(r.plays()).toHaveLength(3);
    expect(r.stops().some((s) => "voice" in preview && s.voice === preview.voice)).toBe(true);
    expect(r.button("boom").getAttribute("aria-label")).toBe("Stop boom");

    // Past the preview's second, and off the row, the full clip keeps playing.
    fireEvent.pointerLeave(screen.getByTestId("row-boom"));
    await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
    const full = r.plays().at(-1)!;
    expect(r.stops().some((s) => "voice" in full && s.voice === full.voice)).toBe(false);
    expect(r.button("boom").getAttribute("aria-label")).toBe("Stop boom");
  });

  it("previews nothing while the pointer rests on the play button", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const r = rig(["boom"]);
    fireEvent.click(r.button("boom"));
    await flush();
    fireEvent.click(r.button("boom"));

    const row = screen.getByTestId("row-boom");
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    // From the row's name onto its button, as the pointer moves along the row.
    fireEvent.pointerOver(r.button("boom"), {
      pointerType: "mouse",
      relatedTarget: within(row).getByText("boom"),
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(HOVER_PREVIEW_DELAY_MS * 2)));
    expect(r.plays()).toHaveLength(1);
  });
});

describe("a sound whose variants aren't in the project", () => {
  it("disables its play button with the reason", () => {
    const r = rig(["ghost", "empty", "hit"]);
    const ghost = r.button("ghost");
    expect(ghost.hasAttribute("disabled") || ghost.getAttribute("aria-disabled") === "true").toBe(
      true,
    );
    expect(r.audio().silentReason("ghost")).toBe("Its clips aren't in the project");
    expect(r.audio().silentReason("empty")).toBe("This sound has no variants yet");
    expect(r.audio().silentReason("hit")).toBeNull();
    expect(r.audio().silentReason("mixed")).toBeNull();
  });

  it("plays a variant that is there when another one dangles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const r = rig(["mixed"]);
    for (let i = 0; i < 4; i++) {
      await act(async () => void (await r.audio().play("mixed")));
      await flush();
    }
    expect(r.plays()).toHaveLength(4);
  });
});
