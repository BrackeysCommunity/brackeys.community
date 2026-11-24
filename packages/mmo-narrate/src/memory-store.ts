import type { NarrationStore } from "./types.ts";

type Value = string | Map<string, number> | string[];

interface Entry {
  value: Value;
  /** Milliseconds on the store's clock; null never expires. */
  expires: number | null;
}

const wrongType = (key: string) => new Error(`memoryStore: ${key} holds another type`);

/**
 * A NarrationStore in memory, for tests and the stubbed sitting. TTLs are
 * honoured against `now`, so a test can move time. Counters and hashes take
 * their TTL when they are created, as INCR then EXPIRE NX would.
 */
export function memoryStore(opts?: {
  now?: () => number;
}): NarrationStore & { keys(): string[]; list(key: string): string[] } {
  const now = opts?.now ?? Date.now;
  const data = new Map<string, Entry>();
  const expiry = (ttl: number | null) => (ttl === null ? null : now() + ttl * 1_000);

  const live = (key: string): Entry | undefined => {
    const e = data.get(key);
    if (e && e.expires !== null && e.expires <= now()) {
      data.delete(key);
      return undefined;
    }
    return e;
  };

  return {
    keys: () => [...data.keys()].filter((k) => live(k) !== undefined).sort(),

    /** A pushed list, newest first. */
    list(key) {
      const e = live(key);
      if (!e) return [];
      if (!Array.isArray(e.value)) throw wrongType(key);
      return [...e.value];
    },

    async get(key) {
      const e = live(key);
      if (!e) return null;
      if (typeof e.value === "string") return e.value;
      throw wrongType(key);
    },

    async set(key, value, ttlSeconds) {
      data.set(key, { value, expires: expiry(ttlSeconds) });
    },

    async claim(key, ttlSeconds) {
      if (live(key)) return false;
      data.set(key, { value: "1", expires: expiry(ttlSeconds) });
      return true;
    },

    async incr(key, ttlSeconds) {
      const e = live(key);
      if (!e) {
        data.set(key, { value: "1", expires: expiry(ttlSeconds) });
        return 1;
      }
      if (typeof e.value !== "string" || !/^-?\d+$/.test(e.value)) throw wrongType(key);
      const n = Number(e.value) + 1;
      e.value = String(n);
      return n;
    },

    async hincr(key, fields, ttlSeconds) {
      let e = live(key);
      if (!e) {
        e = { value: new Map(), expires: expiry(ttlSeconds) };
        data.set(key, e);
      }
      if (!(e.value instanceof Map)) throw wrongType(key);
      for (const [f, n] of Object.entries(fields)) {
        if (!Number.isInteger(n)) throw new Error(`memoryStore: ${f} is not an integer`);
        e.value.set(f, (e.value.get(f) ?? 0) + n);
      }
    },

    async hgetall(key) {
      const e = live(key);
      if (!e) return {};
      if (!(e.value instanceof Map)) throw wrongType(key);
      return Object.fromEntries([...e.value].map(([f, n]) => [f, String(n)]));
    },

    async push(key, value, keep) {
      let e = live(key);
      if (!e) {
        e = { value: [], expires: null };
        data.set(key, e);
      }
      if (!Array.isArray(e.value)) throw wrongType(key);
      e.value.unshift(value);
      e.value.length = Math.min(e.value.length, Math.max(keep, 0));
    },
  };
}
