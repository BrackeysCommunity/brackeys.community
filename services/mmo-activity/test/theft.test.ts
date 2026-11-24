// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import rigs from "virtual:rigs";
import { afterEach, expect, test } from "vite-plus/test";

import type { ActivityState, Datum, Fact, Theft } from "../src/api.ts";
import { App } from "../src/app.ts";
import { MockGateway } from "../src/mock.ts";
import { Session } from "../src/session.ts";
import { bareNumbers } from "../src/units.ts";
import { beatView } from "../src/views/beat.ts";
import { optionWhy, witnessWhy } from "../src/views/why.ts";
import { factLine, goodsNames, theftLine, witnessLine } from "../src/words.ts";
import { FakeClock, settle } from "./fakes.ts";

function fixture(name: string): ActivityState {
  return JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/state-${name}.json`, "utf8"));
}

const goods = goodsNames();
const open: Session[] = [];
const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  for (const s of open.splice(0)) s.stop();
  document.body.replaceChildren();
});

async function boot(name: string) {
  const clock = new FakeClock();
  const gateway = new MockGateway({
    state: fixture(name),
    rigs,
    level: 3,
    now: () => clock.now,
    after: clock.after,
  });
  let ids = 0;
  const session = new Session({
    signIn: async () => ({ dev: "mock" }),
    token: () => gateway.token(),
    open: () => gateway.open(),
    instance: "mock",
    viewer: { compact: true },
    now: () => clock.now,
    after: clock.after,
    id: () => `intent-${++ids}-abcdef`,
  });
  open.push(session);
  const root = document.createElement("div");
  document.body.append(root);
  new App(root, session, true);
  session.start();
  await settle();
  clock.advance(0);
  await settle();
  await wait();
  return { root, session, clock };
}

const noop = { press() {}, why() {}, openMachine() {}, busy: false };

function theft(edit: Partial<Theft> = {}): Theft {
  return { ...fixture("theft").fight!.theft!, ...edit };
}

function texts(root: Element): string[] {
  return [...root.querySelectorAll("h2, h3, p, li, button")].map((n) => n.textContent ?? "");
}

test("the theft beat shows its witness odds before the options", () => {
  const st = fixture("theft");
  const view = beatView(st, { ...noop, whyWitness() {} });
  expect(view.querySelector("h2")?.textContent).toBe("Burgle: the Cinder Wardens' store");
  const witness = view.querySelector(".witness")!;
  expect(witness.textContent).toBe("Witness: 35% to be seen if it works.");
  const options = view.querySelector(".options")!;
  expect(witness.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(texts(view)).toContain(
    "Burgling the Cinder Wardens' store: 5 copper wire, worth 24 coin.",
  );
  expect(view.querySelector(".beat-track")?.getAttribute("aria-label")).toBe(
    "Burgle: the Cinder Wardens' store, a lock: beat 1 of 2 beats.",
  );
  for (const t of texts(view)) expect(bareNumbers(t, goods), t).toEqual([]);
});

test("a beat with no theft shows no witness line", () => {
  const view = beatView(fixture("beat"), { ...noop, whyWitness() {} });
  expect(view.querySelector(".witness")).toBeNull();
});

test("the witness why lists each part, and the bound the world held it at", () => {
  const view = witnessWhy(theft(), () => {});
  expect([...view.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    "This kind of theft: +30%",
    "Upright people here: +20%",
    "Your Sleight: −6%",
    "Cover here: −9%",
  ]);
  const held = witnessWhy(
    theft({
      witness: 5,
      witnessWhy: {
        parts: [
          { label: "base", value: 30, unit: "percent" },
          { label: "sleight", value: -15, unit: "percent" },
          { label: "cover", value: -20, unit: "percent" },
          { label: "quiet", value: -15, unit: "percent" },
        ],
      },
    }),
    () => {},
  );
  const items = [...held.querySelectorAll("li")].map((li) => li.textContent);
  expect(items).toContain("Quiet gear in hand: −15%");
  expect(items.at(-1)).toBe("Together −20%, held at 5%");
  for (const t of texts(held)) expect(bareNumbers(t), t).toEqual([]);
});

test("an option's why on a theft beat carries the witness parts", () => {
  const st = fixture("theft");
  const pick = st.fight!.options[0]!;
  const on = optionWhy(pick, () => {}, st.fight!.theft);
  expect(texts(on)).toContain("Being seen");
  expect(texts(on)).toContain("Upright people here: +20%");
  expect(texts(optionWhy(pick, () => {}))).not.toContain("Being seen");
});

test("a waylay is always seen, and a flight from the watch has no witness", () => {
  expect(witnessLine(theft({ kind: "waylay", witness: 100 }))).toBe("Witness: always seen (100%).");
  const flee = theft({ kind: "flee", victim: "Copperline", witness: 0, caught: true });
  expect(witnessLine(flee)).toBe("");
  expect(theftLine(flee)).toBe("Running from the watch at Copperline.");
  const st = fixture("theft");
  st.fight!.theft = flee;
  const view = beatView(st, { ...noop, whyWitness() {} });
  expect(view.querySelector(".witness")).toBeNull();
  expect(texts(view)).toContain("The watch has you if this goes wrong again.");
  expect([...view.querySelectorAll("button")].filter((b) => b.textContent === "Why")).toHaveLength(
    view.querySelectorAll(".option").length,
  );
});

test("a caught theft says there is no haul, only the getaway", () => {
  const st = fixture("theft");
  st.fight!.theft = theft({ caught: true });
  expect(texts(beatView(st, noop))).toContain(
    "You were caught: there is no haul now, only the getaway.",
  );
});

test("?mock=theft opens on the lock with the witness odds over it, and the beat one tab away", async () => {
  const { root, session } = await boot("theft");
  expect(session.state?.machine?.family).toBe("lock-pins");
  const main = root.querySelector("main")!;
  expect(main.querySelector(".witness")?.textContent).toBe("Witness: 35% to be seen if it works.");
  expect(
    main.querySelector(".witness")!.compareDocumentPosition(main.querySelector(".surface")!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  [...root.querySelectorAll<HTMLButtonElement>("nav button")]
    .find((b) => b.textContent === "Beat")!
    .click();
  const why = [...main.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "Why",
  )!;
  why.click();
  expect(main.querySelector("h2")?.textContent).toBe("Why: being seen");
  expect(texts(main)).toContain("Your Sleight: −6%");
});

test("the mock passes the theft it was served through unchanged, and invents no theft fact", async () => {
  const { session } = await boot("theft");
  const served = fixture("theft").fight!.theft;
  expect(session.state?.fight?.theft).toEqual(served);
  const armed = await session.intent("machine-arm", { machine: { source: "beat" } });
  await settle();
  expect(armed.ok).toBe(true);
  expect(session.state?.fight?.theft).toEqual(served);
  const { session: other } = await boot("theft");
  const reply = await other.intent("press", { option: "back-out" });
  await settle();
  expect(reply.ok).toBe(true);
  expect(reply.facts ?? []).toEqual([]);
  expect(reply.pressed?.map((p) => p.option)).toEqual(["back-out"]);
});

function fact(kind: string, data: Record<string, string | number>): Fact {
  const out: Datum[] = Object.entries(data).map(([k, v]) =>
    typeof v === "string" ? { k, s: v } : { k, n: v },
  );
  return { id: 1, tick: 1, kind, subjects: [], data: out, weight: 5 };
}

test("every theft, watch and syndicate fact reads as a line with its units", () => {
  const cases: [Fact, string][] = [
    [
      fact("theft.made", {
        kind: "burgle",
        outcome: "won",
        witnessed: 1,
        worth: 24,
        units: 5,
        material: "copper-ore",
        settlement: 2,
      }),
      "Burgle: you got away with 5 copper wire, worth 24 coin. You were seen.",
    ],
    [
      fact("theft.made", { kind: "lift", outcome: "won", witnessed: 0, worth: 28, coin: 28 }),
      "Lift: you got away with 28 coin. No one saw you.",
    ],
    [
      fact("theft.made", {
        kind: "waylay",
        outcome: "won",
        witnessed: 1,
        worth: 40,
        units: 4,
        material: "timber",
        side: "g-12",
      }),
      "Waylay: 4 salvage timber, worth 40 coin, for the side you back. You were seen.",
    ],
    [
      fact("theft.made", { kind: "lift", outcome: "lost", witnessed: 1, worth: 30 }),
      "Lift: you were caught, and took nothing.",
    ],
    [
      fact("theft.made", { kind: "burgle", outcome: "empty", witnessed: 0, worth: 0 }),
      "Burgle: what you were after was gone, and nothing came of it.",
    ],
    [
      fact("alignment.moved", { act: "theft", asked: -3, delta: -3, value: -15, band: "crooked" }),
      "Alignment −3 alignment: now −15 alignment, Crooked.",
    ],
    [
      fact("watch.stopped", { settlement: 2 }),
      "The watch stopped you at the gate: pay the fine or run.",
    ],
    [fact("watch.paid", { fine: 36 }), "You paid the watch off: 36 coin."],
    [fact("watch.fled", {}), "You got away from the watch."],
    [fact("watch.caught", {}), "The watch caught you, and took the goods back."],
    [fact("fence.bought", { pay: 14 }), "The fence bought the goods for 14 coin."],
    [fact("fence.came", {}), "A fence has come looking for you."],
    [fact("craft.laundered", { fee: 9 }), "Worked clean in the back room, for 9 coin in fees."],
    [fact("syndicate.made", {}), "Static has made you one of its own."],
    [fact("syndicate.unmade", {}), "Static has cast you out."],
    [fact("syndicate.posted", {}), "Static has posted a job for its own."],
    [
      fact("character.betrayed", { faction: "syndicate", act: "informed", standing: -50 }),
      "You betrayed Static: your standing with it is −50 standing.",
    ],
    [
      fact("character.betrayed", { faction: "faction:2", act: "theft", standing: -50 }),
      "You betrayed a faction that trusted you: your standing with it is −50 standing.",
    ],
    [fact("den.moved", { cause: "informed" }), "A den of Static has moved."],
  ];
  for (const [f, want] of cases) {
    const line = factLine(f);
    expect(line, f.kind).toBe(want);
    expect(bareNumbers(line, goods), line).toEqual([]);
  }
});
