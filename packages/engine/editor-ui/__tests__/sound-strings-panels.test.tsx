// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { GATE_DIALOGUE, GATE_STRINGS, gateDialogue } from "../../__tests__/fixtures/dialogue/gate";
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
import { createRegistry } from "../../game/index";
import {
  createKindRegistry,
  type AssetEntry,
  type DocLayout,
  type StringsFile,
} from "../../project/index";
import { dialogueKind, type DialogueFile } from "../../project/kinds/dialogue";
import { gameSettingsKind } from "../../project/kinds/game-settings";
import { soundKind, type SoundFile } from "../../project/kinds/sound";
import { stringsKind } from "../../project/kinds/strings";
import { KitProvider } from "../kit/index";
import { SoundPanel } from "../panels/assets/SoundPanel";
import { DialoguePanel, StringsPanel } from "../panels/project-tree/asset-panel";

const registry = createRegistry();
const kinds = createKindRegistry(null);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const PROJECT = "yard";
const created = { at: 1, by: "seed" };
const entry = (key: string, id: string, kind: string, path: string): AssetEntry => ({
  key,
  id,
  kind,
  path,
  created,
});

const STRINGS = entry("kstr", "gate-strings", "strings", "text/gate.strings.json");
const SETTINGS = entry("kset", "game-settings", "game-settings", "game.settings.json");
const TALK = entry("ktalk", "gate-talk", "dialogue", "text/gate.dialogue.json");
const HIT = entry("khit", "hit", "sound", "sfx/hit.sound.json");

/** The gate's strings, with the French for "Turn back." left out. */
const strings = (): StringsFile => ({
  ...GATE_STRINGS,
  strings: GATE_STRINGS.strings.map((row) =>
    row.key === "gate.leave" ? { key: row.key, en: row.en } : row,
  ),
});

const HIT_SOUND: SoundFile = {
  kind: "sound",
  v: 1,
  bus: "sfx",
  variants: [],
  caption: "gate.halt",
};

const sessions: ProjectSession[] = [];
const notify = { error: vi.fn() };

async function project(opts: { sound?: SoundFile; dialogue?: DialogueFile } = {}) {
  const host = memoryDocHost();
  const assets = [STRINGS, SETTINGS, TALK, HIT];
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
  layoutToDoc(host.doc(`asset:${PROJECT}.kstr`), stringsKind.layout as DocLayout, strings());
  layoutToDoc(host.doc(`asset:${PROJECT}.kset`), gameSettingsKind.layout as DocLayout, {
    kind: "game-settings",
    v: 2,
    engine: { locales: { default: "en", available: ["en", "fr"] } },
    game: {},
  });
  layoutToDoc(
    host.doc(`asset:${PROJECT}.ktalk`),
    dialogueKind.layout as DocLayout,
    opts.dialogue ?? GATE_DIALOGUE,
  );
  layoutToDoc(
    host.doc(`asset:${PROJECT}.khit`),
    soundKind.layout as DocLayout,
    opts.sound ?? HIT_SOUND,
  );
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

const asset = (e: AssetEntry) => ({ entry: e, onClose: vi.fn(), notify });

const soundOf = (session: ProjectSession) =>
  layoutFromDoc(
    session.get(`asset:${PROJECT}.khit`)!.doc,
    soundKind.layout as DocLayout,
  ) as unknown as SoundFile;

function mountSound(session: ProjectSession) {
  return render(
    <KitProvider host={{ storage: null }}>
      <SoundPanel asset={asset(HIT)} session={session} registry={registry} />
    </KitProvider>,
  );
}

/** A pointer moving onto an option highlights it before the click picks it, as Base UI requires. */
async function choose(option: HTMLElement) {
  await act(async () => {
    fireEvent.mouseMove(option);
    fireEvent.click(option);
  });
}

async function optionsOf(input: HTMLElement) {
  const row = input.closest(".je-insp-field") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "Show options" }));
  return waitFor(() => {
    const found = screen.getAllByRole("option");
    expect(found.length).toBeGreaterThan(0);
    return found;
  });
}

afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

describe("the sound panel's fields", () => {
  it("draws the pitch as a low and high rate with no unit, editing from the default", async () => {
    const session = await project();
    mountSound(session);
    const low = (await screen.findByRole("textbox", { name: "pitch.low" })) as HTMLInputElement;
    const row = low.closest(".je-insp-field") as HTMLElement;
    expect(within(row).getByText("Pitch")).toBeTruthy();
    expect(row.querySelector(".je-insp-line.je-insp-suffix")).toBeNull();
    expect(within(row).queryByText("x")).toBeNull();
    expect(within(row).queryByText("m")).toBeNull();
    expect(low.placeholder).toBe("1 (default)");
    const high = within(row).getByRole("textbox", { name: "pitch.high" });
    await act(async () => {
      fireEvent.change(high, { target: { value: "1.2" } });
      fireEvent.keyDown(high, { key: "Enter" });
    });
    await waitFor(() => expect(soundOf(session).pitch).toEqual([1, 1.2]));
  });

  it("picks the caption from the project's string keys, each with its default-locale text", async () => {
    const session = await project();
    mountSound(session);
    const caption = await screen.findByRole("combobox", { name: "caption" });
    await waitFor(() => expect((caption as HTMLInputElement).value).toBe("gate.halt"));
    const options = await optionsOf(caption);
    const leave = options.find((o) => o.textContent?.startsWith("gate.leave"))!;
    expect(leave.textContent).toContain("Turn back.");
    await choose(leave);
    await waitFor(() => expect(soundOf(session).caption).toBe("gate.leave"));
    expect(readLog(session.get(`asset:${PROJECT}.khit`)!.doc)).toHaveLength(1);
    // The French is missing, which only lesser-locale text falls back for.
    expect(await screen.findByText(/has no text in fr; the default locale's shows/)).toBeTruthy();
  });

  it("flags a caption no table has as the shared string-key rule does", async () => {
    const session = await project({ sound: { ...HIT_SOUND, caption: "gate.nope" } });
    mountSound(session);
    expect(
      await screen.findByText(
        'String key "gate.nope" has no text in the default locale "en" nor in fr',
      ),
    ).toBeTruthy();
  });

  it("names an unknown bus by the sound kind's own rule, with its did-you-mean", async () => {
    const session = await project({ sound: { ...HIT_SOUND, bus: "sfxx" } });
    mountSound(session);
    expect(
      await screen.findByText(
        'No bus "sfxx"; did you mean "sfx"? Use one of master, music, sfx, voice, ui, or declare "sfxx" in GameDefinition.audio.buses.',
      ),
    ).toBeTruthy();
  });

  it("adds a trigger from the engine's step events, and notes an event only a game raises", async () => {
    const session = await project();
    mountSound(session);
    const add = await screen.findByRole("combobox", { name: "on.add" });
    const options = await optionsOf(add);
    const contact = options.find((o) => o.textContent === "contact:start")!;
    await choose(contact);
    await waitFor(() => expect(soundOf(session).on).toEqual([{ event: "contact:start" }]));
    const triggers = screen.getByRole("region", { name: "Triggers" });
    expect(within(triggers).getByText("On contact:start")).toBeTruthy();
    const event = within(triggers).getByRole("combobox", { name: "on.0.event" });
    await optionsOf(event);
    await act(async () => {
      fireEvent.change(event, { target: { value: "coin:taken" } });
    });
    const typed = await waitFor(() => {
      const found = screen.getAllByRole("option").find((o) => o.textContent?.startsWith("coin"));
      expect(found).toBeTruthy();
      return found;
    });
    expect(typed!.textContent).toContain("The game's own");
    await choose(typed!);
    await waitFor(() => expect(soundOf(session).on).toEqual([{ event: "coin:taken" }]));
    expect(
      await within(triggers).findByText('The engine raises no "coin:taken"; only the game can.'),
    ).toBeTruthy();
  });

  it("collapses Variants and Triggers like every inspector section", async () => {
    const session = await project();
    mountSound(session);
    const variants = await screen.findByRole("region", { name: "Variants" });
    expect(variants.querySelector("summary")).not.toBeNull();
    fireEvent.click(variants.querySelector("summary")!);
    expect(within(variants).queryByRole("combobox", { name: "variants.add" })).toBeNull();
  });
});

describe("the string table and dialogue summaries", () => {
  it("count a string table's keys and each locale's missing text", async () => {
    const session = await project();
    render(
      <KitProvider host={{ storage: null }}>
        <StringsPanel asset={asset(STRINGS)} session={session} />
      </KitProvider>,
    );
    expect(await screen.findByText(/^6 keys\./)).toBeTruthy();
    const locales = document.querySelector<HTMLElement>('dl[aria-label="Locales"]')!;
    await waitFor(() => {
      expect(locales.querySelector('[data-locale="en"]')?.textContent).toBe("All keys");
      expect(locales.querySelector('[data-locale="fr"]')?.textContent).toBe("1 missing");
    });
    expect(within(locales).getByText("en (default)")).toBeTruthy();
  });

  it("sum up a dialogue's nodes and endings, and list what its checks find", async () => {
    const talk = gateDialogue();
    talk.nodes.push({ id: "aside", lines: [{ speaker: "guard", text: "gate.later" }] });
    const session = await project({ dialogue: talk });
    render(
      <KitProvider host={{ storage: null }}>
        <DialoguePanel asset={asset(TALK)} session={session} />
      </KitProvider>,
    );
    expect(await screen.findByText("paid, left")).toBeTruthy();
    expect(screen.getByText("4 nodes, 4 lines, 2 choices")).toBeTruthy();
    const problems = screen.getByRole("list", { name: "Problems" });
    expect(
      within(problems).getByText(/^No path from `start` \("gate"\) reaches node "aside"/),
    ).toBeTruthy();
    expect(within(problems).getByText(/^Node "aside" has no choices/)).toBeTruthy();
  });

  it("say so when a dialogue's every node is reached and leads on", async () => {
    const session = await project();
    render(
      <KitProvider host={{ storage: null }}>
        <DialoguePanel asset={asset(TALK)} session={session} />
      </KitProvider>,
    );
    expect(
      await screen.findByText("Every node is reached from the start and leads on or ends."),
    ).toBeTruthy();
  });
});
