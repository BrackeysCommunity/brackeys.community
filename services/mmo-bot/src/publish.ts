/**
 * The posting rules spike D measured (docs: spikes/D-discord-platform.md):
 * messages to one channel are batched and sent no faster than one every
 * two seconds, several lines in a window going out as one message; and
 * threads open against a per-server budget of 40 per 300 seconds and 500
 * active, under Discord's 50 and 1,000.
 */

export const POST_EVERY_MS = 2_000;

/** Lines queued per channel, flushed as one message at most every two seconds. */
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

/** A per-server token bucket for opening threads. */
export class ThreadBudget {
  private readonly opened = new Map<string, number[]>();
  private readonly active = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Takes a thread for a server if the budget allows it. */
  take(server: string): boolean {
    const t = this.now();
    const recent = (this.opened.get(server) ?? []).filter((x) => x > t - THREAD_WINDOW_MS);
    if (recent.length >= THREADS_PER_WINDOW || (this.active.get(server) ?? 0) >= THREADS_ACTIVE) {
      this.opened.set(server, recent);
      return false;
    }
    recent.push(t);
    this.opened.set(server, recent);
    this.active.set(server, (this.active.get(server) ?? 0) + 1);
    return true;
  }

  /** A thread archived or deleted gives its active slot back. */
  closed(server: string): void {
    this.active.set(server, Math.max(0, (this.active.get(server) ?? 0) - 1));
  }
}
