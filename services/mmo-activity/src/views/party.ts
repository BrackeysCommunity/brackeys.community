import type { ActivityState, PartyMember, PartyResult, PartyView } from "../api.ts";
import { el, lines, panel } from "../dom.ts";
import { band, seconds } from "../units.ts";
import { name } from "../words.ts";

export type { PartyPress, PartyResult } from "../api.ts";

/** The last resolved beat a party view names, when there is one. */
export function partyResult(p: PartyView | undefined): PartyResult | undefined {
  return p?.last;
}

/** Each press of a resolved beat as one line. */
export function partyResultLines(r: PartyResult): string[] {
  return r.pressed.map(
    (p) =>
      `${p.name}: ${name("fights.options", p.option)} at ${band(p.band).toLowerCase()}, ${p.success ? "it worked" : "it failed"}.`,
  );
}

/**
 * What is left of a pick window by the server's clock, or that it has
 * closed. what says what the window is for: "to pick", "to choose".
 */
export function windowLine(due: number, now: number, what: string): string {
  const left = due - now;
  if (left <= 0) return "The window has closed. The world is settling it for everyone.";
  return `${seconds(left)} left ${what}. Whoever has not chosen by then takes the cautious choice.`;
}

/**
 * A window's line, kept live: the app reads data-due and data-what on
 * every tick of its clock and writes the line again.
 */
export function windowNode(due: number, now: number, what: string): HTMLElement {
  return el("p", {
    class: "due",
    text: windowLine(due, now, what),
    attrs: { "data-due": String(due), "data-what": what, role: "timer" },
  });
}

/** One member as the rest of the party is shown them: never what they picked. */
export function memberLine(m: PartyMember, up?: boolean): string {
  const where = m.here ? "here" : m.floor ? `on ${up ? "level" : "floor"} ${m.floor}` : "elsewhere";
  const parts = [where];
  if (m.down) parts.push("down");
  if (m.seat >= 0) parts.push(m.picked ? "has chosen" : "still choosing");
  if (m.follows) parts.push("follows the leader");
  return `${m.you ? `${m.name} (you)` : m.name}: ${parts.join(", ")}.`;
}

/**
 * The viewer's party (GDD 7.5): who is in it, where each stands, who has chosen on the open beat.
 * Inviting, leaving and following are in chat.
 */
export function partyView(st: ActivityState): HTMLElement {
  const p = st.party!;
  const root = panel("Your party");
  root.append(
    ...lines(
      p.leader ? "You lead this party." : "",
      p.beat
        ? `On a beat together: ${p.beat.picked} of ${p.beat.present} members have chosen.`
        : "Not in an encounter together just now.",
    ),
  );
  const list = el("ul", { class: "why" });
  for (const m of p.members) list.append(el("li", { text: memberLine(m, st.floor?.up) }));
  root.append(list, ...lines("Invite, leave and follow from chat: press Party there."));
  return root;
}
