import { useEffect, useId, useRef, useState } from "react";
import type * as Y from "yjs";

import type { ProjectSession } from "../../../collab/index";
import { readLog } from "../../../collab/log";
import { actorLabel, type LogEntry } from "../../../collab/types";
import type { EditorSession } from "../../../editor/index";
import {
  acceptedTimings,
  clampTiming,
  diffWords,
  sceneVersionName,
  SWAP_TIMINGS,
  swapStrategyFor,
  type SwapTiming,
} from "../../../game/live";
import type { GameDefinition, Registry } from "../../../game/types";
import {
  checkSceneVersion,
  formatSceneVersion,
  parseReleaseManifest,
  parseSceneVersion,
  readReleaseScene,
  readSceneVersion,
  type AssetId,
  type SceneVersion,
  type SceneVersionRead,
  type Sha256,
} from "../../../project/index";
import { diffExpanded } from "../../../scene/index";
import { isErrorIssue, leadIssue } from "../../../scene/issues";
import type {
  EditorLiveHost,
  EditorNotify,
  LiveBaseView,
  LivePublishProgress,
  LiveUsageView,
  LiveVersionView,
  PublishChannel,
} from "../../host";
import {
  Button,
  Confirm,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MicroLabel,
  Progress,
  Text,
  Textarea,
  type TextTone,
} from "../../kit/index";
import { buildOpenSceneVersion } from "../../session/open-scene-version";
import type { EditorProjectLink } from "../../session/use-scene-editor";
import { ChoiceGroup } from "./ChoiceGroup";
import { LIVE_CHANNELS, liveOnText, productionConfirmText, PUBLISHERS_ONLY } from "./live-wording";

// ─── Wording ─────────────────────────────────────────────

export const WHERE_TEXT: Readonly<Record<PublishChannel, string>> = {
  preview: "Preview: your team sees it on the preview link.",
  production: "Production: players get it. Only publishers can choose this.",
};

export const TIMING_TEXT: Readonly<Record<SwapTiming, string>> = {
  "next-load": "Next time the level loads",
  boundary: "At the next safe moment the game marks",
  now: "Now, while they play",
};

/** The tooltip on a timing the game doesn't list. */
export const TIMING_UNDECLARED =
  "This game doesn't accept this timing (GameDefinition.live.timings).";

export const IN_PLACE = "Players' worlds update in place.";
export const REBUILT =
  "The bounds or settings changed, so players' worlds are rebuilt and their state restored.";

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// ─── The checks ──────────────────────────────────────────

export type PublishCheckId = "fits" | "diff" | "data" | "today" | "editors";

export type PublishCheck = {
  id: PublishCheckId;
  text: string;
  tone: TextTone;
  /** Publish waits until this is fixed. */
  blocks?: true;
};

/** A built version, ready to upload. */
export type BuiltSceneVersion = {
  id: Sha256;
  version: SceneVersion;
  /** Its canonical `scene-version.json`. */
  text: string;
  texts: ReadonlyMap<Sha256, string>;
};

export type PublishChecks = {
  built: BuiltSceneVersion | null;
  lines: readonly PublishCheck[];
  /** The first blocking line's text; null when Publish may go ahead. */
  blocked: string | null;
};

/** The version file plus every doc it carries, each once: what the data limit counts. */
export function versionDataBytes(text: string, version: SceneVersion): number {
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  let bytes = encoder.encode(text).length;
  for (const asset of Object.values(version.assets)) {
    if (asset.storage !== "doc" || seen.has(asset.sha256)) continue;
    seen.add(asset.sha256);
    bytes += asset.bytes;
  }
  return bytes;
}

/**
 * "Edited since level-1@3 by Jo, Sam.": the people and agents whose edits to
 * the scene doc came after the scene's newest version; null with no newer
 * edit or no version yet.
 */
export function editedSinceText(
  log: readonly LogEntry[],
  last: { name: string; at: number } | null,
): string | null {
  if (!last) return null;
  const names: string[] = [];
  for (const entry of log) {
    if (entry.at <= last.at) continue;
    if (entry.actor.kind !== "user" && entry.actor.kind !== "agent") continue;
    const name = actorLabel(entry.actor);
    if (!names.includes(name)) names.push(name);
  }
  return names.length > 0 ? `Edited since ${last.name} by ${names.join(", ")}.` : null;
}

const toTexts = (texts: Readonly<Record<Sha256, string>>) =>
  new Map(Object.entries(texts) as [Sha256, string][]);

/** What players on the channel get now: the live version's scene, else the release's. */
function baseScene(
  base: LiveBaseView,
  scene: AssetId,
  registry: Registry,
  game: GameDefinition,
): SceneVersionRead | null {
  const texts = toTexts(base.texts);
  if (base.live) {
    const parsed = parseSceneVersion(base.live.descriptor);
    return parsed.ok ? readSceneVersion(parsed.version, texts, registry, game) : null;
  }
  if (!base.release) return null;
  const manifest = parseReleaseManifest(base.release.manifest);
  return manifest.ok ? readReleaseScene(manifest.manifest, scene, texts, registry, game) : null;
}

/** The diff against what the channel plays, and the strategy it implies; null when there is nothing to compare. */
export function diffCheck(
  base: LiveBaseView,
  built: Pick<BuiltSceneVersion, "version" | "texts">,
  registry: Registry,
  game: GameDefinition,
): PublishCheck | null {
  const before = baseScene(base, built.version.scene, registry, game);
  const after = readSceneVersion(built.version, built.texts, registry, game);
  if (!before?.ok || !after.ok) return null;
  const diff = diffExpanded(before.scene, after.scene);
  const text =
    swapStrategyFor(diff) === "reload" ? REBUILT : `${capitalised(diffWords(diff))}. ${IN_PLACE}`;
  return { id: "diff", text, tone: "muted" };
}

const levelTone = (used: number, max: number): TextTone =>
  used > max ? "danger" : used >= max * 0.8 ? "warning" : "muted";

export type PublishCheckInput = {
  project: ProjectSession;
  scene: AssetId;
  doc: Y.Doc;
  registry: Registry;
  game: GameDefinition;
  base: LiveBaseView;
  usage: LiveUsageView | null;
  /** The scene's newest version, for the editors-since line. */
  last: LiveVersionView | null;
  live: Pick<EditorLiveHost, "wording">;
};

/**
 * Builds the open scene and checks it for `base`'s channel: validation with
 * the running registry and the fit to the channel's release (one line,
 * "Fits v7" or the first issue), the diff against what the channel plays,
 * the data size, today's count and who edited since the last version.
 */
export async function publishChecks(input: PublishCheckInput): Promise<PublishChecks> {
  const { project, scene, doc, registry, game, base, usage, last, live } = input;
  const lines: PublishCheck[] = [];
  const next = sceneVersionName(scene, (base.latest ?? 0) + 1);
  const made = await buildOpenSceneVersion(project, scene, doc, registry, game);
  let built: BuiltSceneVersion | null = null;

  if (!made.ok) {
    const issue = leadIssue(made.issues);
    lines.push({
      id: "fits",
      text: issue?.message ?? "The scene doesn't build.",
      tone: "danger",
      blocks: true,
    });
  } else {
    const text = formatSceneVersion(made.version);
    built = { id: made.id, version: made.version, text, texts: made.texts };
    const manifest = base.release ? parseReleaseManifest(base.release.manifest) : null;
    const issues = made.issues.filter(isErrorIssue);
    if (base.release && manifest?.ok)
      issues.push(
        ...checkSceneVersion(manifest.manifest, made.version, made.texts, {
          registry,
          names: { version: next, release: `v${base.release.version}` },
        }),
      );
    const first = issues[0];
    if (!base.release)
      lines.push({
        id: "fits",
        text: `Nothing is on ${base.channel} yet: promote a release there first.`,
        tone: "danger",
        blocks: true,
      });
    else if (manifest && !manifest.ok)
      lines.push({
        id: "fits",
        text: `v${base.release.version}'s manifest doesn't read: ${leadIssue(manifest.issues)?.message ?? "unknown error"}`,
        tone: "danger",
        blocks: true,
      });
    else if (first) lines.push({ id: "fits", text: first.message, tone: "danger", blocks: true });
    else lines.push({ id: "fits", text: `Fits v${base.release.version}`, tone: "success" });

    const diff = diffCheck(base, built, registry, game);
    if (diff) lines.push(diff);

    const bytes = versionDataBytes(text, made.version);
    const max = live.wording.dataMaxBytes;
    lines.push({
      id: "data",
      text: live.wording.data(bytes),
      tone: levelTone(bytes, max),
      ...(bytes > max ? { blocks: true as const } : {}),
    });
  }

  if (usage) {
    const max = live.wording.versionsPerDay;
    const full = usage.today >= max;
    lines.push({
      id: "today",
      text: live.wording.today(usage.today),
      tone: full ? "danger" : levelTone(usage.today, max),
      ...(full ? { blocks: true as const } : {}),
    });
  }

  const since = editedSinceText(
    readLog(doc),
    last ? { name: sceneVersionName(scene, last.number), at: Date.parse(last.createdAt) } : null,
  );
  if (since) lines.push({ id: "editors", text: since, tone: "muted" });

  return { built, lines, blocked: lines.find((l) => l.blocks)?.text ?? null };
}

// ─── The dialog ──────────────────────────────────────────

/** A refusal from the host, as the dialog shows it. */
export type PublishRefusal = { code?: string; message: string; hint?: string };

/** A host's error as `{ code, message, hint }`. */
export function refusalOf(error: unknown): PublishRefusal {
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; message?: unknown; hint?: unknown };
    return {
      ...(typeof e.code === "string" ? { code: e.code } : {}),
      message: typeof e.message === "string" && e.message ? e.message : "The publish failed.",
      ...(typeof e.hint === "string" && e.hint ? { hint: e.hint } : {}),
    };
  }
  return { message: typeof error === "string" ? error : "The publish failed." };
}

type Phase = { step: "build" } | LivePublishProgress;

/** What the dialog says while a publish runs, and how far along it is (0 to 1, null while unknown). */
export function progressOf(phase: Phase): { text: string; value: number | null } {
  switch (phase.step) {
    case "build":
      return { text: "Building the version…", value: null };
    case "begin":
      return { text: "Starting the upload…", value: null };
    case "upload":
      return {
        text: `Uploading ${phase.sent} of ${phase.total} files…`,
        value: phase.total > 0 ? phase.sent / phase.total : null,
      };
    case "commit":
      return { text: "Saving the version…", value: 1 };
    case "promote":
      return { text: "Putting it on production…", value: 1 };
  }
}

/** The open scene's asset id: the link's, or the entry whose doc the editor has open. */
export function openSceneId(project: Pick<EditorProjectLink, "session" | "doc" | "scene">) {
  if (project.scene) return project.scene;
  for (const entry of project.session.view().byId.values())
    if (project.session.docNameFor(entry) === project.doc) return entry.id;
  return null;
}

/** How long the checks wait after an edit before building again. */
export const CHECKS_DEBOUNCE_MS = 400;

type Loaded<T> = { value: T } | { error: string };

/**
 * Publish scene, for the open scene: where (preview, or production for
 * publishers), when players get it (the game's declared timings), a note,
 * and the checks, run on open and again on each edit; then Publish builds
 * the doc as it is at that moment and hands it to the host, production
 * asking first.
 */
export function ScenePublishDialog({
  live,
  session,
  project,
  notify,
  onClose,
}: {
  live: EditorLiveHost;
  session: EditorSession;
  project: EditorProjectLink;
  notify?: EditorNotify;
  onClose: () => void;
}) {
  const scene = openSceneId(project);
  const registry = session.registry;
  const game = registry.game;
  const publisher = live.role().publisher;
  const accepted = acceptedTimings(game?.live);
  const title =
    project.flow?.scenes.find((s) => s.scene === scene)?.title ?? session.getResolved().name;

  const [channel, setChannel] = useState<PublishChannel>("preview");
  const [timing, setTiming] = useState<SwapTiming>(
    () => clampTiming(game?.live, "next-load").timing,
  );
  const [note, setNote] = useState("");
  const [bases, setBases] = useState<Partial<Record<PublishChannel, Loaded<LiveBaseView>>>>({});
  const [usage, setUsage] = useState<LiveUsageView | null>(null);
  const [last, setLast] = useState<LiveVersionView | null>(null);
  const [rev, setRev] = useState(0);
  const [checked, setChecked] = useState<{ channel: PublishChannel; checks: PublishChecks } | null>(
    null,
  );
  const [phase, setPhase] = useState<Phase | null>(null);
  const [refusal, setRefusal] = useState<PublishRefusal | null>(null);
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();
  const run = useRef(0);

  useEffect(() => {
    if (!scene) return;
    let alive = true;
    for (const c of LIVE_CHANNELS)
      live.base(scene, c).then(
        (value) => alive && setBases((b) => ({ ...b, [c]: { value } })),
        (error: unknown) =>
          alive && setBases((b) => ({ ...b, [c]: { error: refusalOf(error).message } })),
      );
    live.usage().then(
      (value) => alive && setUsage(value),
      () => {},
    );
    live.list(scene).then(
      (versions) => alive && setLast(versions[0] ?? null),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [live, scene]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => setRev((r) => r + 1), CHECKS_DEBOUNCE_MS);
    };
    session.doc.on("update", onUpdate);
    return () => {
      if (timer !== null) clearTimeout(timer);
      session.doc.off("update", onUpdate);
    };
  }, [session.doc]);

  const base = bases[channel];
  const baseView = base && "value" in base ? base.value : null;

  useEffect(() => {
    if (!scene || !game || !baseView) return;
    const ticket = ++run.current;
    void publishChecks({
      project: project.session,
      scene,
      doc: session.doc,
      registry,
      game,
      base: baseView,
      usage,
      last,
      live,
    }).then(
      (checks) => {
        if (ticket !== run.current) return;
        setChecked({ channel: baseView.channel, checks });
        setRefusal(null);
      },
      (error: unknown) => {
        if (ticket !== run.current) return;
        const text = refusalOf(error).message;
        const lines: PublishCheck[] = [{ id: "fits", text, tone: "danger", blocks: true }];
        setChecked({ channel: baseView.channel, checks: { built: null, lines, blocked: text } });
        setRefusal(null);
      },
    );
  }, [scene, game, baseView, usage, last, live, project.session, session.doc, registry, rev]);

  const unavailable = !scene
    ? "This scene isn't in the project's registry."
    : !game
      ? "Publishing a scene needs a game."
      : base && "error" in base
        ? base.error
        : null;
  const busy = phase !== null;
  const current = checked?.channel === channel ? checked.checks : null;
  const blocked = unavailable ?? (current ? current.blocked : "Checking…");
  const nextName = scene ? sceneVersionName(scene, (baseView?.latest ?? 0) + 1) : "";

  const publish = async () => {
    if (!scene || !game || !baseView) return;
    setRefusal(null);
    setPhase({ step: "build" });
    try {
      const fresh = await publishChecks({
        project: project.session,
        scene,
        doc: session.doc,
        registry,
        game,
        base: baseView,
        usage,
        last,
        live,
      });
      setChecked({ channel: baseView.channel, checks: fresh });
      // A blocking check is already a line of the Checks list.
      if (!fresh.built || fresh.blocked) return;
      const trimmed = note.trim();
      const published = await live.publish(
        fresh.built.text,
        Object.fromEntries(fresh.built.texts),
        { channel, timing, ...(trimmed ? { note: trimmed } : {}) },
        (progress) => setPhase(progress),
      );
      notify?.success(liveOnText(sceneVersionName(scene, published.number), published.channel));
      onClose();
    } catch (error) {
      setRefusal(refusalOf(error));
    } finally {
      setPhase(null);
    }
  };

  const onPublish = () => {
    if (channel === "production") setConfirming(true);
    else void publish();
  };

  const releaseOf = (c: PublishChannel) => {
    const b = bases[c];
    return b && "value" in b && b.value.release ? `on v${b.value.release.version}` : null;
  };

  const progress = phase ? progressOf(phase) : null;

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <DialogContent className="je-publish-scene" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Publish {title}</DialogTitle>
            <DialogDescription>
              One level, live over the channel's release, without a new release.
            </DialogDescription>
          </DialogHeader>

          <ChoiceGroup
            legend="Where"
            name="publish-scene-channel"
            choices={LIVE_CHANNELS}
            value={channel}
            disabled={busy}
            unavailable={(c) => c === "production" && !publisher}
            hint={() => PUBLISHERS_ONLY}
            label={(c) => {
              const on = releaseOf(c);
              return (
                <>
                  {WHERE_TEXT[c]}
                  {on ? <Text variant="muted"> · {on}</Text> : null}
                </>
              );
            }}
            onPick={(c) => {
              setChannel(c);
              setRefusal(null);
            }}
          />

          <ChoiceGroup
            legend="When players get it"
            name="publish-scene-timing"
            choices={SWAP_TIMINGS}
            value={timing}
            disabled={busy}
            unavailable={(t) => !accepted.includes(t)}
            hint={() => TIMING_UNDECLARED}
            label={(t) => TIMING_TEXT[t]}
            onPick={(t) => {
              setTiming(t);
              setRefusal(null);
            }}
          />

          <label htmlFor={noteId} className="je-run-field">
            <MicroLabel>Note</MicroLabel>
            <Textarea
              id={noteId}
              value={note}
              rows={2}
              maxLength={live.wording.noteMaxChars}
              placeholder={live.wording.notePlaceholder}
              disabled={busy}
              onChange={(e) => {
                setNote(e.target.value);
                setRefusal(null);
              }}
            />
          </label>

          <div
            className="je-insp-stack"
            data-gap="tight"
            role="list"
            aria-label="Checks"
            aria-live="polite"
          >
            <MicroLabel as="div">Checks</MicroLabel>
            {unavailable ? (
              <Text as="p" size="xs" variant="danger" role="listitem">
                {unavailable}
              </Text>
            ) : current ? (
              current.lines.map((line) => (
                <Text
                  key={line.id}
                  as="p"
                  size="xs"
                  variant={line.tone}
                  role="listitem"
                  data-check={line.id}
                >
                  {line.text}
                </Text>
              ))
            ) : (
              <Text as="p" size="xs" variant="muted" role="listitem">
                Checking…
              </Text>
            )}
          </div>

          {progress ? (
            <div className="je-insp-stack" data-gap="tight" role="status">
              <Progress
                value={progress.value === null ? null : Math.round(progress.value * 100)}
                label={progress.text}
              />
              <Text size="xs" variant="muted">
                {progress.text}
              </Text>
            </div>
          ) : null}

          {refusal ? (
            <div role="alert" className="je-insp-stack" data-gap="tight">
              <Text as="p" size="xs" variant="danger">
                {refusal.message}
              </Text>
              {refusal.hint ? (
                <Text as="p" size="xs" variant="muted">
                  {refusal.hint}
                </Text>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" cue={null} disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              busy={busy}
              disabled={blocked !== null}
              tooltip={blocked ?? undefined}
              onClick={onPublish}
            >
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Confirm
        open={confirming}
        onOpenChange={setConfirming}
        title="Publish to production?"
        message={productionConfirmText(nextName, timing)}
        confirmText="Publish"
        onConfirm={() => {
          void publish();
        }}
      />
    </>
  );
}
