import * as Y from "yjs";

import type { DocLayout } from "../../project/kinds";
import { AUDIO_KIND } from "../../project/kinds/audio";
import { SOUND_KIND, soundKind, type SoundFile } from "../../project/kinds/sound";
import type { AssetEntry, ProjectState } from "../../project/types";
import { projectView } from "../../project/view";
import type { SceneDefinition } from "../../scene/types";
import { layoutToDoc } from "../layout";
import type { IssueProject } from "../watch-issues";

export const SOUND_LAYOUT = soundKind.layout as DocLayout;

const entry = (key: string, id: string, kind: string, path: string): AssetEntry => ({
  key,
  id,
  kind,
  path,
  created: { at: 1, by: "t" },
});

const state: ProjectState = {
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: {
    s1: entry("s1", "clink", SOUND_KIND, "clink.sound.json"),
    s2: entry("s2", "hum", SOUND_KIND, "hum.sound.json"),
    a1: entry("a1", "clink-wav", AUDIO_KIND, "clink.wav"),
  },
  history: {},
  code: {},
  build: {},
};

export const sound = (over: Partial<SoundFile> = {}): SoundFile => ({
  kind: SOUND_KIND,
  v: 1,
  bus: "sfx",
  variants: [{ clip: "clink-wav" }],
  ...over,
});

/** Two markers playing `clink`, one playing `hum`, which no doc is open for. */
export const soundYard = (): SceneDefinition => ({
  v: 1,
  name: "yard",
  bounds: [0, 0, 640, 480],
  entities: [
    { id: "bell", type: "marker", at: [100, 100], behaviors: { audio: { sound: "clink" } } },
    { id: "gong", type: "marker", at: [200, 100], behaviors: { audio: { sound: "clink" } } },
    { id: "fan", type: "marker", at: [300, 100], behaviors: { audio: { sound: "hum" } } },
  ],
});

/** A project with `clink`'s sound doc open, as a `ProjectSession` holds its runtime docs. */
export function withSound(file: SoundFile): { doc: Y.Doc; project: IssueProject } {
  const doc = layoutToDoc(new Y.Doc(), SOUND_LAYOUT, file);
  return {
    doc,
    project: {
      view: () => projectView(state),
      docNameFor: (e) => `doc:${e.key}`,
      get: (name) => (name === "doc:s1" ? { doc, layout: SOUND_LAYOUT } : undefined),
    },
  };
}
