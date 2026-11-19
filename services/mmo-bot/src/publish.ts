import { createCooldown } from "../../../packages/discord-kit/src/index.ts";

/** Public posts are batched; thread budgets leave room under Discord's limits. */

export const POST_EVERY_MS = 2_000;

/** Combines queued lines into one message per channel at the configured interval. */
export class PostQueue {
  private readonly pending = new Map<string, string[]>();
  private readonly last = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly send: (channel: string, text: string) => Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly everyMs = POST_EVERY_MS,
  ) {}

  post(channel: string, line: string): void {
    const q = this.pending.get(channel) ?? [];
    q.push(line);
    this.pending.set(channel, q);
    if (this.timers.has(channel)) return;
    const wait = Math.max(0, (this.last.get(channel) ?? -Infinity) + this.everyMs - this.now());
    this.timers.set(
      channel,
      setTimeout(() => void this.flush(channel), wait),
    );
  }

  async flush(channel: string): Promise<void> {
    this.timers.delete(channel);
    const lines = this.pending.get(channel);
    if (!lines?.length) return;
    this.pending.delete(channel);
    this.last.set(channel, this.now());
    await this.send(channel, lines.join("\n")).catch(() => {});
  }
}

export const THREADS_PER_WINDOW = 40;
export const THREAD_WINDOW_MS = 300_000;
export const THREADS_ACTIVE = 500;

/** A per-server budget for opening threads: a sliding window, and a cap on those open. */
export class ThreadBudget {
  private readonly window = createCooldown({
    limit: THREADS_PER_WINDOW,
    windowMs: THREAD_WINDOW_MS,
  });
  private readonly active = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Takes a thread for a server if the budget allows it. */
  take(server: string): boolean {
    if ((this.active.get(server) ?? 0) >= THREADS_ACTIVE) return false;
    if (!this.window.check(server, this.now()).allowed) return false;
    this.active.set(server, (this.active.get(server) ?? 0) + 1);
    return true;
  }

  /** A thread archived or deleted gives its active slot back. */
  closed(server: string): void {
    this.active.set(server, Math.max(0, (this.active.get(server) ?? 0) - 1));
  }
}
