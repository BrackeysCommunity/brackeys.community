import { CondDown } from "./api.ts";
import type { World, WorldReply } from "./world.ts";

/**
 * A World that keeps a sample of every read it passes on, for the card
 * test's fixtures: the latest of each, and of options also the latest
 * taken in a fight, on a machine beat, on the road and down.
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
    recap: async (id) => {
      const r = await world.recap(id);
      if (r.lines.length) samples.recap = r;
      return r;
    },
    npc: keepOk("npc", world.npc),
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
  };
}
