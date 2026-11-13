// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import { createEditorSession, lookupRef, type SceneDefinition } from "../../editor/index";
import { buildInspectorModel } from "../../editor/inspector-model";
import { createRegistry, ENGINE_BEHAVIORS } from "../../game/define";
import { applyOps } from "../../scene/ops";
import type { EntityDef } from "../../scene/types";
import { validateScene } from "../../scene/validate";
import { BehaviorMarks } from "../panels/canvas-layer/BehaviorMarks";
import { EditorInspector } from "../panels/EditorInspector";

/** The standard behaviors a designer builds a playable entity from. */
const STANDARD = [
  "collider",
  "body",
  "player-input",
  "path-follow",
  "force-area",
  "character-top-down",
  "character-side-view",
  "nav-agent",
  "joint",
  "spawner",
  "camera-target",
];

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const hero: EntityDef = { id: "hero", type: "marker", at: [5, 5] };
const crate: EntityDef = { id: "crate", type: "prop", shape: ["box", 8, 5, 0.5, 0.5] };

/** A room every engine behavior can be added in: a grid, a walk area, and a body to link to. */
function room(...entities: EntityDef[]): SceneDefinition {
  return {
    v: 1,
    name: "templates",
    bounds: [0, 0, 20, 20],
    settings: { physics: "rapier", grid: { cell: [0.32, 0.32], kind: "square" } },
    entities: [
      { id: "floor", type: "nav", shape: ["poly", 0, 0, 20, 0, 20, 20, 0, 20] },
      ...entities,
    ],
  };
}

const optionsFor = (def: SceneDefinition, ref: string) =>
  buildInspectorModel(registry, [lookupRef(def, ref)!], { def }).addBehaviors;

afterEach(cleanup);

function choose(option: HTMLElement): void {
  fireEvent.mouseMove(option);
  fireEvent.click(option);
}

describe("Add behavior templates", () => {
  it("offers every engine behavior on a marker, the standard eleven among them", () => {
    const names = optionsFor(room(hero, crate), "hero").map((o) => o.name);
    expect(names).toEqual(ENGINE_BEHAVIORS.map((b) => b.name));
    expect(STANDARD.every((n) => names.includes(n))).toBe(true);
  });

  it.each(ENGINE_BEHAVIORS.map((b) => b.name))("adds %s to a marker as a valid block", (name) => {
    const def = room(hero, crate);
    const option = optionsFor(def, "hero").find((o) => o.name === name)!;
    expect(option.unavailable).toBeUndefined();
    const r = applyOps(def, option.batch, registry);
    if (!r.ok) throw new Error(r.issue.message);
    expect(validateScene(r.def, registry)).toEqual([]);
    const added = r.def.entities!.find((e) => e.id === "hero")!.behaviors as Record<
      string,
      unknown
    >;
    expect(Object.keys(added)).toContain(name);
  });

  it("adds what a behavior requires alongside it, each from its own template", () => {
    const options = optionsFor(room(hero, crate), "hero");
    const side = options.find((o) => o.name === "character-side-view")!;
    expect(side.adds).toEqual(["Collider"]);
    expect(side.batch).toEqual({
      label: "Add Character (side view) to hero",
      ops: [
        {
          op: "update",
          ref: "hero",
          set: {
            "behaviors.collider": { shape: ["box", 0, 0, 0.25, 0.25] },
            "behaviors.character-side-view": {},
          },
        },
      ],
    });
    expect(options.find((o) => o.name === "joint")!.adds).toEqual(["Collider", "Body"]);
    expect(options.find((o) => o.name === "camera-target")!.adds).toBeUndefined();
  });

  it("makes the collider a force area adds a sensor, as the scene's own fix would", () => {
    const set = optionsFor(room(hero), "hero").find((o) => o.name === "force-area")!.batch.ops[0];
    expect(set).toMatchObject({
      set: { "behaviors.collider": { sensor: true }, "behaviors.force-area": { force: [0, -20] } },
    });
  });

  it("links a joint to the nearest entity with a body, and can't without one", () => {
    const near: EntityDef = { id: "near", type: "marker", at: [6, 5] };
    const far: EntityDef = { ...crate, id: "far", shape: ["box", 15, 5, 0.5, 0.5] };
    const joint = optionsFor(room(hero, near, crate, far), "hero").find((o) => o.name === "joint")!;
    expect(joint.batch.ops[0]).toMatchObject({
      set: { "behaviors.joint": { kind: "revolute", to: "crate" } },
    });
    const alone = optionsFor(room(hero, near), "hero").find((o) => o.name === "joint")!;
    expect(alone.unavailable).toBe("Joint needs another entity in the scene to link to.");
  });

  it("doesn't touch a collider the entity already has", () => {
    const solid: EntityDef = {
      ...hero,
      behaviors: { collider: { shape: ["circle", 0, 0, 0.5] } },
    };
    const force = optionsFor(room(solid), "hero").find((o) => o.name === "force-area")!;
    expect(force.adds).toBeUndefined();
    expect(force.batch.ops).toEqual([
      { op: "update", ref: "hero", set: { "behaviors.force-area": { force: [0, -20] } } },
    ]);
  });
});

function setup(selection: string[], def: SceneDefinition) {
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: "templates",
    registry,
    issuesDebounceMs: 0,
  });
  session.select(selection);
  const dispatch = vi.spyOn(session, "dispatch");
  render(<EditorInspector session={session} />);
  const entity = (id: string) => session.getDoc().entities!.find((e) => e.id === id)!;
  return { session, dispatch, entity };
}

async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add behavior" }));
  });
  return screen.findAllByRole("menuitem");
}

describe("EditorInspector: standard behaviors", () => {
  it("lists the eleven in the Add behavior menu with their descriptions", async () => {
    setup(["hero"], room(hero, crate));
    const items = await openMenu();
    for (const name of STANDARD) {
      const def = ENGINE_BEHAVIORS.find((b) => b.name === name)!;
      const item = items.find((i) => i.getAttribute("data-behavior") === name);
      expect(item, name).toBeTruthy();
      expect(item!.textContent).toContain(def.inspector!.label!);
      expect(item!.textContent).toContain(def.description);
    }
    const side = items.find((i) => i.getAttribute("data-behavior") === "character-side-view")!;
    expect(side.textContent).toContain("Also adds Collider.");
  });

  it("adds a character and its collider in one batch, its fields grouped and in order", async () => {
    const { dispatch, entity } = setup(["hero"], room(hero));
    const items = await openMenu();
    await act(async () => {
      fireEvent.click(
        items.find((i) => i.getAttribute("data-behavior") === "character-side-view")!,
      );
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(Object.keys(entity("hero").behaviors ?? {})).toEqual([
      "collider",
      "character-side-view",
    ]);
    const section = screen.getByRole("region", { name: "Character (side view)" });
    const headings = [...section.querySelectorAll(".je-insp-group-title")].map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(["Movement", "Jump", "Ground", "Input"]);
    const jump = section.querySelector('[data-group="jump"]') as HTMLElement;
    expect(within(jump).getByLabelText("behaviors.character-side-view.jumpHeight")).toBeTruthy();
    expect(within(jump).getByText("m")).toBeTruthy();
    const labels = [...section.querySelectorAll("input[aria-label]")].map((i) =>
      i.getAttribute("aria-label")!.replace("behaviors.character-side-view.", ""),
    );
    expect(labels.slice(0, 3)).toEqual(["maxSpeed", "accel", "decel"]);
  });

  it("says why a joint can't be added with nothing to link to, and adds nothing", async () => {
    const { dispatch } = setup(["hero"], room(hero));
    const items = await openMenu();
    const joint = items.find((i) => i.getAttribute("data-behavior") === "joint")!;
    expect(joint.hasAttribute("data-unavailable")).toBe(true);
    await act(async () => {
      fireEvent.click(joint);
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText("Joint needs another entity in the scene to link to.")).toBeTruthy();
  });

  it("picks a character's move and jump from the game's actions", async () => {
    const { dispatch, entity } = setup(
      ["hero"],
      room({
        ...hero,
        behaviors: { collider: { shape: ["box", 0, 0, 0.25, 0.25] }, "character-side-view": {} },
      }),
    );
    const jump = screen.getByRole("combobox", { name: "behaviors.character-side-view.jump" });
    fireEvent.click(jump);
    const options = await waitFor(() => screen.getAllByRole("option"));
    expect(options.map((o) => o.textContent)).toEqual(["unset", "move (vector)", "jump"]);
    choose(options.find((o) => o.textContent === "move (vector)")!);
    await waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    expect(entity("hero").behaviors).toMatchObject({ "character-side-view": { jump: "move" } });
  });

  it("picks a joint's other end from the scene's entities, never itself", async () => {
    const { dispatch, entity } = setup(
      ["hero"],
      room(
        {
          ...hero,
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.25, 0.25] },
            body: {},
            joint: { kind: "revolute", to: "crate" },
          },
        },
        crate,
        { ...crate, id: "crate-2", shape: ["box", 12, 5, 0.5, 0.5] },
      ),
    );
    const to = screen.getByRole("combobox", { name: "behaviors.joint.to" }) as HTMLInputElement;
    expect(to.value).toBe("crate");
    const row = to.closest(".je-insp-field") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Show options" }));
    const options = await waitFor(() => {
      const o = screen.getAllByRole("option");
      expect(o.length).toBeGreaterThan(0);
      return o;
    });
    const ids = options.map((o) => o.textContent);
    expect(ids).toEqual(expect.arrayContaining(["crate", "crate-2", "floor"]));
    expect(ids).not.toContain("hero");
    choose(options.find((o) => o.textContent === "crate-2")!);
    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(entity("hero").behaviors).toMatchObject({ joint: { to: "crate-2" } });
  });
});

describe("EditorInspector: standard behavior fields", () => {
  const collider = { shape: ["box", 0, 0, 0.25, 0.25] };
  const section = (name: string) => screen.getByRole("region", { name });
  const headings = (el: HTMLElement) =>
    [...el.querySelectorAll(".je-insp-group-title")].map((h) => h.textContent);

  it("shows an unset spawner as active, and switching it off writes false", async () => {
    const { dispatch, entity } = setup(
      ["hero"],
      room({ ...hero, behaviors: { spawner: { type: "marker" } } }),
    );
    const active = screen.getByRole("switch", { name: "behaviors.spawner.active" });
    expect(active.getAttribute("aria-checked")).toBe("true");
    expect(within(section("Spawner")).getByText("on (default)")).toBeTruthy();
    await act(async () => {
      fireEvent.click(active);
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(entity("hero").behaviors).toMatchObject({ spawner: { active: false } });
  });

  it("reads a choice left unset as its default option", () => {
    setup(
      ["hero"],
      room({ ...hero, behaviors: { collider, body: {}, "character-side-view": {} } }),
    );
    const move = screen.getByRole("combobox", { name: "behaviors.character-side-view.move" });
    expect(move.textContent).toBe("move (vector) (default)");
    const jump = screen.getByRole("combobox", { name: "behaviors.character-side-view.jump" });
    expect(jump.textContent).toBe("jump (default)");
    const kind = within(section("Body")).getByRole("group", { name: "behaviors.body.kind" });
    expect(within(kind).getByText("dynamic").closest(".je-insp-default-choice")).toBeTruthy();
    expect(within(section("Body")).getByText("dynamic (default)")).toBeTruthy();
  });

  it("leaves off a sub-heading that repeats the section's title", () => {
    setup(
      ["hero"],
      room(crate, {
        ...hero,
        behaviors: {
          collider,
          body: {},
          joint: { kind: "revolute", to: "crate" },
          spawner: { type: "marker" },
          "camera-target": {},
        },
      }),
    );
    expect(headings(section("Collider"))).toEqual(["Surface"]);
    expect(headings(section("Joint"))).toEqual(["Limits"]);
    expect(headings(section("Spawner"))).toEqual(["Placement"]);
    expect(headings(section("Camera target"))).toEqual([]);
    const to = screen.getByRole("combobox", { name: "behaviors.joint.to" }) as HTMLInputElement;
    expect(to.placeholder).toBe("Pick an entity");
  });

  it("groups Add behavior under headings, with what it also adds as its own note", async () => {
    setup(["hero"], room(hero, crate));
    await openMenu();
    const menu = document.querySelector(".je-insp-behavior-menu") as HTMLElement;
    expect([...menu.querySelectorAll(".je-menu-label")].map((l) => l.textContent)).toEqual([
      "Physics",
      "Movement",
      "World",
      "Visual",
    ]);
    const side = menu.querySelector('[data-behavior="character-side-view"]') as HTMLElement;
    expect(side.querySelector(".je-insp-behavior-note")?.textContent).toBe("Also adds Collider.");
  });
});

describe("BehaviorMarks", () => {
  it("draws the selected entity's collider, joint line, force arrow and spread ring", () => {
    const session = createEditorSession({
      doc: sceneToDoc(
        room(
          {
            ...hero,
            behaviors: {
              collider: { shape: ["box", 0, 0, 1, 1], sensor: true },
              "force-area": { force: [0, -20] },
              spawner: { type: "marker", spread: 0.5 },
            },
          },
          {
            id: "link",
            type: "marker",
            at: [3, 3],
            behaviors: {
              collider: { shape: ["circle", 0, 0, 0.25] },
              body: {},
              joint: { kind: "revolute", to: "crate" },
            },
          },
          crate,
        ),
        { key: sequentialKeys("t") },
      ),
      origin: ada,
      name: "templates",
      registry,
      issuesDebounceMs: 0,
    });
    const view = { width: 800, height: 600, scale: 100, tx: 0, ty: 0 };
    const draw = () =>
      render(
        <svg>
          <BehaviorMarks session={session} view={view} transform="" overlay={{}} />
        </svg>,
      );
    const { container, unmount } = draw();
    expect(container.querySelector("[data-behavior-marks]")).toBeNull();
    unmount();

    act(() => session.select(["hero"]));
    const one = draw();
    const marks = (kind: string) =>
      one.container.querySelectorAll(`[data-behavior-mark="${kind}"]`).length;
    expect([marks("collider"), marks("arrow"), marks("ring"), marks("joint")]).toEqual([
      1, 1, 1, 0,
    ]);
    expect(
      one.container.querySelector('[data-behavior-mark="collider"]')!.hasAttribute("data-sensor"),
    ).toBe(true);
    one.unmount();

    act(() => session.select(["link"]));
    const two = draw();
    expect(two.container.querySelectorAll('[data-behavior-mark="joint"]')).toHaveLength(1);
  });
});
