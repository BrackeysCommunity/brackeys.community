import { CondDown } from "./api.ts";
import type { World, WorldReply } from "./world.ts";

/**
 * A World that keeps a sample of every read it passes on, for the card
 * test's fixtures: the latest of each; for options also in a fight, on a
 * machine beat, on the road and down; for party also on a shared beat, at a
 * fork and with none; for npc also with a dossier; story reads only when
 * non-empty.
 */
export function recording(world: World, samples: Record<string, unknown>): World {
  const keep = <T>(name: string, v: T): T => {
    samples[name] = v;
    return v;
  };
  const keepOk =
    <A extends unknown[], T>(name: string, f: (...a: A) => Promise<WorldReply<T>>) =>
    async (...a: A): Promise<WorldReply<T>> => {
      const result = await f(...a);
      if (result.ok) keep(name, result.reply);
      return result;
    };
  return {
    ...world,
    act: async (req) => keep(`act:${req.kind}`, await world.act(req)),
    options: async (id) => {
      const o = await world.options(id);
      if (o.fight?.machine) samples["options:machine"] = o;
      else if (o.fight) samples["options:fight"] = o;
      else if (o.long?.kind === "travel") samples["options:travel"] = o;
      else if (o.conditions.includes(CondDown)) samples["options:down"] = o;
      else samples.options = o;
      return o;
    },
    sheet: async (id) => keep("sheet", await world.sheet(id)),
    here: async (id) => keep("here", await world.here(id)),
    map: async (id, r) => keep("map", await world.map(id, r)),
    appraise: keepOk("appraise", world.appraise),
    recipes: async (id) => keep("recipes", await world.recipes(id)),
    recap: async (id, promotion) => {
      const r = await world.recap(id, promotion);
      if (r.lines.length && !promotion) samples.recap = r;
      return r;
    },
    npc: async (id, npc, opts) => {
      const r = await world.npc(id, npc, opts);
      // The plain sample stays what a conversation without a dossier reads.
      if (r.ok) keep("dossier" in r.reply ? "npc:dossier" : "npc", r.reply);
      return r;
    },
    lexicon: async () => keep("lexicon", await world.lexicon()),
    market: keepOk("market", world.market),
    history: keepOk("history", world.history),
    routeRisk: keepOk("routeRisk", world.routeRisk),
    forum: async () => keep("forum", await world.forum()),
    goals: keepOk("goals", world.goals),
    board: async () => {
      const b = await world.board();
      if (b.posts.length) samples.board = b;
      return b;
    },
    guild: async (id) => {
      const g = await world.guild(id);
      return keep(g.id ? "guild" : "guild:none", g);
    },
    classes: async (id) => keep("classes", await world.classes(id)),
    party: async (id) => {
      const st = await world.party(id);
      return keep(
        st.fight?.shared
          ? "party:beat"
          : st.floor?.ways?.length
            ? "party:fork"
            : st.party
              ? "party"
              : "party:none",
        st,
      );
    },
    parties: async () => {
      const b = await world.parties();
      if (b.parties.length) samples.parties = b;
      return b;
    },
    hunts: async () => {
      const b = await world.hunts();
      if (b.hunts.length) samples.hunts = b;
      return b;
    },
    chronicle: keepOk("chronicle", world.chronicle),
    chronicleFact: keepOk("chronicleFact", world.chronicleFact),
    arcs: async (id) => {
      const a = await world.arcs(id);
      if (a.open.length) samples.arcs = a;
      return a;
    },
    storyEvents: async (after) => {
      const e = await world.storyEvents(after);
      if (e.events.length) samples.storyEvents = e;
      return e;
    },
    storyPromotions: async (after) => {
      const e = await world.storyPromotions(after);
      if (e.events.length) samples.storyPromotions = e;
      return e;
    },
  };
}
