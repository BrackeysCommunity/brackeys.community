import type { Answer } from "../flow.ts";
import { back, PRIVATE } from "./common.ts";

/** Cards for presses the bot no longer knows. */
export const backCards = {
  unknown(character: string): Answer {
    return {
      character,
      card: {
        context: PRIVATE,
        author: "An old button",
        title: "That button belongs to an older card",
        picture: "form",
        footer: "Open the hub again with /play.",
        rows: [{ buttons: [back(0)] }],
      },
    };
  },
};
