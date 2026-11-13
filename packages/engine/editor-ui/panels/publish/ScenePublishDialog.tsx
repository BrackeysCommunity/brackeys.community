import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type * as Y from "yjs";

import type { ProjectSession } from "../../../collab/index";
import { readLog } from "../../../collab/log";
import { docValue } from "../../../collab/project-apply";
import { actorLabel, type LogEntry } from "../../../collab/types";
import type { EditorSession } from "../../../editor/index";
import {
  acceptedTimings,
  clampTiming,
  diffWords,
  SWAP_TIMINGS,
  swapStrategyFor,
  type SwapTiming,
} from "../../../game/live";
import type { GameDefinition, Registry } from "../../../game/types";
import {
  buildSceneVersion,
  checkSceneVersion,
  formatAssetDoc,
  formatSceneVersion,
  parseReleaseManifest,
  parseSceneVersion,
  readReleaseScene,
  readSceneVersion,
  type AssetEntry,
  type AssetId,
  type BuildSceneVersionResult,
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
  Hint,
  MicroLabel,
  Progress,
  Radio,
  Text,
  Textarea,
  type TextTone,
} from "../../kit/index";
import type { EditorProjectLink } from "../../session/use-scene-editor";

// ─── Wording ─────────────────────────────────────────────

const CHANNELS: readonly PublishChannel[] = ["preview", "production"];

export const WHERE_TEXT: Readonly<Record<PublishChannel, string>> = {
  preview: "Preview: your team sees it on the preview link.",
  production: "Production: players get it. Only publishers can choose this.",
};

/** The tooltip on Production for an editor who isn't a publisher. */
export const PUBLISHERS_ONLY = "Only publishers can choose this.";

export const TIMING_TEXT: Readonly<Record<SwapTiming, string>> = {
  "next-load": "Next time the level loads",
  boundary: "At the next safe moment the game marks",
  now: "Now, while they play",
};

/** The tooltip on a timing the game doesn't list. */
export const TIMING_UNDECLARED =
  "This game doesn't accept this timing (GameDefinition.live.timings).";

/** When players get a version, as the production confirm says it. */
const CONFIRM_WHEN: Readonly<Record<SwapTiming, string>> = {
  "next-load": "next time the level loads",
  boundary: "at the next safe moment",
  now: "now",
};

export const IN_PLACE = "Players' worlds update in place.";
export const REBUILT =
  "The bounds or settings changed, so players' worlds are rebuilt and their state restored.";

/** A scene version as the host numbers it: `level-1@4`. */
export const numberedVersion = (scene: AssetId, number: number): string => `${scene}@${number}`;

/** The production confirm's question. */
export const productionConfirmText = (version: string, timing: SwapTiming): string =>
  `Players will get ${version} ${CONFIRM_WHEN[timing]}. You can roll back or stop it at any time.`;

/** The toast after a publish. */
export const publishedText = (version: string, channel: PublishChannel | null): string =>
  channel ? `${version} is live on ${channel}.` : `${version} is published.`;

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// ─── Building the open scene ─────────────────────────────

/** The canonical text of a project doc as its file would hold it; null for a kind with no text. */
function docText(project: ProjectSession, entry: AssetEntry, doc: Y.Doc): string | null {
  const def = project.kinds.get(entry.kind);
  if (def?.storage !== "doc") return null;
  const name = project.docNameFor(entry);
  const layout = name ? project.get(name)?.layout : undefined;
  try {
    const value = docValue({ doc, kind: entry.kind, ...(layout ? { layout } : {}) });
    return value === undefined ? null : formatAssetDoc(def, value);
  } catch {
    return null;
  }
}

/** Every open project doc's text by asset id, `scene`'s from `doc`. */
function openTexts(project: ProjectSession, scene: AssetId, doc: Y.Doc): Map<AssetId, string> {
  const out = new Map<AssetId, string>();
  for (const entry of project.view().byId.values()) {
    const name = project.docNameFor(entry);
    const from = entry.id === scene ? doc : name ? project.get(name)?.doc : undefined;
    if (!from) continue;
    const text = docText(project, entry, from);
    if (text !== null) out.set(entry.id, text);
  }
  return out;
}

/**
 * `buildSceneVersion` over `doc` as it is now and the project's docs,
 * opening the docs it reaches that nobody has open (a few rounds deep) and
 * letting them go again after.
 */
export async function buildOpenSceneVersion(
  project: ProjectSession,
  scene: AssetId,
  doc: Y.Doc,
  registry: Registry,
  game: GameDefinition,
): Promise<BuildSceneVersionResult> {
  const opened: string[] = [];
  try {
    for (let round = 0; ; round++) {
      const result = await buildSceneVersion({
        view: project.view(),
        texts: openTexts(project, scene, doc),
        build: project.hashes,
        game,
        registry,
        scene,
      });
      if (result.ok || round >= 4) return result;
      const closed = result.issues
        .filter((i) => i.code === "asset-missing")
        .flatMap((i) => i.entityIds)
        .map((id) => project.view().byId.get(id))
        .map((entry) => (entry ? project.docNameFor(entry) : null))
        .filter((name): name is string => !!name && !project.get(name) && !opened.includes(name));
      if (closed.length === 0) return result;
      await Promise.all(
        closed.map((name) => {
          opened.push(name);
          return project.open(name).catch(() => {});
        }),
      );
    }
  } finally {
    for (const name of opened) if (project.get(name)) project.release(name);
  }
}

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
  const next = numberedVersion(scene, (base.latest ?? 0) + 1);
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
    last ? { name: numberedVersion(scene, last.number), at: Date.parse(last.createdAt) } : null,
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
    for (const c of CHANNELS)
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
        if (ticket === run.current) setChecked({ channel: baseView.channel, checks });
      },
      (error: unknown) => {
        if (ticket !== run.current) return;
        const text = refusalOf(error).message;
        const lines: PublishCheck[] = [{ id: "fits", text, tone: "danger", blocks: true }];
        setChecked({ channel: baseView.channel, checks: { built: null, lines, blocked: text } });
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
  const nextName = scene ? numberedVersion(scene, (baseView?.latest ?? 0) + 1) : "";

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
      if (!fresh.built || fresh.blocked) {
        setRefusal({ message: fresh.blocked ?? "The scene doesn't build." });
        return;
      }
      const trimmed = note.trim();
      const published = await live.publish(
        fresh.built.text,
        Object.fromEntries(fresh.built.texts),
        { channel, timing, ...(trimmed ? { note: trimmed } : {}) },
        (progress) => setPhase(progress),
      );
      notify?.success(publishedText(numberedVersion(scene, published.number), published.channel));
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

          <div className="je-publish-scene-group" role="radiogroup" aria-label="Where">
            <MicroLabel as="div">Where</MicroLabel>
            {CHANNELS.map((c) => {
              const locked = c === "production" && !publisher;
              const on = releaseOf(c);
              return (
                <Choice
                  key={c}
                  name="publish-scene-channel"
                  value={c}
                  checked={channel === c}
                  disabled={locked || busy}
                  hint={locked ? PUBLISHERS_ONLY : null}
                  onPick={() => setChannel(c)}
                >
                  {WHERE_TEXT[c]}
                  {on ? <Text variant="muted"> · {on}</Text> : null}
                </Choice>
              );
            })}
          </div>

          <div
            className="je-publish-scene-group"
            role="radiogroup"
            aria-label="When players get it"
          >
            <MicroLabel as="div">When players get it</MicroLabel>
            {SWAP_TIMINGS.map((t) => {
              const undeclared = !accepted.includes(t);
              return (
                <Choice
                  key={t}
                  name="publish-scene-timing"
                  value={t}
                  checked={timing === t}
                  disabled={undeclared || busy}
                  hint={undeclared ? TIMING_UNDECLARED : null}
                  onPick={() => setTiming(t)}
                >
                  {TIMING_TEXT[t]}
                </Choice>
              );
            })}
          </div>

          <label htmlFor={noteId} className="je-run-field">
            <MicroLabel>Note</MicroLabel>
            <Textarea
              id={noteId}
              value={note}
              rows={2}
              maxLength={live.wording.noteMaxChars}
              placeholder={live.wording.notePlaceholder}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div
            className="je-publish-scene-group"
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
            <div className="je-publish-scene-progress" role="status">
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
            <div role="alert" className="je-publish-scene-refusal">
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

/** One radio of a group; a disabled one says why on hover and focus. */
function Choice({
  name,
  value,
  checked,
  disabled,
  hint,
  onPick,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  hint: string | null;
  onPick: () => void;
  children: ReactNode;
}) {
  const row = (
    <label
      className="je-insp-row"
      data-align="start"
      data-gap="tight"
      data-disabled={disabled ? "" : undefined}
      tabIndex={disabled && hint ? 0 : undefined}
    >
      <Radio
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onPick}
        {...(disabled && hint ? { "aria-description": hint } : {})}
      />
      <Text size="xs" variant={disabled ? "muted" : "primary"}>
        {children}
      </Text>
    </label>
  );
  return hint ? <Hint content={hint}>{row}</Hint> : row;
}
