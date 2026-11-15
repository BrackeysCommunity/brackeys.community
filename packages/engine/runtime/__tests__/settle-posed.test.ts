import { describe, expect, it } from "vite-plus/test";

import { createPoseIndex, settlePosed, type Pose } from "../poses";

type Entry = { applied: Readonly<Pose> | null; off?: boolean };

describe("settlePosed", () => {
  it("re-poses only what moved, snapping a teleport, passing over skipped entries", () => {
    let tick = 0;
    const poses = createPoseIndex(() => tick);
    const posed = new Map<string, Entry>([
      ["a", { applied: null }],
      ["b", { applied: null }],
      ["off", { applied: null, off: true }],
      ["gone", { applied: null }],
    ]);
    for (const id of ["a", "b", "off"]) poses.set(id, 0, 0, 0, { snap: true });
    const placed: [string, number, boolean][] = [];
    const place = (id: string, e: Entry, pose: Readonly<Pose>, snap: boolean) => {
      placed.push([id, pose.x, snap]);
      e.applied = pose;
    };
    settlePosed(poses, posed, place, (e) => e.off === true);
    expect(placed).toEqual([
      ["a", 0, true],
      ["b", 0, true],
    ]);

    placed.length = 0;
    tick = 1;
    poses.set("a", 1, 0);
    poses.set("b", 5, 0, 0, { snap: true });
    settlePosed(poses, posed, place, (e) => e.off === true);
    expect(placed).toEqual([
      ["a", 1, false],
      ["b", 5, true],
    ]);

    placed.length = 0;
    settlePosed(poses, posed, place);
    expect(placed).toEqual([["off", 0, true]]);
  });
});
