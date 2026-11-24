import { expect, test } from "bun:test";

import * as api from "../src/api.ts";
import { answer, type Press } from "../src/flow.ts";
import type { Id } from "../src/ids.ts";
import type { World } from "../src/world.ts";
import { namingWorld, o, promotion, recap } from "./fixtures/mm11-naming.ts";

/** A world whose recap, like the server's, empties once looked at unless asked for one promotion. */
function lookingWorld(answersPromotion: boolean) {
  const base = namingWorld();
  let looked = false;
  const promoted = { ...recap, lines: recap.lines.filter((l) => l.promotion === promotion.id) };
  const world = {
    ...base.world,
    async recap(_id: string, asked?: string) {
      if (asked !== undefined)
        return asked === promotion.id && answersPromotion ? promoted : { ...recap, lines: [] };
      return looked ? { ...recap, lines: [] } : recap;
    },
    async act(req: api.ActionRequest) {
      if (req.kind === api.ActLook) looked = true;
      return base.world.act(req);
    },
  } as World;
  const ctx = { ...base.ctx, world };
  const press = (p: Pick<Press, "command" | "id">) =>
    answer(ctx, { ...p, user: "someone", guild: "guild", interaction: "event" });
  return { press };
}

const prName: Id = { action: "pr-name", target: promotion.id, version: o.version };

test("a promotion seen on /play can still be named after the look", async () => {
  const { press } = lookingWorld(true);
  const shown = (await press({ command: "play" })).card;
  expect(shown.author).not.toBe("Naming · something you were first of");
  const card = (await press({ id: prName })).card;
  expect(card.author).toBe("Naming · something you were first of");
  expect(card.title).toBe(`Name it: ${promotion.name}`);
});

test("a promotion the world no longer offers is not yours to name", async () => {
  const { press } = lookingWorld(false);
  await press({ command: "play" });
  const card = (await press({ id: prName })).card;
  expect(card.title).toBe("It is not yours to name now");
});
