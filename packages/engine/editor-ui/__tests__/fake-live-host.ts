import { vi, type Mock } from "vite-plus/test";

import { arrivalWords } from "../../game/live";
import type { EditorLiveHost, LiveWording } from "../host";

/** An `EditorLiveHost` whose members are mocks a test can read and replace. */
export type FakeLiveHost = {
  [K in keyof EditorLiveHost]: EditorLiveHost[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : EditorLiveHost[K];
};

/** A host's live sentences, with the site's numbers. */
export const FAKE_LIVE_WORDING: LiveWording = {
  noteMaxChars: 200,
  notePlaceholder: "What changed, for your team (up to 200 characters)",
  dataMaxBytes: 2_000_000,
  versionsPerDay: 100,
  data: (bytes) => `Data: ${bytes} B of 2 MB`,
  today: (count) => `Today: ${count} of 100 versions`,
  stopConfirm: ({ release, scene, timing }) =>
    `Players go back to v${release}'s version of ${scene} ${arrivalWords(timing)}.`,
};

/**
 * A live host with no versions, no base and nothing published today: its
 * reads answer empty, `publish` and `base` refuse, and moves answer a move
 * to the version asked for. `over` replaces any member.
 */
export function fakeLiveHost(over: Partial<FakeLiveHost> = {}, publisher = false): FakeLiveHost {
  return {
    base: vi.fn<EditorLiveHost["base"]>(async (scene, channel) => {
      throw new Error(`no base for ${scene} on ${channel}`);
    }),
    publish: vi.fn<EditorLiveHost["publish"]>(async () => {
      throw new Error("not here");
    }),
    list: vi.fn<EditorLiveHost["list"]>(async () => []),
    promote: vi.fn<EditorLiveHost["promote"]>(async (_scene, version) => ({
      from: null,
      to: version,
    })),
    rollback: vi.fn<EditorLiveHost["rollback"]>(async () => ({ from: null, to: null })),
    clear: vi.fn<EditorLiveHost["clear"]>(async () => ({ from: null, to: null })),
    unblock: vi.fn<EditorLiveHost["unblock"]>(async () => undefined),
    usage: vi.fn<EditorLiveHost["usage"]>(async () => ({ today: 0, versions: 0, bytes: 0 })),
    role: vi.fn<EditorLiveHost["role"]>(() => ({ publisher })),
    wording: FAKE_LIVE_WORDING,
    ...over,
  };
}
