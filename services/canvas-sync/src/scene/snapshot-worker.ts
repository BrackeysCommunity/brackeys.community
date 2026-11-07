import { sceneSnapshot } from "../../../../src/lib/scene/doc-bytes.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ id: number; state: Uint8Array; version: number }>) => {
  const { id, state, version } = event.data;
  try {
    self.postMessage({ id, snapshot: sceneSnapshot(state, { version, migrations: {} }) });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message });
  }
};
