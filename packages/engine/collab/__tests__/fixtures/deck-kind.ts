import { z } from "zod";

import { checkedTestGame } from "../../../__tests__/fixtures/test-game";
import { defineGame } from "../../../game/define";
import { defineAssetKind } from "../../../project/kinds";

/** A game's own kind, laid out with every declarative form. */
export const deckKind = defineAssetKind({
  kind: "test-game/deck",
  title: "Deck",
  description: "A test game's deck file.",
  match: { suffixes: [".deck.json"] },
  storage: "doc",
  version: 1,
  schemaId: "urn:test:test-game:deck:v1",
  schema: () =>
    z.strictObject({
      v: z.literal(1),
      title: z.string(),
      style: z.record(z.string(), z.unknown()),
      tags: z.array(z.string()),
      cards: z.array(z.looseObject({ id: z.string() })),
    }),
  layout: {
    as: "map",
    fields: {
      title: { as: "text" },
      style: { as: "map", rest: { as: "atomic" } },
      tags: { as: "list", item: { as: "atomic" } },
      cards: { as: "keyed", item: { as: "map", fields: { note: { as: "text" } } } },
    },
  },
  empty: () => ({ v: 1, title: "", style: {}, tags: [], cards: [] }),
});

/** The checked test game with the deck kind. */
export const deckGame = defineGame({ ...checkedTestGame, assetKinds: [deckKind] });
