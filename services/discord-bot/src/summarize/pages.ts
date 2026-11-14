import { randomBytes } from "node:crypto";

import { EMBED_DESCRIPTION_MAX } from "../reply.ts";
import { type SummaryRedis, generationKey } from "./summarizer.ts";

/** A reply too long for one message, kept so its buttons can turn pages. */
export interface PageSet {
  channelId: string;
  title: string;
  footer: string;
  pages: string[];
}

export interface SummaryPages {
  /** The token its buttons carry, or null when the set couldn't be kept. */
  save(set: PageSet): Promise<string | null>;
  /** Null once it has expired, or after a deletion in its channel. */
  load(token: string): Promise<PageSet | null>;
}

/** Long enough to read a private reply through; derived text only, like the caches. */
const PAGES_TTL_SECONDS = 6 * 3_600;

const pagesKey = (token: string) => `summarize:pages:${token}`;

export function createSummaryPages(redis: SummaryRedis): SummaryPages {
  const generation = async (channelId: string) =>
    (await redis.get(generationKey(channelId))) ?? "0";

  return {
    async save(set) {
      try {
        const token = randomBytes(9).toString("base64url");
        const stored = { ...set, generation: await generation(set.channelId) };
        await redis.set(pagesKey(token), JSON.stringify(stored), "EX", PAGES_TTL_SECONDS);
        return token;
      } catch {
        return null;
      }
    },
    async load(token) {
      try {
        const raw = await redis.get(pagesKey(token));
        if (!raw) return null;
        const { generation: saved, ...set } = JSON.parse(raw) as PageSet & { generation: string };
        // A deletion drops every cached summary of the channel; its pages go with them.
        return saved === (await generation(set.channelId)) ? set : null;
      } catch {
        return null;
      }
    },
  };
}

const FENCE = /^```.*$/gm;

/**
 * Text as pages of at most `max` characters, cut at a line break where
 * there is one and at a space otherwise. A code block that runs past a
 * page is closed there and reopened on the next, so neither page renders
 * the rest of its text as code.
 */
export function paginate(text: string, max = EMBED_DESCRIPTION_MAX): string[] {
  const pages: string[] = [];
  let rest = text.trim();
  let reopen = "";
  while (rest) {
    const prefix = reopen ? `${reopen}\n` : "";
    const room = max - prefix.length - "\n```".length;
    let body = rest;
    if (rest.length > room) {
      const head = rest.slice(0, room + 1);
      const line = head.lastIndexOf("\n");
      const space = head.lastIndexOf(" ");
      body = rest.slice(0, line > 0 ? line : space > 0 ? space : room);
    }
    rest = rest.slice(body.length);
    rest = rest.startsWith("\n") ? rest.replace(/^\n+/, "") : rest.replace(/^ /, "");

    const page = prefix + body.trimEnd();
    const fences = page.match(FENCE) ?? [];
    const open = fences.length % 2 === 1 && rest.length > 0;
    reopen = open ? fences.at(-1)! : "";
    pages.push(open ? `${page}\n\`\`\`` : page);
  }
  return pages.length ? pages : [""];
}
