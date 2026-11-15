import { describe, expect, it } from "vite-plus/test";

import { createEditorSession } from "../../editor/session";
import { createRegistry } from "../../game/define";
import type { Prefab, SceneDefinition, SceneIssue } from "../../scene/types";
import { sceneToDoc } from "../convert";
import { layoutPatch } from "../layout";
import { staticPrefabSource } from "../prefab-source";
import { validateDoc, watchIssues } from "../watch-issues";
import { ada } from "./helpers";
import { SOUND_LAYOUT, sound, soundYard as yard, withSound } from "./sound-project";

const registry = createRegistry();

const ofCode = (issues: readonly SceneIssue[], code: string) =>
  issues.filter((i) => i.code === code);

describe("the sounds a scene names, in its issues", () => {
  it("a clean sound adds nothing", () => {
    const { project } = withSound(sound());
    const issues = validateDoc(sceneToDoc(yard()), registry, { project });
    expect(ofCode(issues, "sound-bus-unknown")).toEqual([]);
    expect(ofCode(issues, "asset-missing")).toEqual([]);
  });

  it("raises sound-bus-unknown on the entities naming the sound", () => {
    const { project } = withSound(sound({ bus: "loud" }));
    const [issue, ...rest] = ofCode(
      validateDoc(sceneToDoc(yard()), registry, { project }),
      "sound-bus-unknown",
    );
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      severity: "error",
      entityIds: ["bell", "gong"],
      path: "/entities/0/behaviors/audio/sound",
      got: "loud",
      detail: { asset: "clink", pointer: "/bus" },
    });
    expect(issue?.message).toMatch(/^the sound "clink": .*no bus "loud"/);
    expect(issue?.fix).toBeUndefined();
  });

  it("raises asset-missing for a variant whose clip the project lacks", () => {
    const { project } = withSound(sound({ variants: [{ clip: "clink-wav" }, { clip: "gone" }] }));
    const missing = ofCode(validateDoc(sceneToDoc(yard()), registry, { project }), "asset-missing");
    expect(missing).toEqual([
      expect.objectContaining({
        entityIds: ["bell", "gong"],
        got: "gone",
        detail: expect.objectContaining({ asset: "clink", pointer: "/variants/1/clip" }),
      }),
    ]);
    expect(missing[0]?.message).toContain('"clink" names');
  });

  it("reaches an instance's children, pointing at the instance", () => {
    const { project } = withSound(sound({ bus: "loud" }));
    const chime: Prefab = {
      kind: "prefab",
      v: 4,
      id: "chime",
      entities: [
        { id: "bell", type: "marker", at: [0, 0], behaviors: { audio: { sound: "clink" } } },
      ],
    };
    const scene: SceneDefinition = {
      ...yard(),
      entities: [],
      instances: [{ id: "porch", prefab: "chime", at: [100, 100] }],
    };
    const [issue] = ofCode(
      validateDoc(sceneToDoc(scene), registry, {
        project,
        prefabs: staticPrefabSource(new Map([["chime", chime]])),
      }),
      "sound-bus-unknown",
    );
    expect(issue).toMatchObject({ entityIds: ["porch/bell"], path: "/instances/0" });
  });

  it("lists a sound only its triggers play, naming no entity", () => {
    const { project } = withSound(
      sound({ bus: "loud", variants: [{ clip: "gone" }], on: [{ event: "contact:start" }] }),
    );
    const quiet: SceneDefinition = { ...yard(), entities: yard().entities?.slice(2) };
    const issues = validateDoc(sceneToDoc(quiet), registry, { project });
    expect(ofCode(issues, "sound-bus-unknown")).toEqual([
      expect.objectContaining({
        entityIds: [],
        path: "",
        got: "loud",
        detail: expect.objectContaining({ asset: "clink", pointer: "/bus" }),
      }),
    ]);
    expect(ofCode(issues, "asset-missing")).toEqual([
      expect.objectContaining({
        entityIds: [],
        path: "",
        got: "gone",
        detail: expect.objectContaining({ asset: "clink", pointer: "/variants/0/clip" }),
      }),
    ]);
  });

  it("skips a sound neither named nor triggered, and one whose doc isn't open", () => {
    const quiet: SceneDefinition = { ...yard(), entities: yard().entities?.slice(2) };
    for (const file of [sound({ bus: "loud" }), sound({ bus: "loud", on: [] })]) {
      const { project } = withSound(file);
      expect(
        ofCode(validateDoc(sceneToDoc(quiet), registry, { project }), "sound-bus-unknown"),
      ).toEqual([]);
    }
  });

  it("reports a named sound with triggers once, at the entities naming it", () => {
    const { project } = withSound(sound({ bus: "loud", on: [{ event: "contact:start" }] }));
    expect(
      ofCode(validateDoc(sceneToDoc(yard()), registry, { project }), "sound-bus-unknown"),
    ).toEqual([expect.objectContaining({ entityIds: ["bell", "gong"] })]);
  });

  it("revalidates when the sound doc changes", () => {
    const { doc: soundDoc, project } = withSound(sound());
    let pending: (() => void) | null = null;
    let seen: string[] = [];
    const watch = watchIssues(
      sceneToDoc(yard()),
      registry,
      (issues) => (seen = issues.map((i) => i.code)),
      { project, setTimer: (fn) => (pending = fn), clearTimer: () => (pending = null) },
    );
    expect(watch.flush().map((i) => i.code)).not.toContain("sound-bus-unknown");
    layoutPatch(soundDoc, SOUND_LAYOUT, sound({ bus: "loud" }));
    expect(pending).not.toBeNull();
    pending!();
    expect(seen).toContain("sound-bus-unknown");
    watch.stop();
  });

  it("reaches an editor session's issues, which the Problems panel lists", () => {
    const { project } = withSound(sound({ bus: "loud" }));
    const session = createEditorSession({
      doc: sceneToDoc(yard()),
      origin: ada,
      name: "yard",
      registry,
      issuesDebounceMs: 0,
      project,
    });
    expect(ofCode(session.store.state.issues, "sound-bus-unknown")).toHaveLength(1);
    session.destroy();
  });
});
