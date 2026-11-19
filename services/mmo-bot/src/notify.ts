import { CondDown } from "./api.ts";
import { PostQueue } from "./publish.ts";
import { type World, WorldRequestError } from "./world.ts";

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
          : o.conditions.includes(CondDown)
            ? "You went down."
            : "Your long action has ended.";
        this.queue.post(user, `${what} Open /play to see where it left you.`);
      } catch (error) {
        if (error instanceof WorldRequestError && error.status === 404) {
          this.watched.delete(character);
        }
      }
    }
  }

  /** Schedules the next poll after the current poll finishes. */
  start(): () => void {
    let stopped = false;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(async () => {
        await this.poll();
        if (!stopped) next();
      }, POLL_MS);
    };
    next();
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }
}
