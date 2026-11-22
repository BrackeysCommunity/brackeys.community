import type { ActivityState, ChoiceView, FloorView, PartyMember, WayView } from "../api.ts";
import { button, el, lines, panel } from "../dom.ts";
import { svg } from "../shell/board.ts";
import {
  HERE_ROOM,
  UP_ROOM,
  WAY_ROOMS,
  centre,
  corners,
  ring,
  viewBox,
  type Axial,
} from "../shell/hex.ts";
import { plural } from "../units.ts";
import { goodsLine, name, placedLine, sentence } from "../words.ts";
import { windowNode } from "./party.ts";

export interface FloorActions {
  /** Pushes on by a way: "way-0" to "way-2". */
  push(way: string): void;
  leave(): void;
  openMachine(): void;
  busy: boolean;
  /** The server's clock, unix ms, for the fork's window. */
  now: number;
}

// structural: a room's inner radius on the map, in its own units, and a
// member token's.
const ROOM = 60;
const TOKEN = 9;

/** "floor 3", or "level 3" where a relay tower's floors go up. */
export function floorName(f: FloorView, n = f.floor): string {
  return `${f.up ? "level" : "floor"} ${n}`;
}

function tagLine(tags: string[]): string {
  return tags.map((t) => t.replace(/-/g, " ")).join(", ");
}

function wayVoters(way: WayView, choices: ChoiceView[]): string[] {
  return choices.filter((c) => c.push && c.way === way.id).map((c) => c.name);
}

/** One way down as its room says it: its name, its tags, what stands in it, the vote on it. */
export function wayLines(f: FloorView, w: WayView): string[] {
  const out = [sentence(w.name)];
  if (w.tags.length) out.push(sentence(tagLine(w.tags)));
  if (!w.open)
    out.push(w.machine ? `Behind a ${name("puzzles.families", w.machine).toLowerCase()}` : "Shut");
  if (w.next?.length) out.push(`Next: ${tagLine(w.next)}`);
  const voters = wayVoters(w, f.choices ?? []);
  out.push(
    voters.length ? `${plural(w.votes, "vote")}: ${voters.join(", ")}` : plural(w.votes, "vote"),
  );
  return out;
}

/** Every choice made at the fork, as it lands: who pushes on by which way, and who leaves. */
export function choiceLines(f: FloorView): string[] {
  const ways = new Map((f.ways ?? []).map((w) => [w.id, w.name]));
  return (f.choices ?? []).map((c) =>
    c.push
      ? `${c.name}: push on by ${sentence(ways.get(c.way ?? "") ?? "the open way").toLowerCase()}.`
      : `${c.name}: leave.`,
  );
}

// One room: its hex, its words, and the tokens of who stands in it.
function room(
  at: Axial,
  label: string[],
  opts: { cls: string; tokens?: string[]; you?: number; voted?: boolean; way?: string },
): SVGGElement {
  const c = centre(at, ROOM);
  const g = svg("g", { class: `room ${opts.cls}`, ...(opts.way ? { "data-way": opts.way } : {}) });
  const hex = svg("polygon", { points: corners(c, ROOM, 0.96) });
  hex.setAttribute(
    "style",
    `fill: var(--tar); stroke: var(${opts.voted ? "--signal" : opts.cls === "shut" ? "--rust" : "--line"}); stroke-width: 3`,
  );
  g.append(hex);
  const top = c.y - (label.length - 1) * 7 - (opts.tokens?.length ? 10 : 0);
  label.forEach((line, i) => {
    const t = svg("text", {
      x: c.x.toFixed(2),
      y: (top + i * 14).toFixed(2),
      "text-anchor": "middle",
      "font-size": i === 0 ? "12" : "10",
    });
    t.setAttribute("style", `fill: var(${i === 0 ? "--ash" : "--concrete"})`);
    t.textContent = line;
    g.append(t);
  });
  const tokens = opts.tokens ?? [];
  const spots = ring({ x: c.x, y: c.y + ROOM * 0.55 }, tokens.length, TOKEN * 1.6);
  tokens.forEach((who, i) => {
    const dot = svg("circle", {
      cx: spots[i]!.x.toFixed(2),
      cy: spots[i]!.y.toFixed(2),
      r: String(TOKEN),
      "aria-label": who,
    });
    dot.setAttribute("style", `fill: var(${i === opts.you ? "--hazard" : "--ash"})`);
    g.append(dot);
  });
  return g;
}

function presentHere(st: ActivityState): { names: string[]; you: number } {
  const members: PartyMember[] = st.party?.members ?? [];
  const here = members.filter((m) => m.here);
  if (!here.length) return { names: ["You"], you: 0 };
  return { names: here.map((m) => m.name), you: here.findIndex((m) => m.you) };
}

/**
 * The floor's rooms, drawn as hexes: the stair behind, the room the party
 * stands in with each member present, and each way down with its tags, its
 * machine, Mapper's look ahead and the votes on it as they land.
 */
export function floorMap(st: ActivityState): SVGSVGElement {
  const f = st.floor!;
  const ways = f.ways ?? [];
  const rooms: Axial[] = [UP_ROOM, HERE_ROOM, ...ways.map((w) => WAY_ROOMS[w.id] ?? HERE_ROOM)];
  const map = svg("svg", {
    class: "floor-map",
    viewBox: viewBox(rooms, ROOM, 6),
    role: "img",
    "aria-label": `The rooms of ${floorName(f)}`,
    width: "100%",
  });
  map.append(
    room(UP_ROOM, [f.floor > 1 ? `Back to ${floorName(f, f.floor - 1)}` : "The way out"], {
      cls: "up",
    }),
  );
  const here = presentHere(st);
  map.append(
    room(HERE_ROOM, [sentence(floorName(f)), f.haunted ? "Haunted" : ""].filter(Boolean), {
      cls: "here",
      tokens: here.names,
      you: here.you,
    }),
  );
  for (const w of ways) {
    const at = WAY_ROOMS[w.id];
    if (!at) continue;
    map.append(
      room(at, wayLines(f, w), {
        cls: w.open ? "open" : "shut",
        voted: wayVoters(w, f.choices ?? []).length > 0,
        way: w.id,
      }),
    );
  }
  return map;
}

function dungeonName(f: FloorView): string {
  return f.name || name("map.dungeons", f.kind);
}

/**
 * A dungeon floor (GDD 4.9): where the viewer stands and the deepest it
 * has reached, never how deep it goes; at a fork, the ways down and every
 * choice in the open, push or leave, inside the window.
 */
export function floorView(st: ActivityState, act: FloorActions): HTMLElement {
  const f = st.floor!;
  if (f.floor === 0) {
    return panel(
      `${dungeonName(f)}: the entrance`,
      ...lines(
        f.deepest
          ? `The deepest you have reached here: ${floorName(f, f.deepest)}.`
          : "You have not been down yet.",
        f.haunted ? "Too many have fallen here lately: it is haunted." : "",
        f.placed ? `${placedLine(f.placed)}.` : "",
        "Explore from chat to go in.",
      ),
    );
  }
  const root = panel(`${dungeonName(f)}: ${floorName(f)}`);
  root.append(
    ...lines(
      `The deepest you have reached here: ${floorName(f, f.deepest)}.`,
      f.bottom ? "This is the bottom." : "",
      f.haunted
        ? "Too many have fallen here lately: it is haunted. Shaken lasts longer, and what fell is easier to find."
        : "",
      f.downed?.length ? `Down on this floor: ${f.downed.join(", ")}.` : "",
      f.pool?.length ? `Your hoard sense finds what fell here: ${goodsLine(f.pool)}.` : "",
      f.placed ? `${placedLine(f.placed)}.` : "",
    ),
    floorMap(st),
  );
  const ways = f.ways ?? [];
  if (!ways.length) return root;
  const you = st.party?.members.find((m) => m.you)?.name;
  const chose = Boolean(you && (f.choices ?? []).some((c) => c.name === you));
  const said = choiceLines(f);
  root.append(
    el("h3", { text: "The fork" }),
    ...lines(
      said.length ? "Chosen so far:" : "Nobody has chosen yet. Only those who push on vote.",
      ...said,
    ),
  );
  if (f.due) root.append(windowNode(f.due, act.now, "to choose"));
  const row = el("div", { class: "actions" });
  for (const w of ways)
    if (w.open)
      row.append(
        button(`Push on by ${sentence(w.name).toLowerCase()}`, () => act.push(w.id), {
          disabled: act.busy || chose,
        }),
      );
  if (ways.some((w) => !w.open && w.machine) && st.machine)
    row.append(button("Work the machine", () => act.openMachine(), { main: true }));
  row.append(button("Leave the dungeon", () => act.leave(), { disabled: act.busy || chose }));
  root.append(row);
  if (chose)
    root.append(
      ...lines("You have chosen. The fork goes when everyone has, or the window closes."),
    );
  return root;
}
