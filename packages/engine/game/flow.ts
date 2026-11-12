/**
 * Scene flow's data: what a request, a transition and a sublevel are, and
 * the one rule for whether a scene is listed and may start, be gone to or
 * be attached. Pure, so the scene-list kind, the runtime, the CLI and the
 * export plan all judge a scene the same way.
 */
import type { SceneListEntry } from "../project/kinds/scene-list";
import type { AssetId } from "../project/types";
import { makeIssue } from "../scene/issues";
import type { PrefabLibrary, Pt, SceneDefinition, SceneIssue } from "../scene/types";
import type { JsonValue } from "./types";

export type { SceneListEntry };

/** How a scene change looks; transitions are visual only and run in the host. */
export type TransitionSpec = { kind: "none" | "fade" | (string & {}); ms?: number; color?: number };

/** A scene change game code asks for with `ctx.flow.request`. */
export type FlowRequest = {
  to: AssetId;
  /** A marker or any entity id in the next scene; the game reads it in `onLoad` as `ctx.flow.entry`. */
  entry?: string;
  transition?: TransitionSpec;
  /** Replaces `ctx.persist` before the next load. */
  persist?: JsonValue;
};

/** A listed scene as a host resolves it: its definition and the prefabs its instances name. */
export type LibraryScene = { def: SceneDefinition; prefabs: PrefabLibrary };

/** The scenes a runtime may load or attach: the scene list's entries and each listed scene. */
export type SceneLibrary = {
  /** In list order. */
  readonly list: readonly SceneListEntry[];
  readonly scenes: ReadonlyMap<AssetId, LibraryScene>;
};

export type SublevelOptions = {
  /** Prefixes its entities' ids (`<label>:<id>`); an id-pattern word no other sublevel holds. */
  label: string;
  /** World offset of the sublevel's origin, metres; on a grid scene a whole number of cells. Default [0, 0]. */
  at?: Pt;
  /** Added to every entity's z. */
  z?: number;
};

export type SublevelResult =
  | { ok: true; entities: readonly string[] }
  | { ok: false; issue: SceneIssue };

export type SublevelInfo = { label: string; scene: AssetId; at: Pt };

/** What a scene is asked to be: the start of a game, the target of a `go`, or a sublevel attached beside one. */
export type FlowUse = "start" | "go" | "attach";

/**
 * Why `id` can't be used as `use` under `list`, or null when it can. A
 * start or a `go` target must be listed and not a sublevel; an attached
 * scene must be listed. A missing start is `start-scene-missing`; a `go` to
 * a scene that isn't a main scene of the list is `scene-unlisted` as an
 * error; an attach of an unlisted scene is `sublevel-invalid` with
 * `detail.reason` "unlisted".
 */
export function flowIssue(
  list: readonly SceneListEntry[],
  id: AssetId | null,
  use: FlowUse,
): SceneIssue | null {
  const entry = id === null ? undefined : list.find((e) => e.scene === id);
  const named = id === null ? "" : `"${id}"`;
  if (use === "start") {
    if (id === null)
      return makeIssue("start-scene-missing", { message: "the scene list names no start scene" });
    if (!entry)
      return makeIssue("start-scene-missing", {
        message: `the start scene ${named} isn't in the scene list`,
        entityIds: [id],
      });
    if (entry.sublevel)
      return makeIssue("start-scene-missing", {
        message: `the start scene ${named} is listed as a sublevel, which only attaches beside a main scene`,
        entityIds: [id],
      });
    return null;
  }
  if (use === "go") {
    if (id === null || !entry)
      return makeIssue("scene-unlisted", {
        severity: "error",
        message:
          id === null
            ? "no scene to go to"
            : `${named} isn't in the scene list, so flow can't load it`,
        entityIds: id === null ? [] : [id],
      });
    if (entry.sublevel)
      return makeIssue("scene-unlisted", {
        severity: "error",
        message: `${named} is listed as a sublevel; attach it with ctx.flow.attach instead of going to it`,
        entityIds: [id!],
      });
    return null;
  }
  if (id === null || !entry)
    return makeIssue("sublevel-invalid", {
      message:
        id === null
          ? "no scene to attach"
          : `${named} isn't in the scene list, so it can't attach as a sublevel`,
      entityIds: id === null ? [] : [id],
      detail: { reason: "unlisted" },
    });
  return null;
}
