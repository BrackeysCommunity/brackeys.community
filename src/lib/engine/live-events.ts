import { createBroadcast } from "@/lib/live-broadcast";

/** A move on a channel's live state: its release or a scene pointer. Play pages refetch when `rev` grows. */
export type EngineLiveEvent = { projectId: string; channel: "preview" | "production"; rev: number };

/** An announcement as it arrives over Redis, or null when it isn't one. */
export function parseEngineLiveEvent(raw: unknown): EngineLiveEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { projectId, channel, rev } = raw as Record<string, unknown>;
  if (typeof projectId !== "string" || projectId === "") return null;
  if (channel !== "preview" && channel !== "production") return null;
  if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev < 0) return null;
  return { projectId, channel, rev };
}

/** Every channel move of every hosted game; the live stream filters it per project and channel. */
export const engineLive = createBroadcast<EngineLiveEvent>({
  name: "engine-live",
  channel: "engine:live",
  parse: parseEngineLiveEvent,
  localWithoutRedis: true,
});
