/** A bounded cache: entries expire `ttlMs` after they're set, and the least recently read go first past `max`. */
export type TtlLru<K, V> = {
  /** The value while it's fresh at `now`, marked as just read; undefined once it expired or was dropped. */
  get(key: K, now: number): V | undefined;
  set(key: K, value: V, now: number): void;
  delete(key: K): void;
  /** Drops every entry `test` picks. */
  deleteWhere(test: (value: V, key: K) => boolean): void;
  clear(): void;
  readonly size: number;
};

export function ttlLru<K, V>(opts: { max: number; ttlMs: number }): TtlLru<K, V> {
  const entries = new Map<K, { at: number; value: V }>();
  return {
    get(key, now) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (now - entry.at >= opts.ttlMs) return undefined;
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, now) {
      entries.delete(key);
      entries.set(key, { at: now, value });
      while (entries.size > opts.max) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    delete(key) {
      entries.delete(key);
    },
    deleteWhere(test) {
      for (const [key, entry] of entries) if (test(entry.value, key)) entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
