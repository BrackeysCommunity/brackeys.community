import {
  ENGINE_FORMAT,
  sceneSnapshot,
  type SceneSnapshot,
} from "../../../../src/lib/scene/doc-bytes.ts";

/** Derives a stored scene's canonical JSON and hash. */
export interface SnapshotRunner {
  run(state: Uint8Array): Promise<SceneSnapshot | null>;
  close(): Promise<void>;
}

export function inlineSnapshots(version = ENGINE_FORMAT.version): SnapshotRunner {
  return {
    run: async (state) => sceneSnapshot(state, { version, migrations: {} }),
    close: async () => {},
  };
}

type Reply = { id: number; snapshot?: SceneSnapshot | null; error?: string };

/**
 * Snapshots on a worker thread, so formatting a large scene never holds up
 * the relay. One worker per instance; requests queue in order.
 */
export function workerSnapshots(version = ENGINE_FORMAT.version): SnapshotRunner {
  const worker = new Worker(new URL("./snapshot-worker.ts", import.meta.url).href);
  // Bun's Worker has `unref`; the DOM typing in this tsconfig doesn't know it.
  (worker as unknown as { unref?(): void }).unref?.();
  const pending = new Map<
    number,
    { resolve(s: SceneSnapshot | null): void; reject(e: Error): void }
  >();
  let next = 0;
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const waiting = pending.get(event.data.id);
    pending.delete(event.data.id);
    if (!waiting) return;
    if (event.data.error !== undefined) waiting.reject(new Error(event.data.error));
    else waiting.resolve(event.data.snapshot ?? null);
  };
  worker.onerror = (event) => {
    for (const waiting of pending.values()) waiting.reject(new Error(event.message));
    pending.clear();
  };
  return {
    run(state) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, state, version });
      });
    },
    async close() {
      for (const waiting of pending.values()) waiting.reject(new Error("snapshot worker closed"));
      pending.clear();
      worker.terminate();
    },
  };
}
