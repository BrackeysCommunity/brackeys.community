import type { PublicApi } from "../src/api.ts";
import type { CommandContext } from "../src/commands/context.ts";

/**
 * A `PublicApi` whose every procedure rejects unless a test supplies it —
 * so a command that reaches for a procedure its test never expected fails
 * loudly instead of returning undefined.
 */
export function fakeApi(
  overrides: Partial<{ [K in keyof PublicApi]: (...args: any[]) => unknown }>,
): PublicApi {
  return new Proxy({} as PublicApi, {
    get(_target, name) {
      if (typeof name !== "string") return undefined;
      const fn = (overrides as Record<string, unknown>)[name];
      if (typeof fn === "function") return fn;
      return () => Promise.reject(new Error(`fake api: ${name} not stubbed`));
    },
  });
}

export const NOW = new Date("2026-09-07T12:00:00Z");

export const ctx: CommandContext = {
  now: NOW,
  appUrl: "https://brackeys.test",
  hostName: "Brackeys",
  names: {
    skill: (id) => (({ 7: "Unity" }) as Record<number, string>)[id],
    role: (id) => (({ 3: "Composer" }) as Record<number, string>)[id],
  },
};

const day = 86_400_000;

/** A jam relative to NOW: negative offsets are in the past. */
export function jam(
  overrides: Partial<{
    jamId: number;
    slug: string;
    title: string;
    startDays: number;
    endDays: number;
    votingDays: number | null;
    bannerUrl: string | null;
    themeColor: string | null;
    joinedCount: number | null;
    entriesCount: number | null;
    hosts: { name: string }[];
  }> = {},
) {
  const {
    jamId = 1,
    slug = "brackeys-14",
    title = "Brackeys Game Jam 2026.1",
    startDays = -3,
    endDays = 4,
    votingDays = 11,
    bannerUrl = "https://img.itch.zone/banner.png",
    themeColor = "#ff3366",
    joinedCount = 1234,
    entriesCount = 567,
    hosts = [{ name: "Brackeys" }],
  } = overrides;
  return {
    jamId,
    slug,
    title,
    bannerUrl,
    themeColor,
    startsAt: new Date(NOW.getTime() + startDays * day),
    endsAt: new Date(NOW.getTime() + endDays * day),
    votingEndsAt: votingDays == null ? null : new Date(NOW.getTime() + votingDays * day),
    joinedCount,
    entriesCount,
    hosts,
  };
}

export const unix = (d: Date) => Math.floor(d.getTime() / 1000);
