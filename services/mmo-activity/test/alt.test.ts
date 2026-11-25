// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";

import partyRigs from "virtual:party-rigs";
import rigs from "virtual:rigs";
import { afterEach, expect, test } from "vite-plus/test";

import { encounterLine, WASTELAND_ENCOUNTERS } from "../../../packages/mmo-words/src/encounters.ts";
import { MachineParty, type ActivityState, type MachineView } from "../src/api.ts";
import { App } from "../src/app.ts";
import { MockGateway } from "../src/mock.ts";
import { Session } from "../src/session.ts";
import { MachinePanel } from "../src/shell/panel.ts";
import { partyRegistered, versionOf } from "../src/shell/party-registry.ts";
import { familyOf, registered } from "../src/shell/registry.ts";
import { beatView, creaturePanel } from "../src/views/beat.ts";
import { floorMap } from "../src/views/floor.ts";
import { beatLine, beatPlace, creatureName, name, sentence } from "../src/words.ts";

const FIXTURES = `${import.meta.dirname}/fixtures`;
const names = readdirSync(FIXTURES)
  .filter((f) => /^state-.*\.json$/.test(f))
  .map((f) => f.replace(/^state-(.*)\.json$/, "$1"))
  .sort();

function fixture(name: string): ActivityState {
  return JSON.parse(readFileSync(`${FIXTURES}/state-${name}.json`, "utf8"));
}

const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const open: Session[] = [];
const panels: MachinePanel[] = [];

afterEach(() => {
  for (const s of open.splice(0)) s.stop();
  for (const p of panels.splice(0)) p.destroy();
  document.body.replaceChildren();
});

// The page on the mock gateway, as ?mock=<name> runs it; edit is what the
// address's family, level and practice do to the state.
async function boot(name: string, edit?: (s: ActivityState) => void, level = 3) {
  const after = (ms: number, f: () => void) => {
    const t = setTimeout(f, ms);
    return () => clearTimeout(t);
  };
  const state = fixture(name);
  edit?.(state);
  const gateway = new MockGateway({ state, rigs, partyRigs, level, now: Date.now, after });
  let ids = 0;
  const session = new Session({
    signIn: async () => ({ dev: "mock" }),
    token: () => gateway.token(),
    open: () => gateway.open(),
    instance: "mock",
    viewer: { compact: true },
    now: Date.now,
    after,
    id: () => `intent-${++ids}-abcdef`,
  });
  open.push(session);
  const root = document.createElement("div");
  document.body.append(root);
  new App(root, session, true);
  session.start();
  await wait();
  await wait();
  return { root, session };
}

/** Every picture that is neither named as an image nor hidden, as a line saying what is wrong. */
function unnamed(root: Element): string[] {
  const out: string[] = [];
  for (const node of root.querySelectorAll("svg, canvas, img")) {
    if (node.getAttribute("aria-hidden") === "true") continue;
    const role = node.getAttribute("role");
    const label = node.getAttribute("aria-label")?.trim() ?? "";
    if (role !== "img" || !label)
      out.push(`<${node.tagName.toLowerCase()} class="${node.getAttribute("class") ?? ""}">`);
  }
  return out;
}

function pictures(root: Element): number {
  return root.querySelectorAll("svg, canvas, img").length;
}

function buttons(root: Element, text: string): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => b.textContent === text,
  );
}

// Every tab of the page, and every why behind each, checked as it shows.
function everyView(root: Element, check: () => void): void {
  check();
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("nav button")].map(
    (b) => b.textContent!,
  );
  for (const tab of tabs) {
    [...root.querySelectorAll<HTMLButtonElement>("nav button")]
      .find((b) => b.textContent === tab)!
      .click();
    check();
    const whys = buttons(root, "Why").length;
    for (let i = 0; i < whys; i++) {
      buttons(root, "Why")[i]!.click();
      check();
      buttons(root, "Back")[0]?.click();
    }
  }
}

test.each(names)("every picture is named or hidden: ?mock=%s", async (name) => {
  const { root } = await boot(name);
  let seen = 0;
  everyView(root, () => {
    seen += pictures(root);
    expect(unnamed(root)).toEqual([]);
  });
  const st = fixture(name);
  // A party machine at rest draws nothing: its version and size are fixed when it arms.
  const drawn = st.machine && !(st.machine.seats?.length && !st.machine.armed);
  if (st.fight || st.floor?.floor || drawn) expect(seen).toBeGreaterThan(0);
});

test.each(registered())(
  "every family's machine is named with itself and its state: ?mock=beat&family=%s",
  async (family) => {
    const { root, session } = await boot("beat", (st) => {
      st.fight!.machine = family;
      st.machine = undefined;
      st.character.practice = [{ id: family, level: 0 }];
    });
    await wait(20);
    const boards = [...root.querySelectorAll("svg.board")];
    expect(boards.length).toBeGreaterThan(0);
    const m = session.state!.machine!;
    expect(m.family).toBe(family);
    const head = `${m.level ? `${m.name}, level ${m.level}` : m.name}, at rest: the first touch arms it. `;
    for (const b of boards) {
      const label = b.getAttribute("aria-label") ?? "";
      expect(label.startsWith(head), label).toBe(true);
      expect(label.length).toBeGreaterThan(head.length);
      expect(label.length).toBeLessThanOrEqual(1024);
    }
    everyView(root, () => expect(unnamed(root)).toEqual([]));
  },
);

test("a machine's drawing says where it is in its play", async () => {
  const armed = await boot("armed");
  await wait(20);
  expect(armed.root.querySelector("svg.board")?.getAttribute("aria-label")).toMatch(
    /^Rewire(, level \d+)?, armed, its countdown running\. A /,
  );
  const bench = await boot("bench");
  buttons(bench.root, "Set it up")[0]!.click();
  await wait(20);
  const rigged = [...bench.root.querySelectorAll("svg.board")];
  expect(rigged.length).toBeGreaterThan(0);
  for (const b of rigged)
    expect(b.getAttribute("aria-label")).toContain(
      ", a practice rig on the bench, with no countdown. ",
    );
});

function partyMachine(version: string): MachineView {
  const rig = partyRigs[version]![0]!;
  const seats = Array.from({ length: rig.seats }, (_, seat) => ({
    seat,
    name: ["Ash", "Bryn", "Cole", "Dara"][seat] ?? "Eli",
    here: true,
    ...(seat === 0 ? { you: true } : {}),
  }));
  return {
    source: MachineParty,
    family: rig.family,
    name: name("puzzles.families", rig.family),
    layout: rig.parts[0]!,
    preview: false,
    level: rig.level,
    countdown: rig.countdown,
    armed: true,
    armedAt: Date.now(),
    deadline: Date.now() + rig.countdown,
    due: Date.now() + rig.countdown,
    practice: { level: 2, uses: 30, need: 60 },
    party: version,
    seat: 0,
    seats,
  };
}

test.each(partyRegistered().filter((v) => partyRigs[v]?.length))(
  "every party version's seat is named with its machine and state: %s",
  (id) => {
    const version = versionOf(id)!;
    const m = partyMachine(id);
    const panel = new MachinePanel(
      {
        family: familyOf(version.family)!,
        version,
        stream: () => true,
        known: () => [],
        serverNow: () => Date.now(),
        online: () => true,
        intent: () => new Promise(() => {}),
        passHint: () => {},
        why: () => {},
        close: () => {},
        changed: () => {},
      },
      m,
    );
    panels.push(panel);
    document.body.append(panel.root);
    const boards = [...panel.root.querySelectorAll("svg.board")];
    expect(boards.length).toBeGreaterThan(0);
    for (const b of boards)
      expect(b.getAttribute("aria-label")).toMatch(
        new RegExp(`^${m.name}, level ${m.level}, armed, its countdown running\\. \\S`),
      );
    expect(unnamed(panel.root)).toEqual([]);
  },
);

test.each(["beat", "party", "party-machine", "variant"])(
  "the beat line is the pick chat's card makes: %s",
  (fx) => {
    const st = fixture(fx);
    const f = st.fight!;
    const place =
      f.shared && f.floor && st.floor
        ? st.floor.name || `the ${name("map.dungeons", st.floor.kind).toLowerCase()}`
        : (st.place.name ?? "");
    expect(beatPlace(st)).toBe(place);
    const want = encounterLine(WASTELAND_ENCOUNTERS, f, { creature: creatureName(f), place });
    expect(want).not.toBe("");
    expect(beatLine(st)).toBe(want);
    const view = beatView(st, { press() {}, why() {}, openMachine() {}, busy: false });
    expect(view.querySelector(".encounter")?.textContent).toBe(want);
    // The line opens the panel, after the heading and the creature's track.
    expect(view.querySelector(".creature")?.nextElementSibling?.tagName).toBe("P");
  },
);

test("the beat line is stable for a fight and a beat, and moves with the beat", () => {
  const st = fixture("beat");
  const lines = new Set<string>();
  for (let beat = 0; beat < 6; beat++) {
    const at = { ...st, fight: { ...st.fight!, beat } };
    expect(beatLine(at)).toBe(beatLine(structuredClone(at)));
    lines.add(beatLine(at));
  }
  expect(lines.size).toBeGreaterThan(1);
});

test("the creature panel names the creature, its beat and what the fight says of it", () => {
  const st = fixture("variant");
  st.fight = { ...st.fight!, hidden: true, ambush: true };
  const track = creaturePanel(st).querySelector("svg")!;
  expect(track.getAttribute("role")).toBe("img");
  expect(track.getAttribute("aria-label")).toBe(
    "Plated wire-eel, a wire-eel of this region, in a clash: beat 1 of 3 beats. It has not seen you. It is an ambush.",
  );
  expect(track.querySelector(".beat-rule")?.getAttribute("aria-hidden")).toBe("true");
  expect(track.querySelectorAll(".beat-pip")).toHaveLength(st.fight.beats);
});

test("the floor map says every room it draws", () => {
  const st = fixture("floor");
  const map = floorMap(st);
  const label = map.getAttribute("aria-label")!;
  expect(map.getAttribute("role")).toBe("img");
  expect(label).toMatch(
    /^A map of the rooms of floor 2\. Back to floor 1\. Floor 2, haunted, where /,
  );
  for (const w of st.floor!.ways ?? [])
    expect(label).toContain(`A way down, ${sentence(w.name)}: `);
  for (const hex of map.querySelectorAll("polygon"))
    expect(hex.getAttribute("aria-hidden")).toBe("true");
});
