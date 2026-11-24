import {
  type Button,
  buttonRows,
  type EmbedField,
  type Row,
} from "../../../../packages/discord-kit/src/index.ts";
import { riskLine } from "../../../../packages/mmo-words/src/index.ts";
import * as api from "../api.ts";
import { authorLine, type Card, COLOUR, type Picture } from "../card.ts";
import { encodeId } from "../ids.ts";
import { capitalise, type Lexicon } from "../lexicon.ts";
import { amount, band, bandShort, plural } from "../units.ts";
import type { PartyRead } from "../world.ts";
import {
  back,
  banner,
  btn,
  downButtons,
  factNum,
  factStr,
  launch,
  option,
  PRIVATE,
  relative,
} from "./common.ts";
import { dungeonName, floorOf, tagWords, wayLabel } from "./dungeon.ts";
import { adaptedTail, creatureName, poolLine, withPoolLine } from "./fight.ts";

/**
 * A party's cards (GDD 7.5): forming it, the beat each member picks on
 * privately, the beat resolved with every member's score and share, the
 * machine the party works together, and the one card its thread keeps.
 * Who has picked is shown, never what, until the beat resolves.
 */

/** Where a party thread's cards appear and who sees them. */
export const THREAD = "Party thread · every member sees this";

/** The "Time left" field of a beat's picks or a fork's choices; `who` takes the default, `idle` is how the unstarted clock reads. */
function timeLeftField(
  due: number | undefined,
  takes: string,
  opts: { waiting?: boolean; idle?: string; who?: string } = {},
): EmbedField {
  const { waiting, idle = "then", who = "Anyone who has not picked" } = opts;
  return {
    name: "Time left",
    value: waiting
      ? "The clock waits while the party's machine is armed."
      : due
        ? `${relative(due)}. ${who} then takes ${takes}.`
        : `The first pick starts the clock. ${who} ${idle} takes ${takes}.`,
  };
}

function memberLine(m: api.PartyMember, beat: boolean): string {
  const where = m.down
    ? "down"
    : m.here
      ? "here"
      : m.floor
        ? `on ${floorOf(m.floor)}`
        : "elsewhere";
  const picked = beat && m.seat >= 0 && !m.down ? (m.picked ? ", picked" : ", choosing") : "";
  return `${m.name}${m.you ? " (you)" : ""}: ${where}${picked}${m.follows ? ", following" : ""}`;
}

/** The party card: its members and where they are, who is in reach to invite, and the invitations held. */
export function partyCard(st: PartyRead, here: api.Here, lex: Lexicon, notice?: string): Card {
  const v = st.version;
  const p = st.party;
  const rows: Row[] = [];
  const fields: EmbedField[] = [];
  const invitable = st.reach.filter((r) => !r.inParty);
  if (p) {
    fields.push({
      name: "Members",
      value: p.members.map((m) => memberLine(m, !!p.beat)).join("\n"),
    });
    fields.push({
      name: "You",
      value: p.leader ? "lead the party" : "follow its leader's lead",
      inline: true,
    });
    const top: Button[] = [];
    if (st.fight?.shared) top.push(btn("To the beat", "p-card", p.id, v, { style: "primary" }));
    else if (st.floor?.ways?.length)
      top.push(btn("To the fork", "dungeon", "", v, { style: "primary" }));
    if (!p.leader) {
      const you = p.members.find((m) => m.you);
      top.push(
        you?.follows
          ? btn("Stop following", "p-unfollow", "", v)
          : btn("Follow the leader", "p-follow", "", v),
      );
    }
    top.push(
      btn("Leave the party", "p-leave", "", v, { style: "danger", disabled: !!st.fight?.shared }),
      back(v),
    );
    rows.push({ buttons: top });
  } else {
    if (st.invites.length) {
      fields.push({
        name: "Invitations",
        value: st.invites.map((x) => `${x.name}, until tick ${x.until}`).join("\n"),
      });
      rows.push({
        buttons: st.invites
          .slice(0, 4)
          .map((x) => btn(`Join ${x.name}`, "p-join", x.characterId, v, { style: "success" })),
      });
    }
    rows.push({ buttons: [back(v)] });
  }
  if (invitable.length)
    rows.unshift({
      select: {
        customId: encodeId("p-invite", "", v),
        placeholder: "Invite someone in reach",
        options: invitable.slice(0, 25).map((r) => option(r.name, r.characterId)),
      },
    });
  fields.push({
    name: "In reach",
    value: st.reach.length
      ? st.reach.map((r) => `${r.name}${r.inParty ? " (in a party)" : ""}`).join(", ")
      : "nobody on this tile or the next",
  });
  return {
    context: PRIVATE,
    author: authorLine("Party", p ? plural(p.members.length, "member") : "none yet"),
    title: notice ?? (p ? "Your party" : "You are not in a party"),
    description: p
      ? "The party plays in its own thread: one card there shows who has picked, and pressing it opens your own."
      : "Invite someone on your tile or the next; the party forms when they accept. An invitation lasts a few ticks.",
    picture: banner(here),
    fields,
    footer:
      "Everyone in a party on the tile when an encounter starts shares it, and splits the haul by what they did.",
    rows,
    colour: COLOUR.signal,
  };
}

/** A party beat as the presser's own card: every option with its band and risk, who has picked, and the time left. */
export function partyBeatCard(
  o: api.Options,
  here: api.Here,
  st: PartyRead,
  lex: Lexicon,
  notice?: string,
): Card {
  const f = o.fight!;
  const v = o.version;
  const beat = st.party?.beat;
  const creature = creatureName(f, lex);
  const kind = lex.name("fights.beats", f.kind);
  const cautious = lex.name("fights.options", beat?.cautious || "hold");
  const opts = f.options.filter((x) => !x.puzzle);
  const mine = beat?.mine;
  const buttons: Button[] = mine
    ? []
    : opts.map((x) =>
        btn(`${lex.name("fights.options", x.id)} · ${bandShort(x.band)}`, "p-pick", x.id, v, {
          style: x.kind === "win" ? "primary" : x.kind === "way-out" ? "secondary" : "success",
        }),
      );
  if (f.machine)
    buttons.unshift(
      btn(`The machine: ${lex.name("puzzles.families", f.machine)}`, "p-machine", "beat", v, {
        style: "success",
      }),
    );
  const lines = opts.map(
    (x) =>
      `**${lex.name("fights.options", x.id)}**: ${band(x.band)}, ${riskLine(x)}${adaptedTail(x)}`,
  );
  if (f.machine)
    lines.unshift(
      `**The machine**: ${lex.name("puzzles.families", f.machine)}, worked by everyone present together in the Activity`,
    );
  const members = f.party ?? st.party?.members ?? [];
  const fields: EmbedField[] = [
    { name: "Beat", value: `beat ${f.beat + 1} of ${amount(f.beats, "beats")}`, inline: true },
    { name: "Against", value: creature, inline: true },
    {
      name: "Where",
      value:
        f.floor && here.floor
          ? `${floorOf(f.floor, here.floor.up)} of ${dungeonName(here.floor, lex)}`
          : here.name,
      inline: true,
    },
    ...members.map((m) => ({
      name: m.name,
      value: m.down ? "Down" : m.picked ? "Picked" : m.seat < 0 ? "Not in this beat" : "Choosing",
      inline: true,
    })),
  ];
  fields.push(timeLeftField(beat?.due, cautious, { waiting: beat?.waiting, idle: "when it ends" }));
  const opening = mine
    ? `You picked **${lex.name("fights.options", mine)}**. ${beat ? `${beat.picked} of ${plural(beat.present, "member")} have picked.` : ""}\n\n`
    : "";
  return {
    context: PRIVATE,
    author: authorLine("Party beat", `beat ${f.beat + 1} of ${amount(f.beats, "beats")}`, kind),
    title: notice ?? `${kind}: ${creature}`,
    description: withPoolLine(
      poolLine(f, f.floor && here.floor ? dungeonName(here.floor, lex) : here.name, lex),
      `${opening}${lines.join("\n")}`,
    ),
    picture: banner(here, `; ${creature} in a ${kind.toLowerCase()}`),
    fields,
    footer:
      "Picks stay hidden until the beat resolves. Each member past the first makes it harder; the why view shows by how much.",
    rows: [
      ...buttonRows(buttons.slice(0, 10)),
      {
        buttons: [
          btn("Why these odds", "why", "options", v),
          btn("Party", "party", "", v),
          back(v),
        ],
      },
    ],
    colour: COLOUR.rust,
    modifiers: true,
    failable: mine
      ? []
      : opts.filter((x) => x.band !== "certain").map((x) => lex.name("fights.options", x.id)),
  };
}

/** One member's press on a resolved beat, from the facts it wrote. */
interface Scored {
  who: string;
  option: string;
  won: boolean;
  score: number;
}

/** The members' presses on the beat a press resolved: beat.won and beat.lost, one a member. */
export function scoresOf(facts: readonly api.Fact[]): Scored[] {
  return facts
    .filter((f) => f.kind === "beat.won" || f.kind === "beat.lost")
    .map((f) => ({
      who: f.subjects.find((s) => s.kind === "character")?.id ?? "",
      option: factStr(f, "option"),
      won: f.kind === "beat.won",
      score: factNum(f, "score"),
    }));
}

/**
 * Each member's share of a resolved beat, in percent: a won beat counts its
 * score, at least one, and a lost one nothing (GDD 7.5). The shares are cut
 * by largest remainder, so they sum to the whole.
 */
export function sharesOf(scored: readonly Scored[]): number[] {
  const weight = scored.map((s) => (s.won ? Math.max(1, s.score) : 0));
  const total = weight.reduce((a, b) => a + b, 0);
  if (!total) return scored.map(() => 0);
  const exact = weight.map((w) => (w * 100) / total);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

/**
 * A party beat resolved: every member's pick, whether it worked, its
 * score and its share of the beat, and the encounter's end if it ended.
 * The thread's copy carries no one's own buttons.
 */
export function beatResolvedCard(
  o: api.Options,
  here: api.Here,
  lex: Lexicon,
  facts: readonly api.Fact[],
  names: ReadonlyMap<string, string>,
  audience: "you" | "thread",
  party: string,
  carried?: number,
): Card {
  const v = o.version;
  const scored = scoresOf(facts);
  const shares = sharesOf(scored);
  const beat = facts.find((f) => f.kind === "party.beat");
  const end = facts.find((f) => f.kind.startsWith("encounter."));
  const result = end?.kind.slice("encounter.".length);
  const won = scored.filter((s) => s.won).length;
  const n = beat ? factNum(beat, "beat") : 0;
  const titles: Record<string, string> = {
    won: "The party won",
    lost: "The party lost",
    left: "The party backed out",
    held: "The party held",
    escaped: "It got away",
  };
  const fields: EmbedField[] = [];
  if (end) {
    fields.push({
      name: "Haul",
      value: `${amount(result === "lost" ? 0 : factNum(end, "haul"), "goods")}, split by contribution`,
      inline: true,
    });
    if (carried !== undefined)
      fields.push({ name: "Your share", value: amount(carried, "goods"), inline: true });
  }
  const buttons: Button[] = [];
  if (audience === "thread")
    buttons.push(btn("Open my card", "p-card", party, 0, { style: "primary" }));
  else {
    if (o.fight) buttons.push(btn("The next beat", "p-card", party, v, { style: "primary" }));
    else if (here.floor?.ways?.length)
      buttons.push(btn("To the fork", "dungeon", "", v, { style: "primary" }));
    if (o.conditions.includes(api.CondDown)) buttons.push(...downButtons(o, v));
    buttons.push(btn("Party", "party", "", v), back(v));
  }
  return {
    context: audience === "thread" ? THREAD : PRIVATE,
    author: authorLine("Party beat", n ? `beat ${n} resolved` : "resolved"),
    title: end
      ? (titles[result ?? ""] ?? "It is over")
      : `${won} of ${plural(scored.length, "member")} won the beat`,
    description:
      "Every pick is shown now the beat has resolved. A won beat scores for its member, and the haul is split by those scores.",
    picture: banner(here),
    table: {
      header: ["Member", "Pick", "Result", "Score (pts)", "Share (%)"],
      rows: scored.map((s, i) => [
        (names.get(s.who) ?? s.who).slice(0, 18),
        lex.name("fights.options", s.option).slice(0, 18),
        s.won ? "worked" : "failed",
        String(s.won ? s.score : 0),
        String(shares[i] ?? 0),
      ]),
    },
    fields,
    footer: "A member who goes down keeps a share only if the party wins the encounter.",
    rows: [{ buttons }],
    colour: result === "lost" ? COLOUR.rust : COLOUR.signal,
  };
}

/** The machine a party works together, and the launch into it. */
export function partyMachineCard(
  o: api.Options,
  here: api.Here,
  st: PartyRead,
  lex: Lexicon,
  source: "beat" | "fork",
): Card {
  const v = o.version;
  const fork = source === "fork" ? st.floor?.ways?.find((w) => w.machine && !w.open) : undefined;
  const family = fork?.machine ?? o.fight?.machine ?? "";
  const name = lex.name("puzzles.families", family);
  const members = (o.fight?.party ?? st.party?.members ?? []).filter((m) => m.here && !m.down);
  const seats = members.length || 1;
  return {
    context: PRIVATE,
    author: authorLine("Party machine", name, plural(seats, "seat")),
    title: `${name}: one machine, worked together`,
    description: fork
      ? `It stands across ${fork.name}. Solved, that way opens and its floor pays more; gone haywire, only the open way is left.`
      : "Solved, it is everyone's pick on this beat, and each seat that moved on it shares the credit.",
    picture: banner(here, `; ${name}`),
    fields: [
      { name: "Seats", value: members.map((m) => m.name).join(", ") || "you alone" },
      {
        name: "Arming",
        value:
          "It arms when every member present has the Activity open; the first touch starts the countdown for all of you.",
      },
    ],
    footer:
      "Every machine is worked in the Activity. The best practice among the seats sets the clock.",
    rows: [
      {
        buttons: [
          launch(`Work the machine: ${name}`, "party", v),
          btn("Party", "party", "", v),
          back(v),
        ],
      },
    ],
    colour: COLOUR.signal,
  };
}

/** The picture a party's thread card carries: the place its party was last seen pressing from. */
export interface ThreadPicture {
  media: string;
  place: string;
}

function threadPicture(p?: ThreadPicture): Picture | "form" {
  return p ? { media: p.media, alt: `Banner of ${p.place}` } : "form";
}

/** The one card a party's thread keeps: the beat or the fork, who has picked or chosen, never what, and the time left. */
export function threadCard(b: api.PartyBoard, lex: Lexicon, picture?: ThreadPicture): Card {
  const names = b.members.map((m) => m.name);
  const fields: EmbedField[] = b.members.map((m) => ({
    name: m.name,
    value: m.down
      ? "Down"
      : b.beat
        ? m.picked
          ? "Picked"
          : "Choosing"
        : b.fork
          ? m.chose
            ? "Chose"
            : "Choosing"
          : "Ready",
    inline: true,
  }));
  const card: Card = {
    context: THREAD,
    author: authorLine("Party", plural(b.members.length, "member")),
    title: names.join(", "),
    description: "Between encounters. Explore together and the party shares the encounter.",
    picture: threadPicture(picture),
    fields,
    footer: "Pressing below opens your own card; nobody else sees it.",
    rows: [{ buttons: [btn("Open my card", "p-card", b.id, 0, { style: "primary" })] }],
    colour: COLOUR.signal,
  };
  if (b.beat) {
    const kind = lex.name("fights.beats", b.beat.kind);
    const cautious = lex.name("fights.options", b.beat.cautious || "hold");
    card.author = authorLine(
      "Party",
      `beat ${b.beat.beat} of ${amount(b.beat.beats, "beats")}`,
      kind,
    );
    card.title = `${kind}: everyone picks`;
    card.description = `The beat resolves when all ${plural(b.beat.present, "member")} have picked or the time runs out.`;
    fields.push(timeLeftField(b.due, cautious, { waiting: b.beat.waiting }));
    card.footer = "Picks stay hidden until the beat resolves.";
    card.rows = [{ buttons: [btn("Pick", "p-card", b.id, 0, { style: "primary" })] }];
    card.colour = COLOUR.rust;
  } else if (b.fork) {
    const f = b.fork;
    const ways = f.ways;
    card.author = authorLine("Party", floorOf(f.floor, f.up), "the fork");
    card.title = capitalise(`${floorOf(f.floor, f.up)} of ${dungeonName(f, lex)} cleared`);
    card.description = "Each member pushes, naming a way, or leaves. Only those who push vote.";
    for (const w of ways)
      fields.push({
        name: wayLabel(w, ways),
        value: `${tagWords(w.tags)} · ${w.open ? "open" : "closed"} · ${plural(w.votes, "vote")}`,
      });
    fields.push(
      timeLeftField(b.due, "the default", { waiting: f.waiting, who: "Whoever has not chosen" }),
    );
    card.footer = "Choices at a fork are open.";
    card.rows = [{ buttons: [btn("Choose a way", "p-card", b.id, 0, { style: "primary" })] }];
    card.colour = COLOUR.hazard;
  }
  return card;
}

/** A thread's card once its party has ended. */
export function threadEndedCard(picture?: ThreadPicture): Card {
  return {
    context: THREAD,
    author: "Party · ended",
    title: "The party has ended",
    description: "Its members go on alone. /party forms a new one, with a thread of its own.",
    picture: threadPicture(picture),
    footer: "This thread is archived; what was split stays with whoever it paid.",
    rows: [],
    colour: COLOUR.ash,
  };
}

/** Past the server's thread budget the party plays on in these cards, and says so. */
export function withThreadSoon(card: Card): Card {
  return {
    ...card,
    fields: [
      ...(card.fields ?? []),
      {
        name: "Party thread",
        value:
          "It opens soon: the server has opened many threads lately. Play on in these cards meanwhile.",
      },
    ],
  };
}
