import type { Card } from "./card.ts";
import type { ForumStore } from "./forum.ts";
import type { ChannelSink } from "./hunts.ts";

/** A posted card kept live: its message, empty while it is being posted, and what it shows. */
export interface LiveRecord {
  message: string;
  shown: string;
}

/** Whether a card last posted or edited at since may be edited again at now. */
export function editDue(since: number, now: number, every: number): boolean {
  return now - since >= Math.max(1, every);
}

/**
 * Marks key, then posts. The mark comes first so a crash or a failed write
 * after the post never posts twice in a public channel; a failed post takes
 * the mark back with undo.
 */
export async function postOnce<T>(
  store: ForumStore,
  key: string,
  mark: string,
  post: () => Promise<T>,
  undo: () => Promise<void> = () => store.del(key),
): Promise<T> {
  await store.set(key, mark);
  try {
    return await post();
  } catch (e) {
    await undo();
    throw e;
  }
}

/** Cards posted once and then edited in place, each under its own key, with a JSON set of the ones still open. */
export class LiveCards<R extends LiveRecord> {
  constructor(
    private readonly store: ForumStore,
    private readonly sink: ChannelSink,
    private readonly openKey: string,
    private readonly log: (line: string) => void,
    private readonly tag: string,
  ) {}

  async get(key: string): Promise<R | null> {
    const raw = await this.store.get(key);
    return raw ? (JSON.parse(raw) as R) : null;
  }

  async put(key: string, rec: R): Promise<void> {
    await this.store.set(key, JSON.stringify(rec));
  }

  async open(): Promise<string[]> {
    return JSON.parse((await this.store.get(this.openKey)) ?? "[]");
  }

  async setOpen(ids: Iterable<string>): Promise<void> {
    await this.store.set(this.openKey, JSON.stringify([...ids].sort()));
  }

  async track(id: string, on: boolean): Promise<void> {
    const open = new Set(await this.open());
    if (on) open.add(id);
    else open.delete(id);
    await this.setOpen(open);
  }

  /** Forgets a card, leaving its message as last edited. */
  async drop(key: string, id?: string): Promise<void> {
    await this.store.del(key);
    if (id !== undefined) await this.track(id, false);
  }

  /**
   * Posts rec's card once, tracked under id when given. Once the post has
   * gone out nothing throws: a failed write of its message only stops the
   * card being edited, since throwing would let a caller post it again.
   */
  async post(key: string, rec: R, card: Card, mention?: string, id?: string): Promise<R> {
    const message = await postOnce(
      this.store,
      key,
      JSON.stringify({ ...rec, message: "" }),
      async () => {
        if (id !== undefined) await this.track(id, true);
        return this.sink.post(card, mention);
      },
    );
    const kept = { ...rec, message };
    try {
      await this.put(key, kept);
    } catch (e) {
      this.log(`[${this.tag}] ${id ?? key}: posted, not kept: ${String(e)}`);
      if (id !== undefined) await this.track(id, false).catch(() => {});
    }
    return kept;
  }

  /** Edits a card to next; false, with gone kept in its place or the card dropped, when its message is gone. */
  async edit(
    key: string,
    message: string,
    card: Card,
    next: R,
    mention?: string,
    gone?: R,
  ): Promise<boolean> {
    if (!(await this.sink.edit(message, card, mention))) {
      await (gone ? this.put(key, gone) : this.store.del(key));
      return false;
    }
    await this.put(key, next);
    return true;
  }
}
