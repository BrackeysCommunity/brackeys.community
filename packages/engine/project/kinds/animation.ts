/**
 * The `animation` kind's file: clips over one atlas, with per-frame
 * durations, events and shape sets. Zod, scene/ and project/ only, so the
 * hosted service reads it; clips resolve to ticks in `anim/clips.ts`, which
 * checks them through `animationIssues` here.
 */
import { z } from "zod";

import { ID_PATTERN } from "../../game/fields";
import { didYouMean } from "../../scene/did-you-mean";
import { jsonPointer, makeIssue } from "../../scene/issues";
import { parseShape, SHAPE_SIGNATURES, SHAPE_TYPES } from "../../scene/shapes";
import type { SceneIssue, ShapeTuple } from "../../scene/types";
import { assetInfo, atlasFrameIssue, type AssetInfo } from "../asset-info";
import type { RefSite } from "../refs";
import type { AssetId } from "../types";
import { ATLAS_KIND } from "./atlas";
import { defineAssetKind, folderOf, perProjectEntries, type KindEnv } from "./define";

export const ANIMATION_KIND = "animation";
export const ANIMATION_VERSION = 1;
export const ANIMATION_SCHEMA_ID = `urn:jams-engine:animation:v${ANIMATION_VERSION}`;

/** A frame's duration when neither the clip nor the atlas gives one. */
export const DEFAULT_FRAME_MS = 100;

/**
 * How a clip plays: `loop` wraps; `once` stops on its last frame and
 * ends; `pingpong` runs back and forth; `hold` plays through once and
 * stays on its last frame without ending.
 */
export type ClipLoop = "loop" | "once" | "pingpong" | "hold";

export type AnimFrameDef = {
  /** The atlas frame's name. */
  frame: string;
  /** Default: the atlas frame's durationMs, else {@link DEFAULT_FRAME_MS}. */
  ms?: number;
  /** Raised as `anim:frame` when the frame is entered. */
  events?: readonly string[];
  /** Named shape sets (`hit`, `hurt-high`), local to the sprite's anchor, world metres. */
  shapes?: Readonly<Record<string, readonly ShapeTuple[]>>;
};

export type ClipDef = {
  name: string;
  /** An atlas tag: its frames and direction; `frames` overrides per frame by index. */
  tag?: string;
  frames?: readonly AnimFrameDef[];
  /** Default: the tag's direction ("pingpong" stays), else "loop". */
  loop?: ClipLoop;
  /** Default 1. */
  speed?: number;
  /** For "once": the clip that follows; omitted, it holds the last frame and raises `anim:end`. */
  next?: string;
};

/** An `animation:v1` file. */
export type AnimationFile = {
  $schema?: string;
  kind: typeof ANIMATION_KIND;
  v: typeof ANIMATION_VERSION;
  atlas: AssetId;
  clips: ClipDef[];
};

/** What a frame's shape set may be called. */
export const SHAPE_SET_NAME = /^[a-z][a-z0-9-]{0,31}$/;

export const CLIP_LOOPS = [
  "loop",
  "once",
  "pingpong",
  "hold",
] as const satisfies readonly ClipLoop[];

/** Kept loose: a tuple that doesn't parse is `animationIssues`' `frame-shape-invalid`, not a schema refusal. */
const shapeTuple = z
  .array(z.union([z.string(), z.number()]))
  .meta({ unit: "m" })
  .describe(
    `A shape tuple, local to the sprite's anchor: ${SHAPE_TYPES.map((t) => SHAPE_SIGNATURES[t]).join(" | ")}. Metres, y is down; rotDeg in degrees.`,
  );

const frameSchema = z
  .strictObject({
    frame: z.string().describe("The atlas frame's name."),
    ms: z
      .number()
      .positive()
      .optional()
      .describe(
        `How long the frame shows, rounded to whole ticks; default the atlas's, else ${DEFAULT_FRAME_MS}.`,
      ),
    events: z
      .array(z.string())
      .optional()
      .describe("Raised as `anim:frame` events on the tick the frame is entered."),
    shapes: z
      .record(z.string(), z.array(shapeTuple))
      .optional()
      .describe(
        "Named shape sets (hitboxes, hurtboxes) that game code queries; set names are lowercase with dashes.",
      ),
  })
  .describe("One frame of a clip.");

const clipSchema = z
  .strictObject({
    name: z.string().min(1).describe("The clip's name, which `anim` blocks and `next` use."),
    tag: z
      .string()
      .optional()
      .describe(
        "An atlas tag whose frames and direction the clip takes; `frames` overrides them by index.",
      ),
    frames: z
      .array(frameSchema)
      .optional()
      .describe(
        "The clip's frames in order; with `tag`, each replaces the tag's frame at its index.",
      ),
    loop: z
      .enum(CLIP_LOOPS)
      .optional()
      .describe(
        "loop wraps; once stops on its last frame and ends; pingpong runs back and forth; hold stops on its last frame without ending. Default: the tag's direction, else loop.",
      ),
    speed: z.number().positive().optional().describe("Multiplies the clip's pace; default 1."),
    next: z
      .string()
      .optional()
      .describe("For a once clip: the clip that follows; omitted, it holds its last frame."),
  })
  .describe("One clip: a tag of the atlas, its own frames, or both.");

const animationSchema: z.ZodType<AnimationFile> = z
  .strictObject({
    $schema: z.string().optional().describe("The animation JSON Schema this file follows."),
    kind: z.literal(ANIMATION_KIND).describe('Always "animation".'),
    v: z.literal(ANIMATION_VERSION).describe("Animation format version."),
    atlas: z.string().regex(ID_PATTERN).describe("The atlas asset whose frames the clips show."),
    clips: z.array(clipSchema).describe("The clips, keyed by name and co-edited per clip."),
  })
  .describe(
    "Clips over one atlas, with per-frame durations, events and shape sets, played on the simulation's ticks.",
  ) as unknown as z.ZodType<AnimationFile>;

/** What an `anim` block names: an animation doc, or an atlas whose tags are the clips. */
export type ClipSource = { animation: AnimationFile } | { atlas: AssetInfo };

/** The animation a clip source plays: the doc itself, or the atlas's tags as clips named after them. */
export function sourceAnimation(source: ClipSource): AnimationFile {
  if ("animation" in source) return source.animation;
  return {
    kind: ANIMATION_KIND,
    v: ANIMATION_VERSION,
    atlas: source.atlas.id,
    clips: (source.atlas.tags ?? []).map((t) => ({ name: t.name, tag: t.name })),
  };
}

/** The clip names an `anim` block's `clip` and `ctx.anim.play` may use, in file order. */
export const sourceClipNames = (source: ClipSource): string[] =>
  sourceAnimation(source).clips.map((c) => c.name);

const listed = (names: readonly string[]) =>
  names.length > 0 ? { expected: names.join(" | ") } : {};

/**
 * What's wrong with an animation file against its atlas's meta: the one
 * check every reader runs (the kind's validation, clip resolution, the
 * asset tools). `atlas` is the info of the asset `file.atlas` names, or
 * null when the host has none (a missing asset is the ref index's
 * `asset-missing`), and then only the checks that need no atlas run.
 *
 * `asset-kind` for an atlas id naming another kind; `anim-tag-unknown` and
 * `asset-frame-unknown` for a tag or frame the atlas lacks;
 * `frame-shape-invalid` for a shape set name that isn't lowercase with
 * dashes or a tuple that doesn't parse; `anim-clip-unknown` for a `next`
 * naming no clip; `schema` for a clip with no frames at all. Paths point
 * into the file by clip and frame index. Never throws.
 */
export function animationIssues(
  file: AnimationFile,
  atlas: AssetInfo | null | undefined,
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const clips = file.clips;
  const sheet = atlas?.kind === ATLAS_KIND ? atlas : null;
  if (atlas && !sheet)
    issues.push(
      makeIssue("asset-kind", {
        message: `the animation's atlas "${file.atlas}" is a ${atlas.kind}, not an atlas`,
        path: "/atlas",
        expected: ATLAS_KIND,
        got: atlas.kind,
      }),
    );
  const tagNames = sheet?.tags?.map((t) => t.name) ?? [];
  const clipNames = clips.map((c) => c.name);
  clips.forEach((clip, c) => {
    const at = (...rest: (string | number)[]) => jsonPointer(["clips", c, ...rest]);
    if (clip.tag === undefined && (clip.frames?.length ?? 0) === 0)
      issues.push(
        makeIssue("schema", {
          message: `clip "${clip.name}" has no frames: give it an atlas \`tag\` or \`frames\``,
          path: at(),
        }),
      );
    if (sheet && clip.tag !== undefined && !tagNames.includes(clip.tag))
      issues.push(
        makeIssue("anim-tag-unknown", {
          message: `clip "${clip.name}" names tag "${clip.tag}", which atlas "${file.atlas}" doesn't have${didYouMean(clip.tag, tagNames)}`,
          path: at("tag"),
          got: clip.tag,
          ...listed(tagNames),
        }),
      );
    clip.frames?.forEach((def, f) => {
      const unknown = atlasFrameIssue(sheet, def.frame, {
        who: `frame ${f} of clip "${clip.name}"`,
        path: at("frames", f, "frame"),
      });
      if (unknown) issues.push(unknown);
      for (const [set, shapes] of Object.entries(def.shapes ?? {})) {
        if (!SHAPE_SET_NAME.test(set))
          issues.push(
            makeIssue("frame-shape-invalid", {
              message: `frame ${f} of clip "${clip.name}" has a shape set named "${set}"; set names are lowercase letters, digits and dashes, starting with a letter, at most 32`,
              path: at("frames", f, "shapes", set),
              got: set,
              expected: String(SHAPE_SET_NAME),
            }),
          );
        shapes.forEach((shape, s) => {
          const parsed = parseShape(shape);
          if (parsed.ok) return;
          issues.push(
            makeIssue("frame-shape-invalid", {
              message: `shape ${s} of set "${set}" on frame ${f} of clip "${clip.name}": ${parsed.issue.message}`,
              path: at("frames", f, "shapes", set, s),
              ...(parsed.issue.expected === undefined ? {} : { expected: parsed.issue.expected }),
              ...(parsed.issue.got === undefined ? {} : { got: parsed.issue.got }),
            }),
          );
        });
      }
    });
    if (clip.next !== undefined && !clipNames.includes(clip.next))
      issues.push(
        makeIssue("anim-clip-unknown", {
          message: `clip "${clip.name}" goes next to "${clip.next}", which the animation doesn't have${didYouMean(clip.next, clipNames)}`,
          path: at("next"),
          got: clip.next,
          ...listed(clipNames),
        }),
      );
  });
  return issues;
}

/** Clips over one atlas, co-edited per clip; game code and the `anim` behavior read them on ticks. */
export const animationKind = defineAssetKind({
  kind: ANIMATION_KIND,
  title: "Animation",
  description:
    "Clips over one atlas: frames, durations, loop modes, per-frame events and hitbox shape sets, played on the simulation's ticks.",
  match: { jsonKind: ANIMATION_KIND },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "doc",
  runtime: "sim",
  version: ANIMATION_VERSION,
  schemaId: ANIMATION_SCHEMA_ID,
  schema: () => animationSchema,
  layout: {
    as: "map",
    fields: {
      atlas: { as: "atomic" },
      clips: {
        as: "keyed",
        id: "name",
        item: {
          as: "map",
          fields: { frames: { as: "list", item: { as: "atomic" } } },
          rest: { as: "atomic" },
        },
      },
    },
    rest: { as: "atomic" },
  },
  limits: { maxStateBytes: 262_144, maxItems: 512 },
  validate: (file: AnimationFile, env: KindEnv): SceneIssue[] =>
    animationIssues(file, env.project ? assetInfo(env.project, file.atlas) : null),
  refs: (file: AnimationFile): RefSite[] => [
    { pointer: "/atlas", id: file.atlas, kinds: [ATLAS_KIND] },
  ],
  /** The project's first atlas by path, else the new asset's own id for the author to replace. */
  empty: (env: KindEnv, { id }): AnimationFile => ({
    kind: ANIMATION_KIND,
    v: ANIMATION_VERSION,
    atlas: (env.project ? perProjectEntries(env.project, ATLAS_KIND)[0]?.id : undefined) ?? id,
    clips: [],
  }),
});
