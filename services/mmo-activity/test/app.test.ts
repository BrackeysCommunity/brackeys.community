// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";

import rigs from "virtual:rigs";
import { afterEach, expect, test } from "vite-plus/test";

import type { ActivityState } from "../src/api.ts";
import { App, pick, screens } from "../src/app.ts";
import { MockGateway } from "../src/mock.ts";
import { geometry } from "../src/scenes/rewire/scene.ts";
import { Session } from "../src/session.ts";
import { bareNumbers } from "../src/units.ts";
import { goodsNames } from "../src/words.ts";
import { FakeClock } from "./fakes.ts";

const FIXTURES = `${import.meta.dirname}/fixtures`;
const names = readdirSync(FIXTURES)
  .filter((f) => /^state-.*\.json$/.test(f))
  .map((f) => f.replace(/^state-(.*)\.json$/, "$1"))
  .sort();

function fixture(name: string): ActivityState {
  return JSON.parse(readFileSync(`${FIXTURES}/state-${name}.json`, "utf8"));
}

const SIZE = { width: 360, height: 420 };
const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const open: Session[] = [];

afterEach(() => {
  for (const s of open.splice(0)) s.stop();
  document.body.replaceChildren();
});

// The whole page on the mock gateway: what ?mock=<name> runs. With a fake
// clock the world's time is the test's to move.
async function boot(name: string, clock?: FakeClock) {
  const compact = true;
  const real = (ms: number, f: () => void) => {
    const t = setTimeout(f, ms);
    return () => clearTimeout(t);
  };
  const after = clock ? clock.after : real;
  const now = clock ? () => clock.now : Date.now;
  const gateway = new MockGateway({ state: fixture(name), rigs, level: 3, now, after });
  let ids = 0;
  const session = new Session({
    signIn: async () => ({ dev: "mock" }),
    token: () => gateway.token(),
    open: () => gateway.open(),
    instance: "mock",
    viewer: { compact },
    now,
    after,
    id: () => `intent-${++ids}-abcdef`,
  });
  open.push(session);
  const root = document.createElement("div");
  document.body.append(root);
  new App(root, session, compact);
  session.start();
  await wait();
  clock?.advance(0);
  await wait();
  return { root, session, gateway };
}

function texts(root: Element): string[] {
  const out: string[] = [];
  for (const node of root.querySelectorAll("h2, h3, p, li, button, span, strong, label")) {
    if (node.querySelector("h2, h3, p, li, button, span, strong, label")) continue;
    const t = (node.textContent ?? "").trim();
    if (t) out.push(t);
  }
  for (const node of root.querySelectorAll("[aria-label]"))
    out.push(node.getAttribute("aria-label")!);
  return out;
}

function click(root: Element, label: string): void {
  const b = [...root.querySelectorAll("button")].find((x) => x.textContent?.startsWith(label));
  if (!b)
    throw new Error(
      `no button "${label}" among: ${[...root.querySelectorAll("button")].map((x) => x.textContent).join(" | ")}`,
    );
  b.click();
}

function surface(root: Element): HTMLElement {
  const s = root.querySelector<HTMLElement>(".surface")!;
  s.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      x: 0,
      y: 0,
      ...SIZE,
      right: SIZE.width,
      bottom: SIZE.height,
      toJSON() {},
    }) as DOMRect;
  return s;
}

function drag(s: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
  const fire = (type: string, p: { x: number; y: number }) =>
    s.dispatchEvent(
      new PointerEvent(type, {
        clientX: p.x,
        clientY: p.y,
        pointerId: 1,
        pointerType: "touch",
        bubbles: true,
      }),
    );
  fire("pointerdown", from);
  fire("pointermove", { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  fire("pointerup", to);
}

// Plays a Rewire on screen to its end by dragging every wire home.
async function solve(root: Element, session: Session): Promise<void> {
  const s = surface(root);
  await wait(40);
  const layout = session.state!.machine!.layout;
  const geo = geometry(layout.size, SIZE);
  const at = Array.from({ length: layout.size }, (_, i) => i);
  for (const [w, port] of layout.target!.entries()) {
    if (at[w] === port) continue;
    drag(s, geo.seats[at[w]!]!, geo.seats[port]!);
    const other = at.indexOf(port);
    at[other] = at[w]!;
    at[w] = port;
    await wait();
  }
  await wait(20);
}

test("what opens follows the launch order: armed, a machine beat, the beat, pouches, the bench, idle", () => {
  const idle = fixture("idle");
  const beat = fixture("beat");
  expect(pick(fixture("armed"), false, "beat")).toBe("machine");
  expect(pick(beat, false, undefined)).toBe("machine");
  expect(pick({ ...beat, machine: undefined }, false, undefined)).toBe("beat");
  expect(pick(fixture("pouch"), false, undefined)).toBe("pouches");
  expect(pick(fixture("bench"), false, undefined)).toBe("bench");
  expect(pick(idle, false, undefined)).toBe("idle");
  // The player's own choice holds while the state still offers it, but never over a machine in hand.
  expect(pick(beat, false, "beat")).toBe("beat");
  expect(pick(beat, true, "beat")).toBe("machine");
  expect(pick(idle, false, "bench")).toBe("idle");
  expect(screens({ ...fixture("bench"), pouches: fixture("pouch").pouches }, false)).toEqual([
    "pouches",
    "bench",
  ]);
});

test.each(names)("no number is shown without its unit: %s", async (name) => {
  const { root } = await boot(name);
  const goods = goodsNames();
  const seen = new Set<string>();
  const check = () => {
    for (const t of texts(root)) {
      seen.add(t);
      expect(bareNumbers(t, goods), `"${t}"`).toEqual([]);
    }
  };
  check();
  // Every tab, and every why behind it.
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("nav button")].map(
    (b) => b.textContent!,
  );
  for (const tab of tabs.length ? tabs : [""]) {
    if (tab) click(root, tab);
    check();
    const whys = [...root.querySelectorAll("main button")].filter(
      (b) => b.textContent === "Why",
    ).length;
    for (let i = 0; i < whys; i++) {
      [...root.querySelectorAll<HTMLButtonElement>("main button")]
        .filter((b) => b.textContent === "Why")
        [i]!.click();
      check();
      click(root, "Back");
    }
  }
  expect(seen.size).toBeGreaterThan(2);
});

test("a machine beat opens on the machine at rest, and the beat is one tab away", async () => {
  const { root } = await boot("beat");
  expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("rest");
  expect(root.querySelector(".countdown-text")?.textContent).toBe("At rest");
  expect(root.textContent).toContain("48 s");
  click(root, "The beat");
  expect(root.textContent).toContain("Machine: Turret nest");
  expect(root.textContent).toContain("Long shot (about 1 in 4), risks 6 durability.");
  click(root, "Why");
  expect(root.textContent).toContain("Practice: +4 pts");
});

test("a first machine hides its level and countdown until it is touched", async () => {
  const { root } = await boot("intro");
  const text = root.querySelector(".machine")!.textContent!;
  expect(text).toContain("Your first machine");
  expect(text).not.toMatch(/level 1,|\d+ s/);
});

test("solving by pointer arms, sends the log and shows the server's result", async () => {
  const { root, session } = await boot("beat");
  await solve(root, session);
  expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("done");
  expect(root.querySelector(".result")!.textContent).toMatch(/A clean solve, in \d+\.\d s\./);
  expect(root.querySelector(".result")!.textContent).toContain("Rewire solved in");
  expect(session.state?.last?.result.solved).toBe(true);
  click(root, "Carry on");
  await wait();
  expect(root.querySelector(".machine")).toBeNull();
  expect(root.textContent).toContain("Nothing here needs your hands");
});

test("an option that is not the machine can be pressed here", async () => {
  const { root, session } = await boot("beat");
  click(root, "The beat");
  click(root, "Smash");
  await wait();
  expect(session.state?.fight).toBeUndefined();
  expect(root.textContent).toContain("Smash at long shot (about 1 in 4): it worked.");
});

test("a machine armed before the page opened shows its countdown from the deadline", async () => {
  const { root, session } = await boot("armed");
  await wait(40);
  expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("play");
  const left = session.state!.machine!.deadline! - session.serverNow();
  // Armed twelve seconds before the page opened, on a countdown of sixty.
  expect(left).toBeGreaterThan(47_000);
  expect(left).toBeLessThanOrEqual(48_000);
  expect(root.querySelector(".countdown-text")!.textContent).toMatch(/^4[78] s left$/);
  // Nothing else may be opened while it runs.
  expect(
    [...root.querySelectorAll<HTMLButtonElement>("nav button")].filter((b) => !b.disabled),
  ).toHaveLength(1);
});

test("a machine armed in another window starts this one's countdown", async () => {
  const clock = new FakeClock();
  const { root, session, gateway } = await boot("beat", clock);
  await wait(40);
  expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("rest");
  gateway.armElsewhere();
  await wait();
  expect(session.state?.machine?.armed).toBe(true);
  expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("play");
  expect(root.querySelector(".countdown-text")!.textContent).toMatch(/s left$/);
});

test("walking away is a haywire: the world's own timer ends the machine and the page shows it", async () => {
  const clock = new FakeClock();
  const { root, session } = await boot("beat", clock);
  const s = surface(root);
  await wait(40);
  const geo = geometry(session.state!.machine!.layout.size, SIZE);
  drag(s, geo.seats[0]!, geo.seats[1]!);
  await wait();
  expect(session.state?.machine?.armed).toBe(true);
  expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("play");
  // Countdown, grace and a beat more, with nothing sent from here.
  clock.advance(48_000 + 2000 + 300);
  await wait();
  expect(session.state?.machine?.armed).toBeFalsy();
  expect(session.state?.last?.result).toMatchObject({
    solved: false,
    late: true,
    haywire: "alarm",
  });
  expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("done");
  expect(root.querySelector(".result")!.textContent).toContain("The countdown ran out.");
  expect(root.querySelector(".result")!.textContent).toContain("+40 threat in the region");
  // Carrying on, the beat still stands with a machine drawn anew.
  click(root, "Carry on");
  await wait();
  expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("rest");
});

test("the bench lists every family, sets a rig up, and a solve is practice", async () => {
  const { root, session } = await boot("bench");
  expect(root.querySelectorAll(".option")).toHaveLength(14);
  expect(root.textContent).toContain("Bench practice today: 3 of 20 uses.");
  expect(root.textContent).toContain("Rewire · Router");
  // Rewire is the first row, and the family solve() plays.
  click(root.querySelector(".option")!, "−");
  click(root.querySelector(".option")!, "Set it up");
  await wait();
  const m = session.state!.machine!;
  expect(m.source).toBe("bench");
  expect(m.countdown).toBeUndefined();
  expect(root.textContent).toContain("No countdown");
  await solve(root, session);
  expect(root.querySelector(".result")!.textContent).toContain("Solved in");
  expect(session.state!.bench!.uses).toBe(4);
  click(root, "Another machine");
  await wait();
  expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("rest");
  expect(JSON.stringify(session.state!.machine!.layout)).not.toBe(JSON.stringify(m.layout));
  click(root, "Bench");
  expect(root.querySelectorAll(".option")).toHaveLength(14);
});

test("a lesson waiting at the bench can be taken", async () => {
  const { root, session } = await boot("bench");
  click(root, "Take a lesson");
  await wait();
  expect(session.state!.bench!.taken).toBe(2);
  expect(root.textContent).toContain("Lesson taken in Pin lock.");
});

test("pouches say what they hold and when a shut one can be tried again", async () => {
  const { root } = await boot("pouch");
  expect(root.textContent).toContain("Holds 3 copper wire, 2 scrap iron.");
  expect(root.textContent).toContain("96 ticks (960 min)");
});
