/**
 * Collects every `load(key)` made in the same tick into chunked requests,
 * so a page of chips costs one round trip instead of one per chip. A
 * failed chunk resolves its keys to null.
 */
export function createBatchLoader<V>(
  fetchChunk: (keys: string[]) => Promise<V[]>,
  keyOf: (value: V) => string,
  chunkSize = 50,
): (key: string) => Promise<V | null> {
  let queued = new Map<string, ((value: V | null) => void)[]>();
  let scheduled = false;

  async function flush() {
    const batch = queued;
    queued = new Map();
    scheduled = false;
    const keys = [...batch.keys()];
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      let found: V[] = [];
      try {
        found = await fetchChunk(chunk);
      } catch {
        // Unresolved keys still render, as their fallback.
      }
      const byKey = new Map(found.map((value) => [keyOf(value), value]));
      for (const key of chunk) {
        for (const resolve of batch.get(key) ?? []) resolve(byKey.get(key) ?? null);
      }
    }
  }

  return (key) =>
    new Promise((resolve) => {
      queued.set(key, [...(queued.get(key) ?? []), resolve]);
      if (!scheduled) {
        scheduled = true;
        setTimeout(() => void flush(), 0);
      }
    });
}
