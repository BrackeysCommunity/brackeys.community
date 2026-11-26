import { buttonRows } from "../../../../packages/discord-kit/src/index.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { btn } from "./common.ts";

/**
 * /forget-me (GDD 14.9): what leaving the world takes and what it keeps,
 * asked once before the world is told, then what was done.
 */

const CONTEXT = "Only you can see this";

/** The days within which everything a forget removes is gone (GDD 14.9). */
const WITHIN_DAYS = 7;
/** The days a backup taken before the forget keeps the id at most. */
const BACKUP_DAYS = 90;

/** The question before a forget: a press of Confirm tells the world. */
export function forgetAskCard(version: number, notice?: string): Card {
  return {
    context: CONTEXT,
    author: authorLine("Leaving", "forget me"),
    title: notice ?? "Forget you and your character?",
    description:
      "The world stops knowing you. Your character stays in its history as a traveller nobody can name, and plays no more. This cannot be undone.",
    picture: "form",
    fields: [
      {
        name: "What goes",
        value: [
          "Your Discord user id, from your character and every server's house log.",
          "What your character holds: goods go to the pool of the tile it stands on, coin leaves the world, and its open orders, goal rewards, party and guild are withdrawn.",
          "The bot's own notes of you: its press limit, narration counts, names held for review and party threads.",
        ].join("\n"),
      },
      {
        name: "What stays, as a traveller",
        value: [
          'What your character did: its deeds in the chronicle, the kinds it made first, what people remember of it. It is shown as "a traveller", never by name.',
          "Cards a server's channels already show stay that server's.",
        ].join("\n"),
      },
      {
        name: "When",
        value: `Your id goes at once. Its holdings leave at the first tick it is free of a fight or a carry, and everything here is gone within ${WITHIN_DAYS} days.`,
      },
    ],
    footer: "Forgetting cannot be undone. You may start a new character afterwards.",
    rows: buttonRows([
      btn("Confirm: forget me", "forget", "yes", version, { style: "danger" }),
      btn("Keep my character", "hub", "", version, { emoji: "↩" }),
    ]),
    colour: COLOUR.rust,
  };
}

/**
 * After a forget. character says the world held a character to forget;
 * cleared says the bot's own notes went too.
 */
export function forgetDoneCard(character: boolean, cleared: boolean): Card {
  const world = character
    ? "The world no longer knows your Discord user id. Your character is a traveller now: its holdings leave it at the first tick it is free."
    : "The world holds no character of yours.";
  const bot = cleared
    ? "The bot's own notes of you are cleared."
    : "The bot could not clear its own notes of you just now: run /forget-me again to finish.";
  return {
    context: CONTEXT,
    author: authorLine("Leaving", character ? "forgotten" : "nothing to forget"),
    title: character ? "You are forgotten" : "Nothing of yours to forget",
    description: `${world} ${bot}`,
    picture: "form",
    fields: character
      ? [
          {
            name: "Backups",
            value: `Backups taken before now keep your id until they roll off, ${BACKUP_DAYS} days at most.`,
          },
        ]
      : [],
    footer: "Use /play to start a new character.",
    rows: [],
    colour: COLOUR.ash,
  };
}
