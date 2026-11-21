import { Unseen, type PuzzleClue, type PuzzleLayout } from "../../api.ts";
import fuse from "../../scenes/fuse/index.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { plural } from "../../units.ts";
import { PartyBar, familyHost, seatName } from "../wrap.ts";
import type { BombSquadModel } from "./model.ts";

const seen = (c: PuzzleClue | undefined) =>
  c !== undefined && c.before !== Unseen && c.after !== Unseen;

/**
 * The clue cards a seat holds: those it was dealt, and those a glimpse of
 * the next seat's part shows; the cards it is not shown are left off.
 */
export function dealt(layout: PuzzleLayout, glimpse?: PuzzleLayout): PuzzleLayout {
  const more = glimpse?.clues ?? [];
  const clues = (layout.clues ?? []).flatMap((c, i) =>
    seen(c) ? [c] : seen(more[i]) ? [more[i]!] : [],
  );
  return { ...layout, clues };
}

/** The fuse box with this seat's dealt clue cards; the cutters are live only on the holder. */
export function mount(host: PartySceneHost): Scene {
  const merged = () => host.model as BombSquadModel;
  const pass = host.layout.pass ?? 0;
  const cut = dealt(host.layout, host.glimpse);
  const box = fuse.mount(
    familyHost(host, {
      model: () => merged(),
      layout: cut,
      mine: () => merged().cutter() === host.seat,
    }),
  );
  const bar = new PartyBar(
    host,
    `A fuse box for ${plural(host.seats, "seat")}. You hold ${plural(cut.clues?.length ?? 0, "clue")}; one seat at a time holds the cutters and pulls while the others read theirs out.`,
  );

  function line(m: BombSquadModel): string {
    const left = pass > 0 ? pass - (m.k % pass) : 0;
    const then = pass > 0 ? ` · pass in ${plural(left, "fuse")}` : "";
    if (m.cutter() === host.seat) return `You hold the cutters${then}`;
    return `${seatName(m.cutter())} cuts: read your clues${then}`;
  }

  return {
    frame(at) {
      box.frame(at);
      bar.fit();
      const m = merged();
      bar.say(line(m));
      for (let s = 0; s < host.seats; s++) bar.light(s, s === m.cutter(), "holds");
    },
    destroy() {
      box.destroy();
      bar.remove();
    },
  };
}
