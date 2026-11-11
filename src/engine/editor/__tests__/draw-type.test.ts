import { afterEach, describe, expect, it } from "vite-plus/test";

import { fakeToolContext, pointer, toolRegistry } from "../../__tests__/fixtures/test-tool";
import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import type { Pt, SceneDefinition } from "../../scene/types";
import { validateScene } from "../../scene/validate";
import { createToolRouter } from "../../tool-router";
import { boxTool, circleTool, drawTypeOptions } from "../builtin/draw";
import { penTool, strokeFit, strokeShape } from "../builtin/polyline";
import { createEditorSession, type EditorSession } from "../session";
import { createToolHost, type ToolHost } from "../tool-host";
import { DEFAULT_SNAP } from "../tools";

const free = { ...DEFAULT_SNAP, enabled: false };
const doc = (): SceneDefinition => ({ v: 1, name: "t", bounds: [0, 0, 1000, 1000], entities: [] });

/** A notched outline: concave at its fourth point. */
const NOTCH: Pt[] = [
  [100, 100],
  [300, 100],
  [300, 300],
  [200, 180],
  [100, 300],
];

const typesOf = (kind: "box" | "circle" | "pen") =>
  drawTypeOptions(toolRegistry, kind).map((o) => o.type);

describe("the types a draw tool offers", () => {
  it("are those whose shape field takes what the tool draws", () => {
    expect(typesOf("pen")).toEqual(expect.arrayContaining(["solid", "sensor", "nav"]));
    expect(typesOf("box")).toEqual(expect.arrayContaining(["solid", "sensor", "prop"]));
    expect(typesOf("circle")).toEqual(expect.arrayContaining(["solid", "sensor", "prop"]));
  });

  it("leave out types with no shape field and fields that refuse the tool's shapes", () => {
    for (const kind of ["box", "circle", "pen"] as const) {
      for (const type of ["marker", "decor", "note"]) expect(typesOf(kind)).not.toContain(type);
    }
    // A nav area is a polygon field: poly only.
    expect(typesOf("box")).not.toContain("nav");
    expect(typesOf("circle")).not.toContain("nav");
  });

  it("refuse a type the tool can't draw and keep the one it had", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), free);
    const box = boxTool.create(ctx);
    expect(box.command!("type:nav")).toBe(false);
    expect(box.command!("type:marker")).toBe(false);
    expect(box.command!("type:nope")).toBe(false);
    box.pointer!(pointer("move", [10, 10]));
    const option = box.overlay!().option!;
    expect(option.value).toBe("solid");
    expect(option.choices.map((c) => c.value)).not.toContain("nav");
    expect(option.choices.map((c) => c.value)).toContain("sensor");
  });
});

describe("drawing with a picked type", () => {
  it("draws a box and a circle as the picked type", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), free);
    const box = boxTool.create(ctx);
    expect(box.command!("type:sensor")).toBe(true);
    box.pointer!(pointer("down", [0, 0]));
    box.pointer!(pointer("move", [64, 32]));
    box.pointer!(pointer("up", [64, 32]));

    const circle = circleTool.create(ctx);
    expect(circle.overlay!().option?.value).toBe("sensor");
    circle.pointer!(pointer("down", [200, 200]));
    circle.pointer!(pointer("move", [230, 240]));
    circle.pointer!(pointer("up", [230, 240]));

    expect(ctx.commits.map((b) => b.ops)).toEqual([
      [{ op: "add", entity: { id: "sensor", type: "sensor", shape: ["box", 32, 16, 32, 16] } }],
      [{ op: "add", entity: { id: "sensor-2", type: "sensor", shape: ["circle", 200, 200, 50] } }],
    ]);
    expect(ctx.selected).toEqual([["sensor"], ["sensor-2"]]);
  });

  it("draws a concave nav area with the pen as a poly that validates clean", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), free);
    const pen = penTool.create(ctx);
    expect(pen.command!("type:nav")).toBe(true);
    for (const p of NOTCH) pen.pointer!(pointer("down", p));
    pen.pointer!(pointer("down", NOTCH[0]!));

    expect(ctx.commits).toHaveLength(1);
    expect(ctx.commits[0]!.ops).toEqual([
      {
        op: "add",
        entity: { id: "nav", type: "nav", shape: ["poly", ...NOTCH.flat()] },
      },
    ]);
    const issues = validateScene(ctx.doc, toolRegistry).filter(
      (i) => i.entityIds?.includes("nav") || i.severity === "error",
    );
    expect(issues).toEqual([]);
  });

  it("closes an open nav stroke of three points or more, and keeps a shorter one open saying why", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), free);
    const pen = penTool.create(ctx);
    const enter = () =>
      pen.key!({ type: "down", key: "Enter", repeat: false, shift: false, alt: false, mod: false });
    pen.command!("type:nav");
    pen.pointer!(pointer("down", [0, 0]));
    pen.pointer!(pointer("down", [100, 0]));
    expect(pen.overlay!().readout).toBeUndefined();
    enter();
    expect(ctx.commits).toEqual([]);
    expect(pen.gesture!()).toBe(true);
    let overlay = pen.overlay!();
    expect(overlay.readout).toEqual({ at: [100, 0], text: "A nav needs 3 points" });
    expect(overlay.polylines?.[0]).toMatchObject({
      pts: [
        [0, 0],
        [100, 0],
      ],
      tone: "invalid",
    });

    // A double-click is refused the same way.
    pen.pointer!({ ...pointer("down", [100, 0]), clicks: 2 });
    expect(ctx.commits).toEqual([]);
    expect(pen.overlay!().readout?.text).toBe("A nav needs 3 points");

    // A third point clears it, and the stroke finishes as a closed poly.
    pen.pointer!(pointer("down", [100, 100]));
    overlay = pen.overlay!();
    expect(overlay.polylines?.[0]?.tone).toBe("ghost");
    expect(overlay.readout?.text ?? "").not.toContain("needs");
    enter();
    expect(ctx.commits.map((b) => b.ops[0])).toEqual([
      {
        op: "add",
        entity: { id: "nav", type: "nav", shape: ["poly", 0, 0, 100, 0, 100, 100] },
      },
    ]);
  });

  it("lets a refused stroke finish once the picked type takes a chain", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), free);
    const pen = penTool.create(ctx);
    pen.command!("type:nav");
    pen.pointer!(pointer("down", [0, 0]));
    pen.pointer!(pointer("down", [100, 0]));
    pen.key!({ type: "down", key: "Enter", repeat: false, shift: false, alt: false, mod: false });
    expect(pen.overlay!().readout?.text).toBe("A nav needs 3 points");
    pen.command!("type:solid");
    expect(pen.overlay!().readout?.text ?? "").not.toContain("needs");
    pen.key!({ type: "down", key: "Enter", repeat: false, shift: false, alt: false, mod: false });
    expect(ctx.commits.map((b) => b.ops[0])).toEqual([
      { op: "addBulk", key: "solid", shapes: [["chain", 0, 0, 100, 0]] },
    ]);
  });

  it("closes an open nav stroke of more than three points", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), free);
    const pen = penTool.create(ctx);
    pen.command!("type:nav");
    for (const p of NOTCH) pen.pointer!(pointer("down", p));
    pen.key!({ type: "down", key: "Enter", repeat: false, shift: false, alt: false, mod: false });
    expect(ctx.commits.map((b) => b.ops[0])).toEqual([
      { op: "add", entity: { id: "nav", type: "nav", shape: ["poly", ...NOTCH.flat()] } },
    ]);
  });

  it("still closes a concave solid stroke as a chain", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), free);
    const pen = penTool.create(ctx);
    for (const p of NOTCH) pen.pointer!(pointer("down", p));
    pen.pointer!(pointer("down", NOTCH[0]!));
    expect(ctx.commits[0]!.ops).toEqual([
      { op: "addBulk", key: "solid", shapes: [["chain", ...NOTCH.flat(), ...NOTCH[0]!]] },
    ]);
  });

  it("keeps a concave stroke a poly for a field that takes neither chains nor concave polys", () => {
    const fit = strokeFit(toolRegistry, "prop");
    expect(fit).toEqual({ chain: false, concavePoly: false });
    expect(strokeShape(NOTCH, true, fit).type).toBe("poly");
    expect(strokeFit(toolRegistry, "nav")).toEqual({ chain: false, concavePoly: true });
  });
});

describe("the type choice in a tool host", () => {
  let hosts: { host: ToolHost; session: EditorSession }[] = [];
  afterEach(() => {
    for (const r of hosts) {
      r.host.destroy();
      r.session.destroy();
    }
    hosts = [];
  });

  function rig() {
    const session = createEditorSession({
      doc: sceneToDoc(doc(), { key: sequentialKeys("k") }),
      origin: { kind: "user", userId: "ada", name: "Ada" },
      name: "t",
      registry: toolRegistry,
      issuesDebounceMs: 0,
    });
    const router = createToolRouter();
    let clock = 0;
    const host = createToolHost({
      session,
      router,
      toWorld: ({ x, y }) => [x, y],
      scale: () => 1,
      snap: free,
      now: () => (clock += 1000),
    });
    hosts.push({ host, session });
    const click = ([x, y]: Pt) => {
      for (const type of ["down", "up"] as const)
        router.dispatch({
          kind: "pointer",
          type,
          screen: { x, y },
          button: 0,
          deltaY: 0,
          native: {
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
          } as unknown as PointerEvent,
        });
    };
    return { session, host, click };
  }

  it("is picked by a tool command, shown in the overlay, and kept across tool switches", () => {
    const { host } = rig();
    expect(host.command("tool:pen:type:nav")).toBe(true);
    expect(host.tool()).toBe("pen");
    const option = host.overlay().option;
    expect(option).toMatchObject({ label: "Draw type", value: "nav", command: "type:" });
    expect(host.overlay().option).toBe(option);

    host.setTool("select");
    expect(host.overlay().option).toBeUndefined();
    host.setTool("box");
    expect(host.overlay().option?.value).toBe("solid");
    host.setTool("pen");
    expect(host.overlay().option?.value).toBe("nav");
    expect(host.command("type:solid")).toBe(true);
    expect(host.overlay().option?.value).toBe("solid");
  });

  it("draws a concave nav area into the document that validates clean", () => {
    const { session, host, click } = rig();
    host.command("tool:pen:type:nav");
    for (const p of NOTCH) click(p);
    click(NOTCH[0]!);
    const nav = session.getDoc().entities?.find((e) => e.type === "nav");
    expect(nav).toMatchObject({ id: "nav", shape: ["poly", ...NOTCH.flat()] });
    expect(session.store.state.selection).toEqual(["nav"]);
    expect(
      validateScene(session.getDoc(), toolRegistry).filter((i) => i.severity === "error"),
    ).toEqual([]);
  });
});
