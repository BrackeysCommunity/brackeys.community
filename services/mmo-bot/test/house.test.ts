import { expect, mock, test } from "bun:test";

import { type Interaction, SnowflakeUtil } from "discord.js";

import { createHandler, REPORT_OTHERS, reportedOf } from "../src/adapter.ts";
import * as api from "../src/api.ts";
import { type Card, problems } from "../src/card.ts";
import { localBudget } from "../src/cooldown.ts";
import { modalFor, wantsGuildLists } from "../src/flow.ts";
import { memoryStore } from "../src/forum.ts";
import { alarmRoleOf, heldKeyOf, Houses, quietNow, refOf, staffOf } from "../src/house.ts";
import { type Action, decodeId, encodeId } from "../src/ids.ts";
import { LogPoster } from "../src/logs.ts";
import { REPORT } from "../src/manifest.ts";
import {
  logWords,
  pinDraftId,
  queueTarget,
  type StageDraft,
  stageDraftId,
  stageDraftOf,
} from "../src/screens/house.ts";
import {
  channels,
  GUILD,
  heldRaws,
  house,
  houseWorld,
  lex,
  logRows,
  o,
  roles,
} from "./fixtures/mm12.ts";

const names = lex.goodsNames();
const id = (action: Action, target = "", version = 17) => ({ action, target, version });

const ids = (c: Card) =>
  c.rows.flatMap((r) =>
    "buttons" in r
      ? r.buttons.map((b) => (b.kind === "page" ? b.customId : ""))
      : [r.select.customId],
  );
const actions = (c: Card) => ids(c).map((x) => decodeId(x)?.action);
const labels = (c: Card) =>
  c.rows.flatMap((r) => ("buttons" in r ? r.buttons.map((b) => b.label) : []));
const select = (c: Card, action: Action) => {
  for (const r of c.rows)
    if ("select" in r && decodeId(r.select.customId)?.action === action) return r.select;
  return undefined;
};
const field = (c: Card, name: string) => c.fields?.find((f) => f.name === name)?.value;
const clean = (c: Card) => expect(problems(c, names)).toEqual([]);

const stage = (over: Partial<StageDraft> = {}): StageDraft => ({
  template: "drop-large",
  settlement: 0,
  site: "-",
  what: "-",
  opens: 0,
  days: 0,
  page: "w",
  ...over,
});

test("a member without the flags gets no console, and a DM none at all", async () => {
  const { press, writes, reads } = houseWorld();
  for (const command of ["admin", "staff"] as const) {
    const card = (await press(undefined, { command })).card;
    expect(card.title).toBe(
      `This console is for the server's ${command === "admin" ? "admins" : "staff"}`,
    );
    expect(actions(card)).toEqual(["hub"]);
    clean(card);
  }
  // Staff are not admins: /admin and the admin's own cards stay shut.
  const staff = { staff: true };
  expect((await press(undefined, { command: "admin", ...staff })).card.title).toBe(
    "This console is for the server's admins",
  );
  expect((await press(id("hs-conf", "events"), staff)).card.title).toBe(
    "This console is for the server's admins",
  );
  expect((await press(id("hs-pins"), staff)).card.title).toBe(
    "This console is for the server's admins",
  );
  // A member pressing an old console button writes nothing.
  expect((await press(id("hs-go", stageDraftId(stage({ site: "3,-1" }))))).card.title).toBe(
    "This console is for the server's staff",
  );
  expect(
    (await press(undefined, { command: "staff", guild: undefined, staff: true })).card.title,
  ).toBe("Consoles open in a server");
  expect(writes).toEqual([]);
  expect(reads).not.toContain("house");
});

test("the admin console shows the server, its settlements and stages, and the admin's tools", async () => {
  const { press, flags } = houseWorld();
  const card = (await press(undefined, { command: "admin", admin: true })).card;
  clean(card);
  expect(card.author).toContain("Admin console");
  expect(card.description).toBe("New players of this server arrive at Old Rail.");
  expect(labels(card)).toEqual(["Stage", "Muster", "Settings", "Log", "Pins", "Queue", "Hub"]);
  expect(field(card, "Live stages")).toContain(
    "Large drop at Old pylon · open · 117 crates left · Staged by the admins of Rustwater Crew",
  );
  // Admins may end any stage of the server's.
  expect(select(card, "hs-end")?.options.map((x) => x.value)).toEqual(["st-1", "st-2"]);
  // Muster opens the board's goal form with the admins as issuer.
  const muster = ids(card)
    .map(decodeId)
    .find((x) => x?.action === "g-form");
  expect(muster?.target).toContain("a");
  expect(flags.at(-1)).toEqual({ admin: true, staff: undefined });
});

test("the staff console shows each pool with its refill, and ends only staff stages", async () => {
  const { press, flags } = houseWorld();
  const card = (await press(undefined, { command: "staff", staff: true })).card;
  clean(card);
  expect(field(card, "Old Rail")).toBe("320 of 400 event points · +27 event points at the day");
  expect(field(card, "Low Wick")).toBe("40 of 400 event points · +20 event points at the day");
  expect(labels(card)).toEqual(["Stage", "Queue", "Log", "Hub"]);
  expect(select(card, "hs-end")?.options.map((x) => x.value)).toEqual(["st-2"]);
  expect(flags.at(-1)).toEqual({ admin: undefined, staff: true });
});

test("an admin stages a drop through the pure flow: free, with the member named for the log", async () => {
  const { press, writes } = houseWorld();
  const admin = { admin: true };
  const form = (await press(id("hs-stage"), admin)).card;
  clean(form);
  // Admins see every template, the admin-only pattern too, each free.
  expect(select(form, "hs-tpl")?.options.map((x) => x.value)).toEqual([
    "contest",
    "hunt-2",
    "drop-large",
    "pattern",
  ]);
  expect(select(form, "hs-tpl")?.options[2]?.description).toBe(
    "Free for admins · 120 crates · 2 days",
  );
  expect(field(form, "Cost")).toBe("Nothing: admins stage without a pool");
  const tpl = select(form, "hs-tpl")!;
  const picked = (await press(decodeId(tpl.customId)!, { ...admin, values: ["drop-large"] })).card;
  const sited = select(picked, "hs-site")!;
  expect(sited.options.map((x) => x.label)).toEqual(["Old pylon", "Cut mast"]);
  // Nothing is sent until the site is picked.
  expect(
    picked.rows
      .flatMap((r) => ("buttons" in r ? r.buttons : []))
      .find((b) => b.label === "Stage it"),
  ).toMatchObject({ disabled: true });
  const ready = (await press(decodeId(sited.customId)!, { ...admin, values: ["3,-1"] })).card;
  clean(ready);
  expect(ready.description).toStartWith("Ready");
  const go = ids(ready)
    .map(decodeId)
    .find((x) => x?.action === "hs-go")!;
  expect(writes).toEqual([]);
  const done = (await press(go, admin)).card;
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: o.version,
      kind: api.ActStage,
      server: GUILD,
      admin: true,
      discordId: "someone",
      stage: { template: "drop-large", settlement: 0, at: { q: 3, r: -1 } },
    },
  ]);
  expect(done.title).toBe("Staged: Large drop");
  expect(done.author).toContain("Admin console");
  clean(done);
});

test("a staff member stages a tier 2 hunt from the pool, its creature and timing picked", async () => {
  const { press, writes } = houseWorld();
  const staff = { staff: true };
  const form = (await press(id("hs-stage"), staff)).card;
  // Staff see the staff templates only, each with its price.
  expect(select(form, "hs-tpl")?.options.map((x) => [x.value, x.description])).toEqual([
    ["contest", "30 event points · 3 days"],
    ["hunt-2", "80 event points · 2 days"],
    ["drop-large", "150 event points · 120 crates · 2 days"],
  ]);
  const d = stage({ template: "hunt-2", site: "4,-2" });
  const needs = (await press(id("hs-stage", stageDraftId(d)), staff)).card;
  expect(needs.description).toBe("Pick the creature");
  expect(select(needs, "hs-what")?.options.map((x) => [x.value, x.label])).toEqual([
    ["cinder-hound", "Cinder hounds"],
  ]);
  expect(field(needs, "Cost")).toBe(
    "80 event points from the pool of Old Rail, which holds 320 of 400 event points",
  );
  const hunted = (
    await press(decodeId(select(needs, "hs-what")!.customId)!, {
      ...staff,
      values: ["cinder-hound"],
    })
  ).card;
  clean(hunted);
  // The timing page: when it opens and how long it lasts.
  const when = (
    await press(
      decodeId(
        ids(hunted).find(
          (x) => decodeId(x)?.action === "hs-stage" && decodeId(x)!.target.endsWith(".t"),
        )!,
      )!,
      staff,
    )
  ).card;
  clean(when);
  const opens = select(when, "hs-open")!;
  expect(opens.options.map((x) => x.label)).toEqual([
    "Now",
    "In 1 hour",
    "In 6 hours",
    "In 1 day",
    "In 2 days",
    "In 3 days",
    "In 7 days",
  ]);
  const later = (await press(decodeId(opens.customId)!, { ...staff, values: ["144"] })).card;
  const days = select(later, "hs-days")!;
  const set = (await press(decodeId(days.customId)!, { ...staff, values: ["3"] })).card;
  expect(field(set, "Opens")).toBe("In 1 day");
  expect(field(set, "Lasts")).toBe("3 days");
  const go = ids(set)
    .map(decodeId)
    .find((x) => x?.action === "hs-go")!;
  const done = (await press(go, staff)).card;
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: o.version,
      kind: api.ActStage,
      server: GUILD,
      staff: true,
      discordId: "someone",
      stage: {
        template: "hunt-2",
        settlement: 0,
        at: { q: 4, r: -2 },
        hunt: "cinder-hound",
        opens: 144,
        days: 3,
      },
    },
  ]);
  expect(done.title).toBe("Staged: Hunt, tier 2, 80 event points from the pool");
  expect(done.author).toContain("Staff console");
});

test("staff short of points cannot press Stage it, and a refused staging keeps its draft", async () => {
  const { press, writes } = houseWorld();
  const short = stage({ settlement: 4, site: "-6,2" });
  const card = (await press(id("hs-stage", stageDraftId(short)), { staff: true })).card;
  expect(card.description).toBe("Low Wick's pool is short of 150 event points");
  expect(labels(card)).toContain("Stage it");
  const go = (await press(id("hs-go", stageDraftId(short)), { staff: true })).card;
  expect(go.title).toBe("Low Wick's pool is short of 150 event points");
  expect(writes).toEqual([]);

  const refused = houseWorld({
    refusal: { code: api.CodeStageLimit, message: "too many stages here" },
  });
  const d = stage({ site: "3,-1" });
  const back = (await refused.press(id("hs-go", stageDraftId(d)), { admin: true })).card;
  expect(back.title).toBe("Too many stages here");
  expect(back.author).toContain("Stage an event");
  expect(stageDraftOf(stageDraftId(d))).toEqual(d);
});

test("ending a stage sends its id, and the console says nothing is refunded", async () => {
  const { press, writes } = houseWorld();
  const card = (await press(id("hs-end"), { staff: true, values: ["st-2"] })).card;
  expect(writes.map((w) => [w.kind, w.target, w.staff, w.discordId])).toEqual([
    [api.ActStageEnd, "st-2", true, "someone"],
  ]);
  expect(card.title).toBe("Ended: what it left is gone, and nothing is refunded");
});

test("the queue lists open cases and this guild's held names, and acts on a case", async () => {
  const { press, writes, held } = houseWorld();
  const staff = { staff: true };
  const q = (await press(id("hs-queue"), staff)).card;
  clean(q);
  expect(select(q, "hs-case")?.options.map((x) => x.value)).toEqual(["case-2", "case-1", "case-3"]);
  expect(field(q, "Open cases")).toContain(
    "case-1 · character c-14 · Abuse or harassment · 3 reports",
  );
  // Held names are this guild's only; one held before names carried a guild is never shown.
  expect(select(q, "hs-held")?.options.map((x) => x.label)).toEqual(["“Rude Name”"]);
  const opened = (
    await press(id("hs-case", queueTarget({ case: "", days: 7 })), { ...staff, values: ["case-1"] })
  ).card;
  clean(opened);
  expect(labels(opened)).toEqual([
    "Mask",
    "Mute 7 days",
    "Suspend 7 days",
    "Exclude 7 days",
    "Escalate",
    "Dismiss",
    "Holds and masks",
    "Console",
  ]);
  // Two rows of at most five actions, beside the case and hold-length selects.
  expect(opened.rows.length).toBeLessThanOrEqual(5);
  const longer = (
    await press(id("hs-queue", queueTarget({ case: "case-1", days: 7 })), {
      ...staff,
      values: [queueTarget({ case: "case-1", days: 0 })],
    })
  ).card;
  expect(labels(longer)).toContain("Mute until lifted");
  const mute = ids(longer)
    .map(decodeId)
    .find((x) => x?.action === "hs-mod" && x.target.startsWith("mute"))!;
  const muted = (await press(mute, staff)).card;
  expect(writes.at(-1)).toMatchObject({
    kind: api.ActModerate,
    staff: true,
    discordId: "someone",
    moderate: { action: "mute", ref: "character:c-14", days: 0, case: "case-1" },
  });
  expect(muted.title).toBe("Muted here");
  // A goal is hidden, never masked, and holds are only for members.
  const goal = (
    await press(id("hs-case", queueTarget({ case: "", days: 7 })), { ...staff, values: ["case-2"] })
  ).card;
  expect(labels(goal).slice(0, 2)).toEqual(["Hide", "Escalate"]);
  // An escalated case is the operators': it is only shown.
  const esc = (
    await press(id("hs-case", queueTarget({ case: "", days: 7 })), { ...staff, values: ["case-3"] })
  ).card;
  expect(labels(esc)).toEqual(["Holds and masks", "Console"]);
  // Dismissing writes the case alone.
  await press(id("hs-mod", "dismiss.case-2.7"), staff);
  expect(writes.at(-1)?.moderate).toEqual({ action: "dismiss", case: "case-2" });
  // A held name is dismissed from the bot's list, and the world hears nothing of it.
  const n = writes.length;
  const key = heldKeyOf(heldRaws[0]!);
  expect((await press(id("hs-held"), { ...staff, values: [key] })).card.title).toBe(
    "Dismissed: the name was never sent",
  );
  expect(held.raws).toHaveLength(2);
  expect((await press(id("hs-held"), { ...staff, values: [key] })).card.title).toBe(
    "That name is no longer held",
  );
  expect(writes).toHaveLength(n);
});

test("holds, masks and hidden notes are each lifted with their un- action", async () => {
  const { press, writes } = houseWorld();
  const card = (await press(id("hs-lift"), { staff: true })).card;
  clean(card);
  expect(select(card, "hs-lift")?.options.map((x) => x.value)).toEqual([
    "unmute/character:c-20",
    "unmask/guild:g-8",
    "unhide/goal:goal-5",
  ]);
  const lifted = (await press(id("hs-lift"), { staff: true, values: ["unmask/guild:g-8"] })).card;
  expect(writes.at(-1)?.moderate).toEqual({ action: "unmask", ref: "guild:g-8" });
  expect(lifted.title).toBe("Lifted");
  expect((await press(id("hs-lift"), { staff: true, values: ["drop/table"] })).card.author).toBe(
    "An old button",
  );
});

test("the public log reads every page, newest first, and names counts and places in words", async () => {
  const { press, reads } = houseWorld();
  const card = (await press(id("hs-log", "0"), { staff: true })).card;
  clean(card);
  expect(reads.filter((r) => r === "houseLog").length).toBeGreaterThan(2);
  expect(card.fields?.map((f) => f.name)).toEqual([
    "Admin · house-pin",
    "Staff · moderate",
    "Admin · house-settings",
    "Staff · stage",
    "Admin · stage",
  ]);
  expect(card.fields?.[3]?.value).toStartWith(
    "<@8888888888>: stage hunt-2 at Old Rail on Cut mast · hunt cinder-hound · opens in 144 ticks · 80 event points",
  );
  expect(card.fields?.[0]?.value).toStartWith("c-1: pin at Old pylon · landmark old-pylon");
  expect(logWords("settings · 1 channel · 1 staff role · 2 alarm roles", house)).toBe(
    "settings · a channel · a staff role · two alarm roles",
  );
  expect(labels(card)).toEqual(["Older", "Newer", "Console"]);
});

test("settings map a channel, toggle roles, names and narration, and the switch follows", async () => {
  const { press, writes, switched } = houseWorld();
  const admin = { admin: true, channels, roles };
  const card = (await press(id("hs-conf", "events"), admin)).card;
  clean(card);
  expect(field(card, "Channels")).toContain("Events: <#2222222222>");
  expect(field(card, "Quiet hours")).toBe("22:00 to 06:00 UTC: alarm mentions wait, posts do not");
  const log = (await press(id("hs-kind", "events"), { ...admin, values: ["log"] })).card;
  expect(decodeId(select(log, "hs-chan")!.customId)?.target).toBe("log");
  await press(id("hs-chan", "log"), { ...admin, values: ["2222222223"] });
  expect(writes.at(-1)).toMatchObject({
    kind: api.ActHouseSettings,
    admin: true,
    discordId: "someone",
    note: "Rustwater Crew",
    settings: {
      channels: [
        { kind: "events", id: "2222222222" },
        { kind: "log", id: "2222222223" },
      ],
    },
  });
  await press(id("hs-srole", "log"), { ...admin, values: ["3333333333"] });
  expect(writes.at(-1)?.settings?.staffRoles).toEqual([]);
  await press(id("hs-arole", "log"), { ...admin, values: ["3333333333"] });
  expect(writes.at(-1)?.settings?.alarmRoles).toEqual(["4444444444", "3333333333"]);
  await press(id("hs-names", "log"), admin);
  expect(writes.at(-1)?.settings?.hideNames).toBe(true);
  expect(switched).toEqual([]);
  const on = (await press(id("hs-narr", "log"), admin)).card;
  expect(writes.at(-1)?.settings?.narrated).toBe(true);
  expect(switched).toEqual([[GUILD, true]]);
  expect(field(on, "Narration")).toBe("On, where the model is on");
  await press(id("hs-narr", "log"), admin);
  expect(switched).toEqual([
    [GUILD, true],
    [GUILD, false],
  ]);
  // Quiet hours come from a modal; bad times are refused before any write.
  expect(modalFor(id("hs-quiet", "log"))?.customId).toBe(encodeId("hs-quieted", "", 17));
  const n = writes.length;
  const bad = (await press(id("hs-quieted"), { ...admin, fields: { from: "25:00", to: "06:00" } }))
    .card;
  expect(bad.title).toBe("Give both times as HH:MM in UTC, or leave both empty");
  expect(writes).toHaveLength(n);
  await press(id("hs-quieted"), { ...admin, fields: { from: "21:30", to: "7:00" } });
  expect(writes.at(-1)?.settings).toMatchObject({ quietFrom: 21 * 60 + 30, quietTo: 7 * 60 });
  await press(id("hs-quieted"), { ...admin, fields: { from: "", to: "" } });
  expect(writes.at(-1)?.settings).toMatchObject({ quietFrom: 0, quietTo: 0 });
  expect(wantsGuildLists(id("hs-conf"))).toBe(true);
  expect(wantsGuildLists(id("hs-log"))).toBe(false);
});

test("saving the settings of a server with no house installs it, named after the server", async () => {
  const { press, writes } = houseWorld({ house: null });
  const card = (await press(undefined, { command: "admin", admin: true })).card;
  clean(card);
  expect(card.description).toBe(
    "No arrival settlement yet: saving the settings installs the server's guild.",
  );
  expect(labels(card).slice(0, 5)).toEqual(["Stage", "Muster", "Settings", "Log", "Pins"]);
  await press(id("hs-names", "events"), { admin: true, channels, roles });
  expect(writes.at(-1)).toMatchObject({
    kind: api.ActHouseSettings,
    note: "Rustwater Crew",
    settings: { hideNames: true },
  });
});

test("an admin pins a landmark on a known site, the rows read from the lexicon", async () => {
  const { press, writes } = houseWorld();
  const admin = { admin: true };
  const form = (await press(id("hs-pins"), admin)).card;
  clean(form);
  const rows = select(form, "hs-prow")!.options.map((x) => x.label);
  expect(rows).toContain("Old pylon");
  expect(rows).toEqual([...rows].sort((a, b) => a.localeCompare(b)));
  const ground = (
    await press(decodeId(select(form, "hs-pfield")!.customId)!, { ...admin, values: ["ground"] })
  ).card;
  expect(select(ground, "hs-prow")?.options.map((x) => x.value)).toContain("marsh");
  const d = { settlement: 0, site: "3,-1", field: "landmark" as const, row: "old-pylon" };
  const done = (await press(id("hs-pin", pinDraftId(d)), admin)).card;
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 17,
      kind: api.ActHousePin,
      server: GUILD,
      admin: true,
      discordId: "someone",
      pin: { at: { q: 3, r: -1 }, fix: { landmark: "old-pylon" } },
    },
  ]);
  expect(done.title).toBe("Pinned: it lands when someone first reaches the tile");
});

test("an admin withdraws a pin still to land; a landed one is not offered", async () => {
  const { press, writes } = houseWorld();
  const admin = { admin: true };
  const form = (await press(id("hs-pins"), admin)).card;
  const list = (await press(id("hs-pinls"), admin)).card;
  clean(list);
  expect(form.rows.flatMap((r) => ("buttons" in r ? r.buttons : [])).map((b) => b.label)).toContain(
    "Withdraw a pin",
  );
  const pins = select(list, "hs-unpin")!;
  expect(pins.options.map((x) => x.value)).toEqual(["pin-4"]);
  expect(pins.options[0]!.description).toBe("Old pylon, near Old Rail");
  const done = (await press(decodeId(pins.customId)!, { ...admin, values: ["pin-4"] })).card;
  expect(writes.at(-1)).toMatchObject({
    kind: api.ActHouseUnpin,
    admin: true,
    discordId: "someone",
    pin: { pin: "pin-4" },
  });
  expect(done.title).toBe("Withdrawn: the tile is the world's again");
});

test("an admin picks the pattern a pattern template lays", async () => {
  const { press } = houseWorld();
  const admin = { admin: true };
  const form = (await press(id("hs-stage"), admin)).card;
  const tpl = select(form, "hs-tpl")!;
  const picked = (await press(decodeId(tpl.customId)!, { ...admin, values: ["pattern"] })).card;
  clean(picked);
  expect(select(picked, "hs-what")?.options.map((x) => x.label)).toEqual(["The second triangle"]);
});

test("Report reads a card's target from its first custom id, else names the post", () => {
  expect(reportedOf(encodeId("gld-act", "promote:c-14:x", 3), "22", "33")).toBe("character:c-14");
  expect(reportedOf(encodeId("goal", "goal-7", 3), "22", "33")).toBe("goal:goal-7");
  expect(reportedOf(encodeId("d-name", "-2,4", 3), "22", "33")).toBe("dungeon:-2,4");
  expect(reportedOf(encodeId("kn-name", "k:k-9", 3), "22", "33")).toBe("kind:k-9");
  expect(reportedOf(encodeId("pr-name", "p-2", 3), "22", "33")).toBe("promotion:p-2");
  expect(reportedOf(encodeId("gld-join", "g-3", 3), "22", "33")).toBe("guild:g-3");
  // A card whose first button names nothing, or no button at all, is the post.
  expect(reportedOf(encodeId("hub", "", 3), "22", "33")).toBe("p/22/33");
  expect(reportedOf(undefined, "22", "33")).toBe("p/22/33");
  expect(refOf({ action: "goal", target: "mine", version: 0 })).toBeNull();
});

test("Report with a target and without one offers the five reasons, and a pick files it", async () => {
  const { press, writes } = houseWorld();
  const named = (await press(undefined, { command: REPORT, report: "character:c-14" })).card;
  clean(named);
  expect(named.description).toStartWith("About character c-14.");
  const reasons = select(named, "rpt")!;
  expect(reasons.options.map((x) => x.value)).toEqual([
    "abuse",
    "name",
    "spam",
    "cheating",
    "other",
  ]);
  const filed = (await press(decodeId(reasons.customId)!, { values: ["name"] })).card;
  expect(writes.at(-1)).toMatchObject({
    kind: api.ActReport,
    case: { ref: "character:c-14", reason: "name" },
  });
  expect(writes.at(-1)?.discordId).toBeUndefined();
  expect(filed.title).toBe("Reported: the server's staff will read it");
  expect(select(filed, "rpt")).toBeUndefined();

  const post = (await press(undefined, { command: REPORT, report: "p/2222222222/5555555555" }))
    .card;
  clean(post);
  expect(post.description).toStartWith("About this card.");
  await press(decodeId(select(post, "rpt")!.customId)!, { values: ["spam"] });
  expect(writes.at(-1)?.case).toEqual({
    ref: `post:https://discord.com/channels/${GUILD}/2222222222/5555555555`,
    reason: "spam",
  });
  // Every reported ref fits Discord's custom id.
  expect(select(post, "rpt")!.customId.length).toBeLessThanOrEqual(100);
  // A reason that is not one of the five writes nothing.
  const n = writes.length;
  await press(decodeId(select(post, "rpt")!.customId)!, { values: ["because"] });
  expect(writes).toHaveLength(n);
});

test("the adapter answers Report on the game's cards only, with the presser's own card", async () => {
  const { ctx } = houseWorld();
  const handle = createHandler({
    ctx,
    budget: localBudget(),
    media: async () => new Uint8Array([1]),
  });
  const base = (author: string, components: unknown[]) => ({
    user: { id: "someone" },
    id: "event",
    guildId: GUILD,
    commandName: REPORT,
    client: { user: { id: "bot" } },
    targetMessage: {
      author: { id: author },
      id: "5555555555",
      channelId: "2222222222",
      components,
    },
    isPrimaryEntryPointCommand: () => false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isMessageContextMenuCommand: () => true,
    deferReply: mock(async () => {}),
    editReply: mock(async (_v: unknown) => {}),
    reply: mock(async (_v: unknown) => {}),
  });
  const other = base("someone-else", []);
  await handle(other as unknown as Interaction);
  expect(other.reply).toHaveBeenCalledWith(expect.objectContaining({ content: REPORT_OTHERS }));
  const card = base("bot", [{ components: [{ customId: encodeId("goal", "goal-7", 2) }] }]);
  await handle(card as unknown as Interaction);
  expect(card.deferReply).toHaveBeenCalledTimes(1);
  const sent = JSON.stringify(card.editReply.mock.calls[0]![0]);
  expect(sent).toContain("goal goal-7");
  expect(sent).toContain(encodeId("rpt", "goal:goal-7", 17).slice(0, 12));
});

test("the adapter marks staff by Moderate Members or a role the settings name", async () => {
  const { ctx, writes, houses } = houseWorld();
  const handle = createHandler({
    ctx,
    budget: localBudget(),
    media: async () => new Uint8Array([1]),
    staffRoles: (g) => houses.staffRolesOf(g),
  });
  const press = (perms: (p: bigint) => boolean, memberRoles: string[]) => ({
    user: { id: "someone" },
    id: `event-${writes.length}-${memberRoles.join()}`,
    guildId: GUILD,
    customId: encodeId("hs-end", "", 17),
    values: ["st-2"],
    member: { roles: memberRoles },
    memberPermissions: { has: perms },
    message: { id: SnowflakeUtil.generate({ timestamp: Date.now() }).toString() },
    isPrimaryEntryPointCommand: () => false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,
    deferUpdate: mock(async () => {}),
    editReply: mock(async (_v: unknown) => {}),
    reply: mock(async (_v: unknown) => {}),
  });
  const MODERATE = 1n << 40n;
  await handle(press((p) => p === MODERATE, []) as unknown as Interaction);
  await handle(press(() => false, ["3333333333"]) as unknown as Interaction);
  await handle(press(() => false, ["0000000000"]) as unknown as Interaction);
  expect(writes.map((w) => [w.kind, w.staff])).toEqual([
    [api.ActStageEnd, true],
    [api.ActStageEnd, true],
  ]);
});

test("staff, quiet hours and the house cache", async () => {
  expect(staffOf(house.settings, true, [])).toBe(true);
  expect(staffOf(house.settings, false, ["3333333333"])).toBe(true);
  expect(staffOf(house.settings, false, ["4444444444"])).toBe(false);
  expect(staffOf(undefined, false, ["3333333333"])).toBe(false);
  const at = (h: number, m = 0) => Date.UTC(2026, 10, 25, h, m);
  expect(quietNow(house.settings, at(23))).toBe(true);
  expect(quietNow(house.settings, at(5, 59))).toBe(true);
  expect(quietNow(house.settings, at(6))).toBe(false);
  expect(quietNow(house.settings, at(12))).toBe(false);
  expect(quietNow({ quietFrom: 60, quietTo: 120 }, at(1, 30))).toBe(true);
  expect(quietNow({ quietFrom: 60, quietTo: 60 }, at(1))).toBe(false);
  let reads = 0;
  let now = 0;
  const houses = new Houses(
    {
      house: async () => {
        reads++;
        return { ok: true as const, reply: house };
      },
    },
    { now: () => now },
  );
  expect(await houses.channelOf(GUILD, "events")).toBe("2222222222");
  expect(await houses.channelOf(GUILD, "log")).toBeUndefined();
  expect(await houses.alarmRolesOf(GUILD)).toEqual(["4444444444"]);
  expect(reads).toBe(1);
  now = 61_000;
  await houses.houseOf(GUILD);
  expect(reads).toBe(2);
  await houses.wrote(GUILD);
  await houses.houseOf(GUILD);
  expect(reads).toBe(3);
  expect(await houses.houseOf("")).toBeNull();
});

test("the log poster posts each row once, into the channel the settings map, a cursor per guild", async () => {
  const posted: { channel: string; title: string }[] = [];
  const sinkOf = (channel: string) => ({
    post: async (card: Card) => {
      posted.push({ channel, title: card.title });
      return `m-${posted.length}`;
    },
    edit: async () => true,
  });
  const mapped = {
    ...house,
    settings: { ...house.settings, channels: [{ kind: "log", id: "2222222223" }] },
  };
  const other = "6666666666";
  const rows = [...logRows, { ...logRows[0]!, id: 4, server: other }];
  const world = {
    async houseLog(server: string, after: number) {
      const next = rows.filter((r) => r.server === server && r.id > after).slice(0, 2);
      return { rows: next, next: next.at(-1)?.id ?? after };
    },
  };
  const houses = new Houses({
    house: async (g: string) => ({
      ok: true as const,
      reply: g === GUILD ? mapped : { ...house, server: other, settings: {} },
    }),
  });
  const store = memoryStore();
  const poster = new LogPoster(world, houses, store, sinkOf, [GUILD, other], async (g) =>
    g === other ? "7777777770" : undefined,
  );
  expect(await poster.poll()).toBe(6);
  expect(posted.filter((p) => p.channel === "2222222223")).toHaveLength(5);
  expect(posted.filter((p) => p.channel === "7777777770")).toHaveLength(1);
  expect(posted[0]!.title).toBe("Admin: stage drop-large at Old Rail on Old pylon");
  // Polled again, nothing is posted twice.
  expect(await poster.poll()).toBe(0);
  expect(await store.get(`mmo-bot:log:${GUILD}:last`)).toBe("13");
  // A failed post takes its mark back, so the row is posted on the next poll.
  rows.push({ ...logRows[0]!, id: 20 });
  let fail = true;
  const flaky = new LogPoster(
    world,
    houses,
    store,
    (c) => ({
      post: async (card: Card) => {
        if (fail) throw new Error("discord down");
        return sinkOf(c).post(card);
      },
      edit: async () => true,
    }),
    [GUILD],
    undefined,
    undefined,
    () => {},
  );
  expect(await flaky.poll()).toBe(0);
  expect(await store.get(`mmo-bot:log:${GUILD}:last`)).toBe("13");
  fail = false;
  expect(await flaky.poll()).toBe(1);
  for (const p of posted) expect(p.title.length).toBeGreaterThan(0);
});

test("a guild with no log channel posts nothing and keeps its cursor", async () => {
  const posted: string[] = [];
  const store = memoryStore();
  const poster = new LogPoster(
    { houseLog: async () => ({ rows: logRows, next: 13 }) },
    new Houses({ house: async () => ({ ok: true as const, reply: { ...house, settings: {} } }) }),
    store,
    () => ({ post: async (c: Card) => (posted.push(c.title), "m"), edit: async () => true }),
    [GUILD],
  );
  expect(await poster.poll()).toBe(0);
  expect(posted).toEqual([]);
  expect(await store.get(`mmo-bot:log:${GUILD}:last`)).toBeNull();
});

test("Raid alarms toggles the first alarm role the settings name, else the bot's own", async () => {
  const { ctx, houses } = houseWorld();
  const toggled: string[] = [];
  const press = () => {
    const cache = new Set<string>();
    return {
      user: { id: "someone" },
      id: "event",
      guildId: GUILD,
      customId: encodeId("alarm", "", 0),
      member: {
        roles: {
          cache,
          add: async (r: string) => void toggled.push(`+${r}`),
          remove: async (r: string) => void toggled.push(`-${r}`),
        },
      },
      isPrimaryEntryPointCommand: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      deferReply: mock(async () => {}),
      editReply: mock(async (_v: unknown) => {}),
      reply: mock(async (_v: unknown) => {}),
    };
  };
  const named = createHandler({
    ctx,
    budget: localBudget(),
    media: async () => new Uint8Array([1]),
    alarmRole: "1234567890",
    alarmRoles: (g) => houses.alarmRolesOf(g),
  });
  await named(press() as unknown as Interaction);
  const plain = createHandler({
    ctx,
    budget: localBudget(),
    media: async () => new Uint8Array([1]),
    alarmRole: "1234567890",
  });
  await plain(press() as unknown as Interaction);
  expect(toggled).toEqual(["+4444444444", "+1234567890"]);
});

test("an alarm mentions the house's first alarm role, else the fallback", () => {
  expect(alarmRoleOf({ alarmRoles: ["r1", "r2"] }, "env")).toBe("r1");
  expect(alarmRoleOf({ alarmRoles: [] }, "env")).toBe("env");
  expect(alarmRoleOf({}, "env")).toBe("env");
  expect(alarmRoleOf(undefined, "env")).toBe("env");
  expect(alarmRoleOf(undefined, undefined)).toBeUndefined();
});
