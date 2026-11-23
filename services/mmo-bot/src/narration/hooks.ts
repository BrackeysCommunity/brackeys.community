import { describe } from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import type { Card } from "../card.ts";

/**
 * Where narration meets the cards. Every hook is handed the template and
 * returns it unless the pipeline gives back checked text, so a caller never
 * has to know whether a model ran (GDD 15.3).
 */
export interface Narration {
  chronicle(
    ch: api.Chronicle,
    server: string,
    mode: "post" | "cached",
    template: () => Card,
  ): Promise<Card>;
  event(
    e: api.StoryEvent,
    server: string,
    mode: "post" | "cached",
    template: () => Card,
  ): Promise<Card>;
  recap(r: api.Recap, user: string, server: string, template: () => Card): Promise<Card>;
  talk(
    conv: api.Conversation,
    user: string,
    server: string,
  ): Promise<{ conv: api.Conversation; remembers?: string }>;
  wantsDossier(user: string, server: string): Promise<boolean>;
}

/** Templates, unchanged conversations, no dossier: the game as it is with every model use off. */
export const offNarration: Narration = {
  chronicle: async (_ch, _server, _mode, template) => template(),
  event: async (_e, _server, _mode, template) => template(),
  recap: async (_r, _user, _server, template) => template(),
  talk: async (conv) => ({ conv }),
  wantsDossier: async () => false,
};

/**
 * A Narration from the parts given, the rest from offNarration. A part
 * that throws gives what offNarration would, so narration can never break
 * a press or a post.
 */
export function createNarration(
  parts: Partial<Narration>,
  log: (line: string) => void = console.warn,
): Narration {
  const guard =
    <A extends unknown[], R>(
      hook: string,
      f: (...a: A) => Promise<R>,
      off: (...a: A) => Promise<R>,
    ) =>
    async (...a: A): Promise<R> => {
      try {
        return await f(...a);
      } catch (e) {
        log(`[narration] ${hook}: ${describe(e)}`);
        return off(...a);
      }
    };
  const off = offNarration;
  const { chronicle, event, recap, talk, wantsDossier } = parts;
  return {
    chronicle: chronicle ? guard("chronicle", chronicle, off.chronicle) : off.chronicle,
    event: event ? guard("event", event, off.event) : off.event,
    recap: recap ? guard("recap", recap, off.recap) : off.recap,
    talk: talk ? guard("talk", talk, off.talk) : off.talk,
    wantsDossier: wantsDossier
      ? guard("wantsDossier", wantsDossier, off.wantsDossier)
      : off.wantsDossier,
  };
}

/**
 * The world day the bot last heard of, for accounting the uses that carry
 * no day of their own: the newest day any response carried, where a closed
 * chronicle day d counts as d + 1.
 */
export interface DayClock {
  today(): number;
  saw(day: number): void;
}

export function dayClock(start = 0): DayClock {
  let day = start;
  return {
    today: () => day,
    saw(d) {
      if (Number.isSafeInteger(d) && d > day) day = d;
    },
  };
}
