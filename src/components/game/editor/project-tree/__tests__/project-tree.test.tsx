// @vitest-environment jsdom
import type { AssetEntry, ProjectTreeNode } from "@jams/engine/project";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { ProjectTree } from "@/components/game/editor/project-tree/project-tree";
import { ASSET_DRAG_TYPE, readAssetDrag } from "@/components/game/editor/project-tree/tree-rows";
import type { ProjectTreeProps } from "@/components/game/editor/project-tree/types";

import { entry, gone, hero, ice, jump, level, peer, PROJECT, tree } from "./fixtures";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ toast: { error: toastError, success: vi.fn() } }));

function setup(props: Partial<ProjectTreeProps> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    onDropFiles: vi.fn(),
  };
  const view = render(
    <ProjectTree
      projectId={PROJECT}
      projectName="Yard"
      nodes={tree()}
      trash={[gone]}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
}

const files = () => within(screen.getByRole("list", { name: "Files" }));
const rowOf = (name: string) => files().getByText(name).closest("li")!;

/** jsdom lays nothing out: each row gets a 20px band by its place in the list, for dnd-kit. */
const ROW_PX = 20;
beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const li = this.closest("li");
    const i = li ? [...(li.parentElement?.children ?? [])].indexOf(li) : -1;
    return DOMRect.fromRect(i < 0 ? {} : { x: 0, y: i * ROW_PX, width: 200, height: ROW_PX });
  });
});
afterAll(() => vi.restoreAllMocks());
afterEach(() => {
  cleanup();
  toastError.mockReset();
});

async function drag(from: HTMLElement, to: HTMLElement) {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const at = (r: DOMRect) => ({ clientX: r.x + 50, clientY: r.y + r.height / 2 });
  await act(async () => {
    fireEvent.pointerDown(from, { ...at(a), button: 0, isPrimary: true, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: a.x + 50, clientY: a.y + 30, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerMove(document, { ...at(b), pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerUp(document, { ...at(b), pointerId: 1 });
  });
  await act(() => new Promise((done) => setTimeout(done, 60)));
}

/** A drag of desktop files over `target`, then a drop. */
function dropFiles(target: Element, list: File[]) {
  const dataTransfer = { types: ["Files"], files: list, dropEffect: "none" };
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

describe("ProjectTree", () => {
  it("renders folders, assets with their kind icons, and greyed read-only code", () => {
    const { onOpen } = setup();
    const names = files()
      .getAllByRole("listitem")
      .map((li) => li.textContent?.replace(/\d+$/, ""));
    expect(names).toEqual([
      "Yard",
      "scenes",
      "level-1.json",
      "sfx",
      "jump.ogg",
      "sprites",
      "hero.png",
      "src",
      "game.ts",
      "ice.material.json",
    ]);
    expect(rowOf("Yard").textContent).toContain("5");
    expect(rowOf("hero.png").dataset.kind).toBe("texture");
    expect(rowOf("hero.png").querySelector("svg")).not.toBeNull();

    const code = rowOf("game.ts");
    expect(code.dataset.kind).toBe("code");
    expect(within(code).queryByRole("button")).toBeNull();
    expect(code.querySelector("[aria-disabled=true]")).not.toBeNull();

    fireEvent.click(files().getByRole("button", { name: /^hero\.png/ }));
    expect(onOpen).toHaveBeenCalledWith(hero);
  });

  it("collapses a folder and shows a skeleton while loading", () => {
    setup({ loading: true, nodes: [] });
    expect(files().getByLabelText("Loading").querySelectorAll("[data-slot=skeleton]")).toHaveLength(
      3,
    );
    cleanup();
    setup();
    fireEvent.click(files().getByRole("button", { name: /^sprites/ }));
    expect(files().queryByText("hero.png")).toBeNull();
    expect(
      files()
        .getByRole("button", { name: /^sprites/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("renames in place: F2, a checked name, Enter commits, Escape cancels", async () => {
    const { onRename } = setup();
    const button = files().getByRole("button", { name: /^hero\.png/ });
    fireEvent.keyDown(button, { key: "F2" });
    const input = files().getByLabelText<HTMLInputElement>("File name");
    expect(input.value).toBe("hero.png");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);

    fireEvent.change(input, { target: { value: "bad/name.png" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(files().getByRole("alert").textContent).toMatch(/letters, digits/);
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "player.png" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(onRename).toHaveBeenCalledWith(hero, { file: "player.png" });
    expect(files().queryByLabelText("File name")).toBeNull();

    fireEvent.click(files().getByRole("button", { name: "Rename jump.ogg" }));
    fireEvent.change(files().getByLabelText("File name"), { target: { value: "hop.ogg" } });
    fireEvent.keyDown(files().getByLabelText("File name"), { key: "Escape" });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(files().getByText("jump.ogg")).toBeTruthy();
  });

  it("refuses a name a sibling already has, ignoring case", () => {
    const nodes: ProjectTreeNode[] = [
      { type: "asset", entry: ice },
      { type: "asset", entry: { ...hero, path: "hero.png" } },
    ];
    const { onRename } = setup({ nodes });
    fireEvent.keyDown(files().getByRole("button", { name: /^hero\.png/ }), { key: "F2" });
    const input = files().getByLabelText("File name");
    fireEvent.change(input, { target: { value: "ICE.material.json" } });
    fireEvent.blur(input);
    expect(files().getByRole("alert").textContent).toMatch(/already has/);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("shows a failed rename as a toast", async () => {
    setup({ onRename: () => Promise.reject(new Error("path-taken")) });
    fireEvent.keyDown(files().getByRole("button", { name: /^hero\.png/ }), { key: "F2" });
    const input = files().getByLabelText("File name");
    fireEvent.change(input, { target: { value: "x.png" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(toastError).toHaveBeenCalledWith("path-taken");
  });

  it("drags an asset onto a folder or the root to move it", async () => {
    const { onMove } = setup();
    await drag(
      files().getByRole("button", { name: /^hero\.png/ }),
      files().getByRole("button", { name: /^sfx/ }),
    );
    expect(onMove).toHaveBeenCalledWith(["hero"], "sfx/");

    await drag(files().getByRole("button", { name: /^jump\.ogg/ }), rowOf("Yard"));
    expect(onMove).toHaveBeenLastCalledWith(["jump"], "");

    // Onto its own folder is no move.
    await drag(
      files().getByRole("button", { name: /^level-1\.json/ }),
      files().getByRole("button", { name: /^scenes/ }),
    );
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it("deletes through the confirm when nothing references the asset", async () => {
    const { onDelete } = setup({ referrersOf: () => [] });
    fireEvent.click(files().getByRole("button", { name: "Delete hero.png" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Move hero.png to the trash?");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Move to trash" }));
    });
    expect(onDelete).toHaveBeenCalledWith(hero, { force: false, referrers: [] });
  });

  it("lists referrers and deletes anyway with force", async () => {
    const referrers = [{ id: "level-1", kind: "scene", pointer: "/entities/@crate/material" }];
    const { onDelete } = setup({ referrersOf: (id) => (id === "ice" ? referrers : []) });
    fireEvent.keyDown(files().getByRole("button", { name: /^ice\.material\.json/ }), {
      key: "Delete",
    });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("ice.material.json is in use");
    const used = within(within(dialog).getByRole("list", { name: "Used by" })).getAllByRole(
      "listitem",
    );
    expect(used.map((li) => li.textContent)).toEqual(["level-1/entities/@crate/material"]);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete anyway" }));
    });
    expect(onDelete).toHaveBeenCalledWith(ice, { force: true, referrers });
  });

  it("turns a refused delete into the in-use variant", async () => {
    const referrers = [{ id: "level-1", kind: "scene", pointer: "/entities/@hero/sprite" }];
    const onDelete = vi
      .fn()
      .mockResolvedValueOnce({ inUse: referrers })
      .mockResolvedValueOnce(undefined);
    setup({ onDelete });
    fireEvent.click(files().getByRole("button", { name: "Delete hero.png" }));
    let dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Move to trash" }));
    });
    dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("hero.png is in use");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete anyway" }));
    });
    expect(onDelete).toHaveBeenLastCalledWith(hero, { force: true, referrers });
  });

  it("lists the trash with Restore", () => {
    const { onRestore } = setup();
    const trash = within(screen.getByRole("region", { name: "Trash" }));
    expect(trash.queryByText("old.png")).toBeNull();
    fireEvent.click(trash.getByRole("button", { name: /Trash/ }));
    expect(trash.getByText("old.png").closest("li")?.textContent).toContain("in sprites/");
    fireEvent.click(trash.getByRole("button", { name: "Restore old.png" }));
    expect(onRestore).toHaveBeenCalledWith(gone);
  });

  it("passes dropped files to onDropFiles with the folder they landed on", () => {
    const { onDropFiles } = setup();
    const png = new File(["x"], "coin.png", { type: "image/png" });
    dropFiles(files().getByRole("button", { name: /^sprites/ }), [png]);
    expect(onDropFiles).toHaveBeenCalledWith([png], "sprites/");

    dropFiles(files().getByRole("button", { name: /^jump\.ogg/ }), [png]);
    expect(onDropFiles).toHaveBeenLastCalledWith([png], "sfx/");

    dropFiles(rowOf("Yard"), [png]);
    expect(onDropFiles).toHaveBeenLastCalledWith([png], "");
  });

  it("takes no edits when read-only", async () => {
    const { onDropFiles, onMove } = setup({ readOnly: true });
    expect(files().queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(files().queryByRole("button", { name: /^Rename / })).toBeNull();
    dropFiles(rowOf("Yard"), [new File(["x"], "a.png")]);
    expect(onDropFiles).not.toHaveBeenCalled();
    await drag(
      files().getByRole("button", { name: /^hero\.png/ }),
      files().getByRole("button", { name: /^sfx/ }),
    );
    expect(onMove).not.toHaveBeenCalled();
    const trash = within(screen.getByRole("region", { name: "Trash" }));
    fireEvent.click(trash.getByRole("button", { name: /Trash/ }));
    expect(trash.queryByRole("button", { name: /^Restore/ })).toBeNull();
  });

  it("shows each peer on the row of the doc they're in, and inside closed folders", () => {
    const peersByDoc = new Map([
      [`scene:${PROJECT}.${level.key}`, [peer("bo", "Bo", `scene:${PROJECT}.${level.key}`, 2)]],
      [
        `asset:${PROJECT}.${jump.key}`,
        [
          peer("cy", "Cy", `asset:${PROJECT}.${jump.key}`, 3),
          peer("cy", "Cy", `asset:${PROJECT}.${jump.key}`, 4),
        ],
      ],
      [null, [peer("di", "Di", null, 5)]],
    ]);
    setup({ peersByDoc });
    expect(within(rowOf("level-1.json")).getByRole("img", { name: "Open by Bo" })).toBeTruthy();
    expect(within(rowOf("jump.ogg")).getByRole("img", { name: "Open by Cy" })).toBeTruthy();
    expect(within(rowOf("hero.png")).queryByRole("img")).toBeNull();
    expect(within(rowOf("Yard")).getByRole("img", { name: "On the overview: Di" })).toBeTruthy();
    // An open folder leaves the faces to its rows.
    expect(within(rowOf("scenes")).queryByRole("img", { name: /Bo/ })).toBeNull();
    fireEvent.click(files().getByRole("button", { name: /^scenes/ }));
    expect(within(rowOf("scenes")).getByRole("img", { name: "Open inside by Bo" })).toBeTruthy();
  });
});

describe("asset rows as drag sources", () => {
  const sheet = entry("ksheet", "sprites/sheet.png", "atlas");
  const withSheet = (): ProjectTreeNode[] => [
    ...tree().filter((n) => n.type !== "folder" || n.path !== "sprites"),
    {
      type: "folder",
      path: "sprites",
      children: [
        { type: "asset", entry: hero },
        { type: "asset", entry: sheet },
      ],
    },
  ];
  const assetInfo = (e: AssetEntry, frame?: string) => ({
    id: e.id,
    kind: e.kind,
    ...(e.kind === "atlas" ? { frames: ["idle", "run-1"] } : {}),
    ...(frame ? { size: [16, 16] as [number, number] } : {}),
  });

  function transfer() {
    const data = new Map<string, string>();
    return {
      get types() {
        return [...data.keys()];
      },
      setData: (type: string, value: string) => void data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "all",
      dropEffect: "none",
    };
  }
  const dragStart = (el: HTMLElement) => {
    const dataTransfer = transfer();
    fireEvent.dragStart(el, { dataTransfer });
    return dataTransfer;
  };

  it("carries an asset under its own drag type", () => {
    setup({ assetInfo });
    const data = dragStart(files().getByRole("button", { name: /^hero\.png/ }));
    expect(data.types).toEqual([ASSET_DRAG_TYPE]);
    expect(readAssetDrag(data as unknown as DataTransfer)).toEqual({
      entry: hero,
      info: { id: "hero", kind: "texture" },
    });
  });

  it("expands an atlas row to its frames, each dragging the asset and frame", () => {
    setup({ assetInfo, nodes: withSheet() });
    expect(files().queryByText("run-1")).toBeNull();
    fireEvent.click(files().getByRole("button", { name: "Show the frames of sheet.png" }));
    const frame = files().getByRole("button", { name: "run-1" });
    expect(frame.getAttribute("draggable")).toBe("true");
    const data = dragStart(frame);
    expect(readAssetDrag(data as unknown as DataTransfer)).toEqual({
      entry: sheet,
      info: { id: "sheet", kind: "atlas", frames: ["idle", "run-1"], size: [16, 16] },
      frame: "run-1",
    });
    fireEvent.click(files().getByRole("button", { name: "Hide the frames of sheet.png" }));
    expect(files().queryByText("run-1")).toBeNull();
  });

  it("drags nothing natively without assetInfo or for viewers", () => {
    setup();
    expect(
      files()
        .getByRole("button", { name: /^hero\.png/ })
        .hasAttribute("draggable"),
    ).toBe(false);
    cleanup();
    setup({ assetInfo, readOnly: true });
    expect(
      files()
        .getByRole("button", { name: /^hero\.png/ })
        .hasAttribute("draggable"),
    ).toBe(false);
  });

  it("still moves between folders, by pointer or by a native drag onto a folder", async () => {
    const { onMove } = setup({ assetInfo });
    await drag(
      files().getByRole("button", { name: /^hero\.png/ }),
      files().getByRole("button", { name: /^sfx/ }),
    );
    expect(onMove).toHaveBeenCalledWith(["hero"], "sfx/");

    const dataTransfer = dragStart(files().getByRole("button", { name: /^jump\.ogg/ }));
    fireEvent.dragOver(rowOf("sprites"), { dataTransfer });
    await act(async () => {
      fireEvent.drop(rowOf("sprites"), { dataTransfer });
    });
    expect(onMove).toHaveBeenLastCalledWith(["jump"], "sprites/");
  });
});
