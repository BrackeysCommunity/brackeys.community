// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectSession,
  layoutToDoc,
  memoryDocHost,
  seedProjectDoc,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { createRegistry } from "../../game/index";
import { createKindRegistry, type AssetEntry, type DocLayout } from "../../project/index";
import { SOUND_EVENT_PATTERN, soundKind, type SoundFile } from "../../project/kinds/sound";
import { KitProvider } from "../kit/index";
import { SoundPanel, variantNames } from "../panels/assets/SoundPanel";
import type { AssetOption } from "../panels/inspector/asset-picker";

const registry = createRegistry();
const kinds = createKindRegistry(null);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const PROJECT = "yard";
const entry = (key: string, id: string, kind: string, path: string): AssetEntry => ({
  key,
  id,
  kind,
  path,
  created: { at: 1, by: "seed" },
});

const HIT = entry("khit", "hit", "sound", "sfx/hit.sound.json");
const CLIPS = [
  entry("kwav", "clink-wav", "audio", "audio/clink.wav"),
  entry("ksyn", "clink-synth", "synth", "audio/clink.synth.json"),
  entry("kthud", "thud", "audio", "audio/thud.wav"),
];

const sound = (over: Partial<SoundFile> = {}): SoundFile => ({
  kind: "sound",
  v: 1,
  bus: "sfx",
  variants: [],
  ...over,
});

const sessions: ProjectSession[] = [];

async function mount(file: SoundFile) {
  const host = memoryDocHost();
  const assets = [HIT, ...CLIPS];
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
  layoutToDoc(host.doc(`asset:${PROJECT}.khit`), soundKind.layout as DocLayout, file);
  const session = await createProjectSession({
    project: PROJECT,
    openDoc: host.client().openDoc,
    origin: ada,
    registry,
    kinds,
  });
  sessions.push(session);
  render(
    <KitProvider host={{ storage: null }}>
      <SoundPanel
        asset={{ entry: HIT, onClose: vi.fn(), notify: { error: vi.fn() } }}
        session={session}
        registry={registry}
      />
    </KitProvider>,
  );
  return session;
}

afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

const option = (id: string, label: string, path: string): AssetOption => ({
  id,
  kind: "audio",
  label,
  path,
});

describe("variantNames", () => {
  it("names a variant by its asset's name while that tells it apart", () => {
    const names = variantNames(
      ["thud", "boom"],
      [option("thud", "thud", "sfx/thud.wav"), option("boom", "boom", "sfx/boom.wav")],
    );
    expect([...names.values()]).toEqual(["thud", "boom"]);
  });

  it("falls back to the file name, then the path, when another variant shares the name", () => {
    const names = variantNames(
      ["a", "b", "c"],
      [
        option("a", "clink", "sfx/clink.wav"),
        option("b", "clink", "sfx/clink.synth.json"),
        option("c", "clink", "ui/clink.wav"),
      ],
    );
    expect(names.get("a")).toBe("sfx/clink.wav");
    expect(names.get("b")).toBe("clink.synth.json");
    expect(names.get("c")).toBe("ui/clink.wav");
  });

  it("names a variant whose clip is no asset by its id", () => {
    expect(variantNames(["gone"], []).get("gone")).toBe("gone");
  });
});

describe("the sound panel's variants", () => {
  it("heads a clip and a patch of one stem by their file names, as their remove buttons say", async () => {
    await mount(sound({ variants: [{ clip: "clink-wav" }, { clip: "clink-synth" }] }));
    const variants = await screen.findByRole("region", { name: "Variants" });
    const wav = await waitFor(() => {
      const found = variants.querySelector('[data-variant="clink-wav"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const synth = variants.querySelector('[data-variant="clink-synth"]') as HTMLElement;
    expect(within(wav).getByText("clink.wav")).toBeTruthy();
    expect(within(synth).getByText("clink.synth.json")).toBeTruthy();
    expect(within(wav).getByRole("button", { name: "Remove the variant clink.wav" })).toBeTruthy();
    expect(
      within(synth).getByRole("button", { name: "Remove the variant clink.synth.json" }),
    ).toBeTruthy();
  });

  it("keeps a variant with a name of its own under that name", async () => {
    await mount(sound({ variants: [{ clip: "thud" }, { clip: "clink-wav" }] }));
    expect(await screen.findByRole("button", { name: "Remove the variant thud" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove the variant clink" })).toBeTruthy();
  });
});

describe("a trigger's event name", () => {
  const schema = soundKind.schema({ registry, project: null });

  it("follows the sound kind's one rule: no spaces", () => {
    const on = (event: string) => schema.safeParse(sound({ on: [{ event }] })).success;
    expect(on("coin:taken")).toBe(true);
    expect(on("coin taken")).toBe(false);
    expect(on("")).toBe(false);
    expect(SOUND_EVENT_PATTERN.test("coin taken")).toBe(false);
  });

  it("offers a typed name as the game's own only when the rule takes it", async () => {
    await mount(sound());
    const add = (await screen.findByRole("combobox", { name: "on.add" })) as HTMLInputElement;
    const row = add.closest(".je-insp-field") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Show options" }));
    await act(async () => {
      fireEvent.change(add, { target: { value: "coin:taken" } });
    });
    await waitFor(() =>
      expect(
        screen.getAllByRole("option").some((o) => o.textContent?.includes("The game's own")),
      ).toBe(true),
    );
    await act(async () => {
      fireEvent.change(add, { target: { value: "coin taken" } });
    });
    await waitFor(() =>
      expect(
        screen.queryAllByRole("option").some((o) => o.textContent?.includes("The game's own")),
      ).toBe(false),
    );
  });

  it("reads an unset volume as the schema's default of 1", async () => {
    await mount(sound());
    const volume = (await screen.findByRole("textbox", { name: "volume" })) as HTMLInputElement;
    expect(volume.placeholder).toBe("1 (default)");
    const slider = document.querySelector('input[type="range"][aria-label="volume slider"]');
    expect(slider?.getAttribute("aria-valuenow")).toBe("1");
  });
});
