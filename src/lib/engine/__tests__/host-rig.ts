import { formatSaveFile, type SaveFile } from "@jams/engine/game";
import { connectHost, HostRequestError, type HostChannel } from "@jams/engine/standalone";
import { expect } from "vite-plus/test";

import { createHostServer, type HostServer, type HostServerOptions } from "../host-server";
import { localPlayPrefs, localPlaySaves, SIGNED_OUT_SAVES_DESCRIBE } from "../local-saves";

export const RIG_RELEASE = { id: "e".repeat(64), gameId: "tactics", projectId: "proj-1" };
const RIG_ENGINE = "0.14.2";
const HELLO = { engine: RIG_ENGINE, release: RIG_RELEASE.id, game: RIG_RELEASE.gameId };

/** A save file of the rig's game in `slot`, carrying `data`. */
export function rigSaveText(slot: string, data: unknown = null): string {
  const file: SaveFile = {
    kind: "save",
    v: 1,
    game: RIG_RELEASE.gameId,
    gameVersion: 1,
    engine: RIG_ENGINE,
    release: null,
    project: null,
    slot,
    meta: { scene: "one", savedAt: 0, playTicks: 0 },
    depth: "progress",
    persist: null,
    scene: { id: "one", runHash: "", sublevels: [] },
    data: data as SaveFile["data"],
  };
  return formatSaveFile(file);
}

export type HostRig = {
  iframe: HTMLIFrameElement;
  frame: Window;
  server: HostServer;
  /** What the page posted to the frame's window, with its target. */
  toFrame: { data: unknown; target: string; ports: number }[];
  /** The frame's end of the last port the page handed over. */
  framePort: () => MessagePort;
  /** Dispatches a window message on the page as if from `source` on `origin`. */
  toPage(data: unknown, source: unknown, origin: string): void;
  connect(): Promise<HostChannel>;
};

const live: { rig: HostRig; channels: HostChannel[] }[] = [];

/**
 * The page's host server and a framed game in one jsdom document. jsdom's
 * postMessage carries neither `source`, `origin` nor ports, so each side's
 * post is stood in for by the event a browser would deliver: the frame's to
 * its parent from its own window on the opaque origin, the page's to the
 * frame from its parent with the transferred port. Signed out, local saves
 * and the site save mode unless `over` says otherwise.
 */
export function hostRig(over: Partial<Omit<HostServerOptions, "iframe">> = {}): HostRig {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const frame = iframe.contentWindow!;
  const toFrame: HostRig["toFrame"] = [];
  let lastPort: MessagePort | null = null;
  Object.defineProperty(frame, "postMessage", {
    configurable: true,
    value(data: unknown, target: string, transfer: MessagePort[] = []) {
      toFrame.push({ data, target, ports: transfer.length });
      lastPort = transfer[0] ?? null;
      queueMicrotask(() => {
        const event = new MessageEvent("message", { data });
        Object.defineProperty(event, "ports", { value: transfer });
        Object.defineProperty(event, "source", { value: frameView.parent });
        frame.dispatchEvent(event);
      });
    },
  });
  const toPage = (data: unknown, source: unknown, origin: string) => {
    const event = new MessageEvent("message", { data, origin });
    Object.defineProperty(event, "source", { value: source });
    window.dispatchEvent(event);
  };
  const frameView = {
    parent: { postMessage: (data: unknown) => toPage(data, frame, "null") },
    addEventListener: frame.addEventListener.bind(frame),
    removeEventListener: frame.removeEventListener.bind(frame),
  } as unknown as Window;
  const server = createHostServer({
    iframe,
    release: RIG_RELEASE,
    saves: () => localPlaySaves(RIG_RELEASE.projectId),
    describe: () => SIGNED_OUT_SAVES_DESCRIBE,
    mode: "site",
    prefs: localPlayPrefs(RIG_RELEASE.projectId),
    ...over,
  });
  const channels: HostChannel[] = [];
  const rig: HostRig = {
    iframe,
    frame,
    server,
    toFrame,
    framePort: () => lastPort!,
    toPage,
    async connect() {
      const channel = await connectHost({ hello: HELLO, window: frameView, timeoutMs: 2_000 });
      if (!channel) throw new Error("the page didn't answer");
      channels.push(channel);
      return channel;
    },
  };
  live.push({ rig, channels });
  return rig;
}

/** Closes every rig's channels, disposes its server and removes its iframe; call in `afterEach`. */
export function disposeHostRigs(): void {
  for (const { rig, channels } of live.splice(0)) {
    for (const c of channels) c.close();
    rig.server.dispose();
    rig.iframe.remove();
  }
}

/** The issue a host request was refused with; fails the test when it wasn't refused. */
export async function refusal(p: Promise<unknown>) {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HostRequestError);
  return (error as HostRequestError).issue;
}
