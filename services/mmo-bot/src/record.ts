import { CondDown } from "./api.ts";
import type { World } from "./world.ts";

/**
 * A World that keeps a sample of every read it passes on, for the card
 * test's fixtures: the latest of each, and of options also the latest
 * taken in a fight, on the road and down.
 */
export function recording(world: World, samples: Record<string, unknown>): World {
  const keep = <T>(name: string, v: T): T => {
    samples[name] = v;
    return v;
  };
  return {
    ...world,
    act: async (req) => keep(`act:${req.kind}`, await world.act(req)),
    options: async (id) => {
      const o = await world.options(id);
      if (o.fight) samples["options:fight"] = o;
      else if (o.long?.kind === "travel") samples["options:travel"] = o;
      else if (o.conditions.includes(CondDown)) samples["options:down"] = o;
      else samples.options = o;
      return o;
    },
    sheet: async (id) => keep("sheet", await world.sheet(id)),
    here: async (id) => keep("here", await world.here(id)),
    map: async (id, r) => keep("map", await world.map(id, r)),
    appraise: async (req) => {
      const result = await world.appraise(req);
      if (result.ok) keep("appraise", result.reply);
      return result;
    },
    recipes: async (id) => keep("recipes", await world.recipes(id)),
    recap: async (id) => {
      const r = await world.recap(id);
      if (r.lines.length) samples.recap = r;
      return r;
    },
    npc: async (id, n) => {
      const result = await world.npc(id, n);
      if (result.ok) keep("npc", result.reply);
      return result;
    },
    lexicon: async () => keep("lexicon", await world.lexicon()),
    market: async (id, m) => {
      const result = await world.market(id, m);
      if (result.ok) keep("market", result.reply);
      return result;
    },
    history: async (id, m) => {
      const result = await world.history(id, m);
      if (result.ok) keep("history", result.reply);
      return result;
    },
    routeRisk: async (id, to) => {
      const result = await world.routeRisk(id, to);
      if (result.ok) keep("routeRisk", result.reply);
      return result;
    },
    forum: async () => keep("forum", await world.forum()),
  };
}
