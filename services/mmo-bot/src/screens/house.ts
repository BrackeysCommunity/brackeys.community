import type { Button, EmbedField, Modal, Row } from "../../../../packages/discord-kit/src/index.ts";
import { stagedLine } from "../../../../packages/mmo-words/src/index.ts";
import type * as api from "../api.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { CHANNEL_KINDS, type ChannelKind, channelIn, type HeldEntry } from "../house.ts";
import { encodeId, fields, integerTarget, target } from "../ids.ts";
import { capitalise, type Lexicon, readable } from "../lexicon.ts";
import {
  amount,
  countWords,
  outOf,
  plural,
  signed,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
} from "../units.ts";
import { back, btn, buttonLabel, option, SELECT_MOST } from "./common.ts";
import { BLANK, goalDraftId } from "./goals.ts";

/**
 * The consoles of a server's staff and admins (GDD 14, 17.1): the admin
 * console, the staff console, the staging form, the moderation queue, the
 * public log and the server settings, with the admin's pin form and the
 * report a member files from any card. Each speaks for its server alone,
 * and the world decides every outcome: a console only names what to ask.
 */

export const ADMIN_CONSOLE = "Admin console · only you can see this";
export const STAFF_CONSOLE = "Staff console · only you can see this";
export const REPORT_CONTEXT = "Report · only you can see this";
/** Where a log row is posted, and who sees it. */
export const LOG_CHANNEL = "Log channel · everyone in the server can see this";

export type Role = "admin" | "staff";

/** A muster: the goal form with the admins as its issuer, paid from the treasury (GDD 4.8). */
const MUSTER = goalDraftId({ ...BLANK, issuer: "a" });

/** A channel or role of the guild, as the adapter lists it for the settings card. */
export interface GuildThing {
  id: string;
  name: string;
}

/** When a staging may open, in ticks from now; the world holds the lead days. */
const OPENS = [
  0,
  TICKS_PER_HOUR,
  6 * TICKS_PER_HOUR,
  TICKS_PER_DAY,
  2 * TICKS_PER_DAY,
  3 * TICKS_PER_DAY,
  7 * TICKS_PER_DAY,
];
/** How long a staging may last, in days; 0 takes the template's. */
const DAYS = [0, 1, 2, 3, 4, 5, 6, 7];
/** How long a hold may last, in days; 0 until it is lifted. */
export const HOLD_DAYS = [1, 3, 7, 14, 28, 56, 0];
export const HOLD_DAYS_DEFAULT = 7;
/** Rows a page of the public log shows. */
export const LOG_PAGE = 8;

export const REASONS = ["abuse", "name", "spam", "cheating", "other"] as const;
const REASON_WORDS: Record<(typeof REASONS)[number], string> = {
  abuse: "Abuse or harassment",
  name: "A name that should not stand",
  spam: "Spam",
  cheating: "Cheating",
  other: "Something else",
};

const NONE = "-";

/** A template's name: the setting's, else its id in words, with a hunt's tier as "tier 2". */
export function templateName(
  lex: Lexicon,
  id: string,
  templates: readonly api.StageTemplate[] = [],
): string {
  if (lex.names("liveops.templates", id)) return lex.name("liveops.templates", id);
  const t = templates.find((x) => x.id === id);
  const base = readable(id.replace(/-\d+$/, ""));
  return t?.tier ? `${base}, tier ${t.tier}` : base;
}

function settlementName(
  h: api.House | undefined,
  n: number | undefined,
  fallback = "their settlement",
): string {
  return (n === undefined ? undefined : h?.settlements.find((s) => s.n === n)?.name) ?? fallback;
}

function roleWord(role: string): string {
  return role === "admin" ? "Admin" : role === "staff" ? "Staff" : capitalise(role || "player");
}

/** One staging as a line: what, where, how far along, and who staged it. */
export function stageLine(
  st: api.StageView,
  lex: Lexicon,
  templates: readonly api.StageTemplate[] = [],
): string {
  const state = st.closed ? "closed" : st.open ? "open" : "opens later";
  const left = st.crates ? ` · ${amount(st.crates, "crates")} left` : "";
  const taken = st.taken ? " · taken" : "";
  return `${templateName(lex, st.template, templates)} at ${st.place} · ${state}${left}${taken} · ${stagedLine(st.placed)}`;
}

/** A staff pool: "320 of 400 event points · +27 event points at the day". */
export function poolLine(s: api.HouseSettlement): string {
  return `${outOf(s.pool, s.poolCap, "event points")} · ${signed(s.refill, "event points")} at the day`;
}

function liveStages(h: api.House): api.StageView[] {
  return h.stages.filter((s) => !s.closed);
}

function stagesField(h: api.House, lex: Lexicon): EmbedField {
  const live = liveStages(h);
  return {
    name: "Live stages",
    value: live.length
      ? live
          .slice(0, 10)
          .map((s) => stageLine(s, lex, h.templates))
          .join("\n")
      : "None: Stage sets one up",
  };
}

/** The select that ends a live stage; staff are offered only their own kind's. */
function endRow(h: api.House, role: Role, v: number, lex: Lexicon): Row[] {
  const ends = liveStages(h).filter((s) => role === "admin" || s.placed.by === "staff");
  if (!ends.length) return [];
  return [
    {
      select: {
        customId: encodeId("hs-end", "", v),
        placeholder: "End a stage now (nothing is refunded)",
        options: ends
          .slice(0, SELECT_MOST)
          .map((s) =>
            option(
              `${templateName(lex, s.template, h.templates)} at ${s.place}`,
              s.id,
              s.open ? "Open" : "Opens later",
            ),
          ),
      },
    },
  ];
}

function arrivalLine(h: api.House): string {
  return h.arrival >= 0
    ? `New players of this server arrive at ${settlementName(h, h.arrival)}.`
    : "No arrival settlement yet: saving the settings installs the server's guild.";
}

/** The admin console (GDD 14.1): settlements and arrival, live stages, and the admin's tools. */
export function adminConsole(h: api.House, v: number, lex: Lexicon, notice?: string): Card {
  return {
    context: ADMIN_CONSOLE,
    author: authorLine("Admin console", h.label || "this server"),
    title: notice ?? (h.label || "This server"),
    description: arrivalLine(h),
    picture: "form",
    fields: [
      {
        name: "Settlements",
        value: h.settlements.length
          ? h.settlements.map((s) => `${s.name} (${s.region})`).join("\n")
          : "None yet",
      },
      stagesField(h, lex),
    ],
    footer: "Admins stage without a pool; the log records every action",
    colour: COLOUR.hazard,
    rows: [
      {
        buttons: [
          btn("Stage", "hs-stage", "", v, { style: "primary", disabled: !h.settlements.length }),
          btn("Muster", "g-form", MUSTER, v),
          btn("Settings", "hs-conf", "events", v),
          btn("Log", "hs-log", "0", v),
          btn("Pins", "hs-pins", "", v, { disabled: !h.settlements.length }),
        ],
      },
      { buttons: [btn("Queue", "hs-queue", "", v), back(v)] },
      ...endRow(h, "admin", v, lex),
    ],
  };
}

/** The staff console (GDD 14.3): each settlement's pool, the live stages, and staff's tools. */
export function staffConsole(h: api.House, v: number, lex: Lexicon, notice?: string): Card {
  return {
    context: STAFF_CONSOLE,
    author: authorLine("Staff console", h.label || "this server"),
    title: notice ?? (h.label || "This server"),
    description: h.settlements.length
      ? "Staff stage from the pool of the settlement they name."
      : "The server's guild runs no settlement yet: an admin sets it up in /admin.",
    picture: "form",
    fields: [
      ...h.settlements.slice(0, 10).map((s) => ({ name: s.name, value: poolLine(s) })),
      stagesField(h, lex),
    ],
    footer: "Pools refill at each world day; the log records every action",
    colour: COLOUR.signal,
    rows: [
      {
        buttons: [
          btn("Stage", "hs-stage", "", v, { style: "primary", disabled: !h.settlements.length }),
          btn("Queue", "hs-queue", "", v),
          btn("Log", "hs-log", "0", v),
          back(v),
        ],
      },
      ...endRow(h, "staff", v, lex),
    ],
  };
}

/** A console asked for by a member its server does not count as staff or admin. */
export function noConsoleCard(role: Role): Card {
  return {
    context: role === "admin" ? ADMIN_CONSOLE : STAFF_CONSOLE,
    author: `${roleWord(role)} console`,
    title:
      role === "admin"
        ? "This console is for the server's admins"
        : "This console is for the server's staff",
    description:
      role === "admin"
        ? "Admins are members with the Administrator permission."
        : "Staff are members with Moderate Members, or a role an admin names in the server settings.",
    picture: "form",
    footer: "Your hub is one press away",
    rows: [{ buttons: [back(0)] }],
  };
}

/** A console opened outside a server. */
export function noServerCard(role: Role): Card {
  return {
    ...noConsoleCard(role),
    title: "Consoles open in a server",
    description: "Open it from the server whose staff or admins you are.",
  };
}

// The staging form.

export interface StageDraft {
  template: string;
  settlement: number;
  /** The site's tile as "q,r", or "-" for none picked. */
  site: string;
  /** A hunt's creature row, a contest or a pattern; "-" for none. */
  what: string;
  opens: number;
  days: number;
  page: "w" | "t";
}

export function stageDraftId(d: StageDraft): string {
  return target(".", d.template || NONE, d.settlement, d.site, d.what, d.opens, d.days, d.page);
}

export function stageDraftOf(raw: string): StageDraft | null {
  const f = fields(raw, ".", 7);
  if (!f) return null;
  const [template, n, site, what, opens, days, page] = f as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const settlement = integerTarget(n);
  const o = integerTarget(opens);
  const d = integerTarget(days);
  if (settlement === undefined || o === undefined || d === undefined || o < 0 || d < 0) return null;
  if (page !== "w" && page !== "t") return null;
  if (site !== NONE && !hexOf(site)) return null;
  return {
    template: template === NONE ? "" : template,
    settlement,
    site,
    what,
    opens: o,
    days: d,
    page,
  };
}

/** A "q,r" tile reference as a tile. */
export function hexOf(ref: string): api.Hex | undefined {
  const f = fields(ref, ",", 2);
  const q = integerTarget(f?.[0] ?? "");
  const r = integerTarget(f?.[1] ?? "");
  return q === undefined || r === undefined ? undefined : { q, r };
}

/** The templates a role may stage: staff only those marked for staff. */
export function templatesFor(h: api.House, role: Role): api.StageTemplate[] {
  return h.templates.filter((t) => role === "admin" || t.staff);
}

/** What a template asks the stager to pick beside the site, and the choices. */
function whatOf(h: api.House, t: api.StageTemplate | undefined, lex: Lexicon) {
  switch (t?.kind) {
    case "hunt":
      return {
        what: "creature",
        options: h.hunts.map((x) => option(lex.name("fights.hunts", x), x)),
      };
    case "contest":
      return {
        what: "contest",
        options: h.contests.map((x) => option(lex.name("liveops.contests", x), x)),
      };
    case "pattern":
      return {
        what: "pattern",
        options: (t.patterns ?? []).map((x) => option(lex.name("story.pattern-puzzles", x), x)),
      };
    default:
      return null;
  }
}

/** A fresh draft: the first template the role may stage, at the arrival settlement. */
export function blankStage(h: api.House, role: Role): StageDraft {
  const first = h.settlements.find((s) => s.n === h.arrival) ?? h.settlements[0];
  return {
    template: templatesFor(h, role)[0]?.id ?? "",
    settlement: first?.n ?? -1,
    site: NONE,
    what: NONE,
    opens: 0,
    days: 0,
    page: "w",
  };
}

/** Why a draft cannot be sent yet, or null when it can. */
export function stageMissing(h: api.House, role: Role, d: StageDraft, lex: Lexicon): string | null {
  const t = templatesFor(h, role).find((x) => x.id === d.template);
  if (!t) return "Pick what to stage";
  const s = h.settlements.find((x) => x.n === d.settlement);
  if (!s) return "Pick a settlement";
  if (d.site === NONE) return "Pick the site it is staged at";
  const w = whatOf(h, t, lex);
  if (w && d.what === NONE) return `Pick the ${w.what}`;
  if (role === "staff" && s.pool < t.points)
    return `${s.name}'s pool is short of ${amount(t.points, "event points")}`;
  return null;
}

function opensWords(ticks: number): string {
  if (!ticks) return "Now";
  return ticks % TICKS_PER_DAY
    ? `In ${plural(ticks / TICKS_PER_HOUR, "hour")}`
    : `In ${plural(ticks / TICKS_PER_DAY, "day")}`;
}

/** The staging form (GDD 14.4): what, where and when; the sheets decide the rest. */
export function stageForm(
  h: api.House,
  role: Role,
  d: StageDraft,
  v: number,
  lex: Lexicon,
  notice?: string,
): Card {
  const templates = templatesFor(h, role);
  const t = templates.find((x) => x.id === d.template);
  const s = h.settlements.find((x) => x.n === d.settlement);
  const at = (next: Partial<StageDraft>) => stageDraftId({ ...d, ...next });
  const id = stageDraftId(d);
  const w = whatOf(h, t, lex);
  const days = d.days || t?.days || 0;
  const cost =
    role === "admin"
      ? "Nothing: admins stage without a pool"
      : t && s
        ? `${amount(t.points, "event points")} from the pool of ${s.name}, which holds ${outOf(s.pool, s.poolCap, "event points")}`
        : "Pick a template and a settlement";
  const missing = stageMissing(h, role, d, lex);
  const site = s?.sites.find((x) => `${x.at.q},${x.at.r}` === d.site);
  const rows: Row[] = [];
  if (d.page === "w") {
    rows.push({
      select: {
        customId: encodeId("hs-tpl", id, v),
        placeholder: "What to stage",
        options: templates.slice(0, SELECT_MOST).map((x) => ({
          ...option(
            templateName(lex, x.id, templates),
            x.id,
            [
              role === "admin" ? "Free for admins" : amount(x.points, "event points"),
              x.crates ? amount(x.crates, "crates") : "",
              plural(x.days, "day"),
            ]
              .filter(Boolean)
              .join(" · "),
          ),
          default: x.id === d.template,
        })),
      },
    });
    if (h.settlements.length > 1)
      rows.push({
        select: {
          customId: encodeId("hs-set", id, v),
          placeholder: "At which settlement",
          options: h.settlements.slice(0, SELECT_MOST).map((x) => ({
            ...option(x.name, String(x.n), role === "staff" ? `Pool: ${poolLine(x)}` : x.region),
            default: x.n === d.settlement,
          })),
        },
      });
    if (s?.sites.length)
      rows.push({
        select: {
          customId: encodeId("hs-site", id, v),
          placeholder: "At which site in its region",
          options: s.sites.slice(0, SELECT_MOST).map((x) => ({
            ...option(x.name, `${x.at.q},${x.at.r}`),
            default: `${x.at.q},${x.at.r}` === d.site,
          })),
        },
      });
    if (w?.options.length)
      rows.push({
        select: {
          customId: encodeId("hs-what", id, v),
          placeholder: `Which ${w.what}`,
          options: w.options
            .slice(0, SELECT_MOST)
            .map((o) => ({ ...o, default: o.value === d.what })),
        },
      });
  } else {
    rows.push({
      select: {
        customId: encodeId("hs-open", id, v),
        placeholder: "When it opens",
        options: OPENS.map((x) => ({
          ...option(opensWords(x), String(x)),
          default: x === d.opens,
        })),
      },
    });
    rows.push({
      select: {
        customId: encodeId("hs-days", id, v),
        placeholder: "How long it lasts",
        options: DAYS.map((x) => ({
          ...option(
            x ? plural(x, "day") : `As the template says${t ? `: ${plural(t.days, "day")}` : ""}`,
            String(x),
          ),
          default: x === d.days,
        })),
      },
    });
  }
  rows.push({
    buttons: [
      btn("Stage it", "hs-go", id, v, { style: "success", disabled: missing !== null }),
      d.page === "w"
        ? btn("When and how long…", "hs-stage", at({ page: "t" }), v)
        : btn("What and where…", "hs-stage", at({ page: "w" }), v),
      btn("Console", role === "admin" ? "admin" : "staff", "", v),
    ],
  });
  return {
    context: role === "admin" ? ADMIN_CONSOLE : STAFF_CONSOLE,
    author: authorLine("Stage an event", h.label || "this server"),
    title: notice ?? (t ? `Stage: ${templateName(lex, t.id, templates)}` : "Stage an event"),
    description: missing ?? "Ready: Stage it sends it to the world, which may still refuse it.",
    picture: "form",
    fields: [
      {
        name: "At",
        value: `${site?.name ?? "no site yet"}${s ? `, near ${s.name}` : ""}`,
        inline: true,
      },
      { name: "Opens", value: opensWords(d.opens), inline: true },
      { name: "Lasts", value: days ? plural(days, "day") : "as the template says", inline: true },
      { name: "Cost", value: cost },
    ],
    footer: "The stager's own character takes nothing from what it stages",
    colour: COLOUR.hazard,
    rows: rows.slice(0, 5),
  };
}

/** A sent draft as the world's order. */
export function stageOrder(h: api.House, d: StageDraft): api.StageOrder | null {
  const at = hexOf(d.site);
  const t = h.templates.find((x) => x.id === d.template);
  if (!at || !t) return null;
  const what = d.what === NONE ? undefined : d.what;
  return {
    template: d.template,
    settlement: d.settlement,
    at,
    hunt: t.kind === "hunt" ? what : undefined,
    contest: t.kind === "contest" ? what : undefined,
    pattern: t.kind === "pattern" ? what : undefined,
    opens: d.opens || undefined,
    days: d.days || undefined,
  };
}

// The moderation queue.

/** A name ref, goal or post in words a card can show; plain leaves a post's link out, for a select. */
export function refWords(ref: string, h?: api.House, plain = false): string {
  const at = ref.indexOf(":");
  const kind = ref.slice(0, at);
  const id = ref.slice(at + 1);
  switch (kind) {
    case "character":
    case "guild":
    case "kind":
    case "promotion":
    case "goal":
      return `${kind} ${id}`;
    case "settlement": {
      const name = settlementName(h, integerTarget(id), "");
      return name ? `settlement ${name}` : "a settlement";
    }
    case "dungeon":
      return "a dungeon";
    case "post":
      return plain ? "a post" : `[a post](${id})`;
    default:
      return "something reported";
  }
}

function reasonWord(r: string): string {
  return REASON_WORDS[r as (typeof REASONS)[number]] ?? capitalise(r);
}

const PENDING = new Set(["open", "acted", "escalated"]);

/** The cases still waiting on someone, newest first. */
export function pendingCases(h: api.House): api.Case[] {
  return (h.cases ?? []).filter((c) => PENDING.has(c.state)).sort((a, b) => b.tick - a.tick);
}

export interface QueueFocus {
  case: string;
  days: number;
}

export function queueTarget(f: QueueFocus): string {
  return target(".", f.case || NONE, f.days);
}

export function queueFocusOf(raw: string): QueueFocus {
  const f = fields(raw, ".", 2);
  const days = integerTarget(f?.[1] ?? "");
  return {
    case: f && f[0] !== NONE ? f[0]! : "",
    days: days !== undefined && HOLD_DAYS.includes(days) ? days : HOLD_DAYS_DEFAULT,
  };
}

function holdWords(days: number): string {
  return days ? plural(days, "day") : "until lifted";
}

/** What may be done about a case: mask a name, hide a note, hold its character, or pass it on. */
function caseButtons(c: api.Case, days: number, v: number): Button[] {
  const kind = c.ref.slice(0, c.ref.indexOf(":"));
  const out: Button[] = [];
  const mod = (label: string, action: string, style?: "danger" | "primary") =>
    btn(buttonLabel(label), "hs-mod", target(".", action, c.id, days), v, style ? { style } : {});
  if (kind === "goal") out.push(mod("Hide", "hide"));
  else if (kind !== "post") out.push(mod("Mask", "mask"));
  if (kind === "character") {
    out.push(mod(`Mute ${holdWords(days)}`, "mute", "danger"));
    out.push(mod(`Suspend ${holdWords(days)}`, "suspend", "danger"));
    out.push(mod(`Exclude ${holdWords(days)}`, "exclude", "danger"));
  }
  if (c.state !== "escalated") out.push(mod("Escalate", "escalate", "primary"));
  return out;
}

/** The moderation queue (GDD 14.6): open cases, and the names the screen held for this server. */
export function queueCard(
  h: api.House,
  held: readonly HeldEntry[],
  focus: QueueFocus,
  role: Role,
  v: number,
  notice?: string,
): Card {
  const cases = pendingCases(h);
  const c = cases.find((x) => x.id === focus.case);
  const rows: Row[] = [];
  if (cases.length)
    rows.push({
      select: {
        customId: encodeId("hs-case", queueTarget(focus), v),
        placeholder: "Open a case",
        options: cases.slice(0, SELECT_MOST).map((x) => ({
          ...option(
            `${x.id}: ${refWords(x.ref, h, true)}`,
            x.id,
            `${reasonWord(x.reason)} · ${plural(x.reporters, "report")} · ${x.state}`,
          ),
          default: x.id === focus.case,
        })),
      },
    });
  if (c) {
    if (c.ref.startsWith("character:"))
      rows.push({
        select: {
          customId: encodeId("hs-queue", queueTarget(focus), v),
          placeholder: "How long a mute, suspension or exclusion lasts",
          options: HOLD_DAYS.map((x) => ({
            ...option(`Hold for ${holdWords(x)}`, queueTarget({ case: c.id, days: x })),
            default: x === focus.days,
          })),
        },
      });
    const acts = caseButtons(c, focus.days, v);
    if (acts.length) rows.push({ buttons: acts });
  }
  rows.push({
    buttons: [
      ...(c && c.state !== "escalated"
        ? [btn("Dismiss", "hs-mod", target(".", "dismiss", c.id, focus.days), v)]
        : []),
      btn("Holds and masks", "hs-lift", "", v),
      btn("Console", role === "admin" ? "admin" : "staff", "", v),
    ],
  });
  if (held.length)
    rows.push({
      select: {
        customId: encodeId("hs-held", "", v),
        placeholder: "Dismiss a held name",
        options: held
          .slice(0, SELECT_MOST)
          .map((x) => option(`“${x.name}”`, x.key, `${capitalise(x.use)} name · day ${x.day}`)),
      },
    });
  const fieldsOut: EmbedField[] = [
    {
      name: "Open cases",
      value: cases.length
        ? cases
            .slice(0, 10)
            .map(
              (x) =>
                `${x.id} · ${refWords(x.ref, h)} · ${reasonWord(x.reason)} · ${plural(x.reporters, "report")}${x.state === "open" ? "" : ` · ${x.state}`}`,
            )
            .join("\n")
        : "None",
    },
  ];
  if (c)
    fieldsOut.push({
      name: `Case ${c.id}`,
      value: `${capitalise(refWords(c.ref, h))}, reported for ${reasonWord(c.reason).toLowerCase()} by ${countWords(c.reporters, "member")}${c.action ? `; done so far: ${c.action}` : ""}.`,
    });
  fieldsOut.push({
    name: "Held names",
    value: held.length
      ? held
          .slice(0, 10)
          .map((x) => `“${x.name}” · a ${x.use} name · day ${x.day}`)
          .join("\n")
      : "None: the screen held nothing typed here",
  });
  return {
    context: role === "admin" ? ADMIN_CONSOLE : STAFF_CONSOLE,
    author: authorLine("Moderation queue", h.label || "this server"),
    title: notice ?? (c ? `Case ${c.id}` : "The queue"),
    description:
      "Moderation changes only what this server sees and does; it never touches goods or coin.",
    picture: "form",
    fields: fieldsOut,
    footer: "Escalated cases go to the world's operators",
    colour: COLOUR.rust,
    rows: rows.slice(0, 5),
  };
}

/** A lift's select value: the un- action and the ref it names. */
export function liftValue(action: string, ref: string): string {
  return `${action}/${ref}`;
}

export function liftOf(raw: string): { action: string; ref: string } | null {
  const cut = raw.indexOf("/");
  if (cut < 0) return null;
  const action = raw.slice(0, cut);
  const ref = raw.slice(cut + 1);
  return ["unmute", "unsuspend", "unexclude", "unmask", "unhide"].includes(action) && ref
    ? { action, ref }
    : null;
}

/** The holds, masks and hidden notes standing on this server, each to lift. */
export function holdsCard(h: api.House, role: Role, v: number, notice?: string): Card {
  const goalRef = (g: string) => (g.startsWith("goal:") ? g : `goal:${g}`);
  const lifts = [
    ...(h.holds ?? []).map((x) =>
      option(
        `Lift the ${x.kind} on ${x.char}`,
        liftValue(`un${x.kind}`, `character:${x.char}`),
        x.ends ? `Ends at world day ${x.ends}` : "Until lifted",
      ),
    ),
    ...(h.masks ?? []).map((m) => option(`Unmask ${refWords(m, h, true)}`, liftValue("unmask", m))),
    ...(h.hidden ?? []).map((g) =>
      option(`Unhide ${refWords(goalRef(g), h)}`, liftValue("unhide", goalRef(g))),
    ),
  ];
  const line = (xs: string[], none: string) => (xs.length ? xs.slice(0, 15).join("\n") : none);
  return {
    context: role === "admin" ? ADMIN_CONSOLE : STAFF_CONSOLE,
    author: authorLine("Holds and masks", h.label || "this server"),
    title: notice ?? "What stands on this server",
    picture: "form",
    fields: [
      {
        name: "Holds",
        value: line(
          (h.holds ?? []).map(
            (x) =>
              `${capitalise(x.kind)} on ${x.char} · ${x.ends ? `ends at world day ${x.ends}` : "until lifted"}`,
          ),
          "None",
        ),
      },
      {
        name: "Masked names",
        value: line(
          (h.masks ?? []).map((m) => refWords(m, h)),
          "None",
        ),
      },
      {
        name: "Hidden notes",
        value: line(
          (h.hidden ?? []).map((g) => refWords(goalRef(g), h)),
          "None",
        ),
      },
    ],
    footer: "A lifted hold or mask reads as before at once",
    colour: COLOUR.rust,
    rows: [
      ...(lifts.length
        ? [
            {
              select: {
                customId: encodeId("hs-lift", "", v),
                placeholder: "Lift one",
                options: lifts.slice(0, SELECT_MOST),
              },
            },
          ]
        : []),
      {
        buttons: [
          btn("Queue", "hs-queue", "", v),
          btn("Console", role === "admin" ? "admin" : "staff", "", v),
        ],
      },
    ],
  };
}

// The public log.

/** A log row's summary in words: settlements and tiles by name, counts with their units. */
export function logWords(what: string, h?: api.House): string {
  const siteAt = (q: string, r: string) =>
    h?.settlements.flatMap((s) => s.sites).find((x) => `${x.at.q},${x.at.r}` === `${q},${r}`)?.name;
  return what
    .replace(/settlement (\d+)/g, (_, n: string) => settlementName(h, Number(n)))
    .replace(/\b(on|pin) (-?\d+),(-?\d+)/g, (_, w: string, q: string, r: string) => {
      const name = siteAt(q, r);
      return w === "on" ? `on ${name ?? "its tile"}` : `pin at ${name ?? "a tile"}`;
    })
    .replace(/(\d+) (channels?|staff roles?|alarm roles?)/g, (_, n: string, u: string) =>
      countWords(Number(n), u.replace(/s$/, ""), u.endsWith("s") ? u : `${u}s`),
    );
}

function whoOf(row: api.LogRow): string {
  return row.discord ? `<@${row.discord}>` : row.character || "the world";
}

function logField(row: api.LogRow, h?: api.House): EmbedField {
  const points = row.points ? ` · ${amount(row.points, "event points")}` : "";
  return {
    name: `${roleWord(row.role)} · ${row.kind}`,
    value: `${whoOf(row)}: ${logWords(row.what, h)}${points} · <t:${Math.floor(row.at / 1000)}:R>`,
  };
}

/** A page of the public log (GDD 14.8), newest first; page 0 is the newest. */
export function logCard(
  h: api.House,
  rows: readonly api.LogRow[],
  page: number,
  role: Role,
  v: number,
): Card {
  const newest = [...rows].reverse();
  const pages = Math.max(1, Math.ceil(newest.length / LOG_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const shown = newest.slice(p * LOG_PAGE, (p + 1) * LOG_PAGE);
  return {
    context: role === "admin" ? ADMIN_CONSOLE : STAFF_CONSOLE,
    author: authorLine("Public log", h.label || "this server"),
    title: shown.length ? "Every staff and admin action here" : "Nothing logged yet",
    picture: "form",
    fields: shown.map((r) => logField(r, h)),
    footer: "Newest first; the log channel shows each row as it happens",
    colour: COLOUR.ash,
    rows: [
      {
        buttons: [
          btn("Older", "hs-log", String(p + 1), v, { disabled: p + 1 >= pages }),
          btn("Newer", "hs-log", String(p - 1), v, { disabled: p === 0 }),
          btn("Console", role === "admin" ? "admin" : "staff", "", v),
        ],
      },
    ],
  };
}

/** One log row as the log channel shows it. */
export function logRowCard(row: api.LogRow, h?: api.House): Card {
  const f = logField(row, h);
  return {
    context: LOG_CHANNEL,
    author: authorLine("Public log", h?.label || "this server"),
    title: `${roleWord(row.role)}: ${logWords(row.what, h)}`.slice(0, 256),
    description: f.value,
    picture: "form",
    footer: "Every staff and admin action on this server is logged",
    colour: row.role === "admin" ? COLOUR.hazard : COLOUR.signal,
    rows: [],
  };
}

// Server settings.

const KIND_WORDS: Record<ChannelKind, string> = {
  chronicle: "Chronicle",
  events: "Events",
  market: "Market",
  board: "Notice board",
  log: "Log",
};

export function isChannelKind(s: string): s is ChannelKind {
  return (CHANNEL_KINDS as readonly string[]).includes(s);
}

function clock(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Quiet hours in words: "22:00 to 06:00 UTC", or none. */
export function quietWords(s: api.HouseSettings): string {
  const from = s.quietFrom ?? 0;
  const to = s.quietTo ?? 0;
  return from === to
    ? "None"
    : `${clock(from)} to ${clock(to)} UTC: alarm mentions wait, posts do not`;
}

/** "HH:MM" as minutes past midnight, or undefined. */
export function minutesOf(raw: string): number | undefined {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(raw);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : undefined;
}

export const QUIET_FROM = "from";
export const QUIET_TO = "to";

/** The quiet hours' modal: two times, both empty for none. */
export function quietModal(v: number): Modal {
  return {
    customId: encodeId("hs-quieted", "", v),
    title: "Quiet hours, in UTC",
    inputs: [
      { id: QUIET_FROM, label: "From (HH:MM, UTC; empty for none)", max: 5, required: false },
      { id: QUIET_TO, label: "To (HH:MM, UTC; empty for none)", max: 5, required: false },
    ],
  };
}

function rolesLine(ids: readonly string[] | undefined, none: string): string {
  return ids?.length ? ids.map((r) => `<@&${r}>`).join(", ") : none;
}

/** A role select that adds a role to the list, or takes it off. */
function roleToggle(
  action: "hs-srole" | "hs-arole",
  roles: readonly GuildThing[],
  on: readonly string[] | undefined,
  what: string,
  kind: ChannelKind,
  v: number,
): Row {
  const set = new Set(on ?? []);
  return {
    select: {
      customId: encodeId(action, kind, v),
      placeholder: `${what}: pick a role to add it or take it off`,
      options: roles
        .slice(0, SELECT_MOST)
        .map((r) =>
          option(
            r.name,
            r.id,
            set.has(r.id) ? `${what}: yes; pick to take it off` : "Pick to add it",
          ),
        ),
    },
  };
}

/** Server settings (GDD 14.7): channels, staff and alarm roles, names, narration and quiet hours. */
export function settingsCard(
  h: api.House,
  kind: ChannelKind,
  channels: readonly GuildThing[] | undefined,
  roles: readonly GuildThing[] | undefined,
  v: number,
  notice?: string,
): Card {
  const s = h.settings;
  const rows: Row[] = [
    {
      select: {
        customId: encodeId("hs-kind", kind, v),
        placeholder: "Which channel to set",
        options: CHANNEL_KINDS.map((k) => ({
          ...option(KIND_WORDS[k], k, channelIn(s, k) ? "Mapped here" : "The bot's default"),
          default: k === kind,
        })),
      },
    },
  ];
  if (channels?.length)
    rows.push({
      select: {
        customId: encodeId("hs-chan", kind, v),
        placeholder: `The ${KIND_WORDS[kind].toLowerCase()} channel`,
        options: [
          option("The bot's default channel", NONE),
          ...channels.slice(0, SELECT_MOST - 1).map((c) => ({
            ...option(`#${c.name}`, c.id),
            default: channelIn(s, kind) === c.id,
          })),
        ],
      },
    });
  if (roles?.length) {
    rows.push(roleToggle("hs-srole", roles, s.staffRoles, "Staff", kind, v));
    rows.push(roleToggle("hs-arole", roles, s.alarmRoles, "Alarm", kind, v));
  }
  rows.push({
    buttons: [
      btn(s.hideNames ? "Show player names" : "Hide player names", "hs-names", kind, v),
      btn(s.narrated ? "Stop narrating" : "Narrate", "hs-narr", kind, v),
      btn("Quiet hours…", "hs-quiet", kind, v),
      btn("Console", "admin", "", v),
    ],
  });
  const channelLines = CHANNEL_KINDS.map((k) => {
    const id = channelIn(s, k);
    return `${KIND_WORDS[k]}: ${id ? `<#${id}>` : "the bot's default"}`;
  });
  return {
    context: ADMIN_CONSOLE,
    author: authorLine("Server settings", h.label || "this server"),
    title: notice ?? "What this server sees",
    description: channels?.length
      ? "Each change is saved at once; settings change only what this server sees."
      : "Open this from /admin in the server to pick its channels and roles.",
    picture: "form",
    fields: [
      { name: "Channels", value: channelLines.join("\n") },
      {
        name: "Staff roles",
        value: rolesLine(s.staffRoles, "Members with Moderate Members only"),
        inline: true,
      },
      { name: "Alarm roles", value: rolesLine(s.alarmRoles, "The bot's alarm role"), inline: true },
      {
        name: "Player names",
        value: s.hideNames ? "Hidden: each reads as its plain name here" : "Shown as written",
        inline: true,
      },
      {
        name: "Narration",
        value: s.narrated ? "On, where the model is on" : "Off: every card is its template",
        inline: true,
      },
      { name: "Quiet hours", value: quietWords(s) },
    ],
    footer: "A staff role also needs /staff opened to it in Server Settings, Integrations",
    colour: COLOUR.hazard,
    rows: rows.slice(0, 5),
  };
}

// The admin's pins.

export const PIN_FIELDS = ["landmark", "site-kind", "ground"] as const;
export type PinField = (typeof PIN_FIELDS)[number];
const PIN_SHEETS: Record<PinField, string> = {
  landmark: "map.landmarks",
  "site-kind": "map.site-kinds",
  ground: "map.terrain",
};
const PIN_WORDS: Record<PinField, string> = {
  landmark: "A landmark",
  "site-kind": "A site's kind",
  ground: "Its ground (terrain, with its ring)",
};

export interface PinDraft {
  settlement: number;
  site: string;
  field: PinField;
  row: string;
}

export function pinDraftId(d: PinDraft): string {
  return target(".", d.settlement, d.site, d.field, d.row);
}

export function pinDraftOf(raw: string): PinDraft | null {
  const f = fields(raw, ".", 4);
  if (!f) return null;
  const settlement = integerTarget(f[0]!);
  if (settlement === undefined || !(PIN_FIELDS as readonly string[]).includes(f[2]!)) return null;
  if (f[1] !== NONE && !hexOf(f[1]!)) return null;
  return { settlement, site: f[1]!, field: f[2] as PinField, row: f[3]! };
}

export function blankPin(h: api.House): PinDraft {
  const first = h.settlements.find((s) => s.n === h.arrival) ?? h.settlements[0];
  return { settlement: first?.n ?? -1, site: NONE, field: "landmark", row: NONE };
}

/** The rows a pin may fix, from the world's lexicon: a sheet's rows and their names, by name. */
export function pinRows(lexicon: api.Lexicon, field: PinField): GuildThing[] {
  const prefix = `${PIN_SHEETS[field]}:`;
  return Object.entries(lexicon.names)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, name]) => ({ id: k.slice(prefix.length), name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A pin draft as the world's order. */
export function pinOrder(d: PinDraft): api.PinOrder | null {
  const at = hexOf(d.site);
  if (!at || d.row === NONE) return null;
  const fix: api.PinFix =
    d.field === "landmark"
      ? { landmark: d.row }
      : d.field === "site-kind"
        ? { siteKind: d.row }
        : { ground: { terrain: d.row, ring: true } };
  return { at, fix };
}

/** The admin's pin form (GDD 14.5): a tile near a settlement the server runs, and what it fixes there. */
export function pinsForm(
  h: api.House,
  d: PinDraft,
  rowsOf: readonly GuildThing[],
  v: number,
  notice?: string,
): Card {
  const s = h.settlements.find((x) => x.n === d.settlement);
  const id = pinDraftId(d);
  const rows: Row[] = [];
  if (h.settlements.length > 1)
    rows.push({
      select: {
        customId: encodeId("hs-pset", id, v),
        placeholder: "Near which settlement",
        options: h.settlements.slice(0, SELECT_MOST).map((x) => ({
          ...option(x.name, String(x.n), x.region),
          default: x.n === d.settlement,
        })),
      },
    });
  if (s?.sites.length)
    rows.push({
      select: {
        customId: encodeId("hs-ptile", id, v),
        placeholder: "Which tile",
        options: s.sites.slice(0, SELECT_MOST).map((x) => ({
          ...option(x.name, `${x.at.q},${x.at.r}`),
          default: `${x.at.q},${x.at.r}` === d.site,
        })),
      },
    });
  rows.push({
    select: {
      customId: encodeId("hs-pfield", id, v),
      placeholder: "What the pin fixes",
      options: PIN_FIELDS.map((f) => ({ ...option(PIN_WORDS[f], f), default: f === d.field })),
    },
  });
  if (rowsOf.length)
    rows.push({
      select: {
        customId: encodeId("hs-prow", id, v),
        placeholder: `Which ${PIN_WORDS[d.field].toLowerCase().replace(/^an? /, "")}`,
        options: rowsOf
          .slice(0, SELECT_MOST)
          .map((x) => ({ ...option(x.name, x.id), default: x.id === d.row })),
      },
    });
  rows.push({
    buttons: [
      btn("Pin it", "hs-pin", id, v, { style: "success", disabled: !pinOrder(d) }),
      btn("Withdraw a pin", "hs-pinls", "", v, { disabled: !pending(h).length }),
      btn("Console", "admin", "", v),
    ],
  });
  const site = s?.sites.find((x) => `${x.at.q},${x.at.r}` === d.site);
  const picked = rowsOf.find((x) => x.id === d.row);
  return {
    context: ADMIN_CONSOLE,
    author: authorLine("Pin a tile", h.label || "this server"),
    title: notice ?? "Pin a tile in the server's region",
    description: "A pin waits on a tile nobody has reached and lands when someone first does.",
    picture: "form",
    fields: [
      { name: "Tile", value: site ? `${site.name}, near ${s!.name}` : "None picked", inline: true },
      {
        name: "Fixes",
        value: picked ? `${PIN_WORDS[d.field]}: ${picked.name}` : "Nothing picked",
        inline: true,
      },
      { name: "Cost", value: "Nothing: admins pin free, one pin a day for the server" },
    ],
    footer: "The world refuses a pin that would break a route or a reached tile",
    colour: COLOUR.hazard,
    rows: rows.slice(0, 5),
  };
}

/** The server's pins still to land: the only ones a withdraw can take back. */
function pending(h: api.House): api.Pin[] {
  return (h.pins ?? []).filter((p) => !p.landed && !p.withdrawn);
}

/** What a pin fixes, by its row's name. */
function pinFixWords(p: api.Pin, lex: Lexicon): string {
  const f = p.fix;
  if (f.landmark) return `${PIN_WORDS.landmark}: ${lex.name(PIN_SHEETS.landmark, f.landmark)}`;
  if (f.siteKind)
    return `${PIN_WORDS["site-kind"]}: ${lex.name(PIN_SHEETS["site-kind"], f.siteKind)}`;
  if (f.ground?.terrain) return `Its ground: ${lex.name(PIN_SHEETS.ground, f.ground.terrain)}`;
  return "Another fix";
}

/** The tile a pin waits on, by the name the house's sites give it. */
function pinTileWords(h: api.House, p: api.Pin): string {
  for (const s of h.settlements) {
    const site = s.sites.find((x) => x.at.q === p.at.q && x.at.r === p.at.r);
    if (site) return `${site.name}, near ${s.name}`;
  }
  return "A tile in the server's region";
}

/** The admin's pins still to land, each one a withdraw away. */
export function pinsPlaced(h: api.House, lex: Lexicon, v: number, notice?: string): Card {
  const pins = pending(h);
  const rows: Row[] = [];
  if (pins.length)
    rows.push({
      select: {
        customId: encodeId("hs-unpin", "", v),
        placeholder: "Which pin to withdraw",
        options: pins
          .slice(0, SELECT_MOST)
          .map((p) => option(pinFixWords(p, lex), p.id, pinTileWords(h, p))),
      },
    });
  rows.push({ buttons: [btn("Pin a tile", "hs-pins", "", v), btn("Console", "admin", "", v)] });
  return {
    context: ADMIN_CONSOLE,
    author: authorLine("Pins", h.label || "this server"),
    title: notice ?? (pins.length ? "Withdraw a pin before it lands" : "No pin is waiting to land"),
    description: "A withdrawn pin leaves its tile to the world's own draw.",
    picture: "form",
    fields: pins.slice(0, SELECT_MOST).map((p) => ({
      name: pinTileWords(h, p),
      value: pinFixWords(p, lex),
    })),
    footer: "A pin that has landed stays",
    colour: COLOUR.hazard,
    rows,
  };
}

// Reports.

/** A reported card's ref as its select carries it: a name ref, or p/<channel>/<message> for a post. */
export function reportTarget(ref: string): string {
  return ref.replace(/\|/g, "");
}

/** The ref a report names, a post's expanded to its message link in the guild. */
export function reportRef(raw: string, guild: string | undefined): string | null {
  if (raw.startsWith("p/")) {
    const f = fields(raw.slice(2), "/", 2);
    if (!f || !guild || !f.every((x) => /^\d{1,20}$/.test(x))) return null;
    return `post:https://discord.com/channels/${guild}/${f[0]}/${f[1]}`;
  }
  return /^(character|guild|settlement|dungeon|kind|promotion|goal):[^\s]+$/.test(raw) ? raw : null;
}

/** The report a member files from a card's menu: why, from five reasons, and no text. */
export function reportForm(raw: string, v: number, notice?: string): Card {
  const about = raw.startsWith("p/") ? "this card" : refWords(raw, undefined, true);
  return {
    context: REPORT_CONTEXT,
    author: "Report",
    title: notice ?? "Report this card",
    description: `About ${about}. Pick why; the server's staff read reports, and no text is sent.`,
    picture: "form",
    footer: "A report changes nothing until staff act on it",
    colour: COLOUR.rust,
    rows: [
      ...(notice
        ? []
        : [
            {
              select: {
                customId: encodeId("rpt", reportTarget(raw), v),
                placeholder: "Why are you reporting it?",
                options: REASONS.map((r) => option(REASON_WORDS[r], r)),
              },
            },
          ]),
      { buttons: [back(v)] },
    ],
  };
}

export function isReason(s: string): s is (typeof REASONS)[number] {
  return (REASONS as readonly string[]).includes(s);
}
