import { PostQueue } from "./publish.ts";
import type { World } from "./world.ts";

/**
 * A long action that outlives the hub's token runs on in the world; its
 * result arrives in the next hub, and as a direct message when the player
 * takes them (GDD 17.3). Watched characters are polled, not ticked: only
 * those with a long action a press queued.
 */
export const POLL_MS = 30_000;

export class Notifier {
  private readonly watched = new Map<string, string>(); // character -> user
  private readonly queue: PostQueue;

  constructor(
    private readonly world: World,
    dm: (user: string, text: string) => Promise<void>,
  ) {
    this.queue = new PostQueue(dm);
  }

  watch(user: string, character: string): void {
    this.watched.set(character, user);
  }

  async poll(): Promise<void> {
    for (const [character, user] of [...this.watched]) {
      try {
        const o = await this.world.options(character);
        if (o.long) continue;
        this.watched.delete(character);
        const what = o.fight
          ? "An ambush stopped you on the road."
          : o.conditions.includes("down")
            ? "You went down."
            : "Your long action is done.";
        this.queue.post(user, `${what} Open /play to see where it left you.`);
      } catch {
        // The world is away: try again next poll.
      }
    }
  }

  start(): () => void {
    const t = setInterval(() => void this.poll(), POLL_MS);
    return () => clearInterval(t);
  }
}
