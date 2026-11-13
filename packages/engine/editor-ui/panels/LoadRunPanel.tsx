import type { Store } from "@tanstack/store";
import { useId, useMemo, useState } from "react";

import type { EditorSession } from "../../editor/index";
import { resolveTime, type Registry, type TimeKind } from "../../game/index";
import type { PlayOptions, StagedVersion } from "../../index";
import type { Sha256 } from "../../project/index";
import type { EditorNotify } from "../host";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  MicroLabel,
  Spinner,
  Text,
  Textarea,
  type BadgeVariant,
} from "../kit/index";
import {
  PendingProvider,
  useBusy,
  useOwnOrSharedPending,
  usePending,
} from "../pending/use-pending";
import { parseRun, runIsStale, runStart, type LoadedRun } from "../session/loaded-run";
import { useEditorDoc, useEditorPrefabs } from "../session/use-editor-store";
import { useStoreValue } from "../session/use-store-value";

/** Markers listed before the rest are summarised as a count. */
const MAX_EVENTS = 50;

/** The pending scope of reading a recording file. */
export const READ_RUN_SCOPE = "run:read-file";

function readText(file: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => fail(reader.error ?? new Error("couldn't read the file"));
    reader.readAsText(file);
  });
}

/** `tick` as seconds at the recording's tick rate. */
const seconds = (tick: number, tickRate: number) => `${(tick / tickRate).toFixed(1)}s`;

/**
 * A recording's length and marker times. A fixed clock's ticks are elapsed
 * time; a turns or event game skips idle ticks, so its ticks are only steps.
 */
function runTimes(recording: LoadedRun["recording"], kind: TimeKind) {
  if (kind === "fixed") {
    return {
      length: `${recording.ticks} ticks (${seconds(recording.ticks, recording.time.rate)})`,
      at: (tick: number) => seconds(tick, recording.time.rate),
    };
  }
  return {
    length: `${recording.ticks} steps`,
    at: (tick: number) => `step ${tick}`,
  };
}

/** Looks up a live version this editor holds: Live in Play's `liveVersion`. */
export type HeldVersion = (id: Sha256) => StagedVersion | null;

/**
 * What Replay does with the live versions a run played, checked against the
 * versions this editor holds when `held` is given: null for a run that
 * played none. `blocked` when the run starts on a version it lacks; `stopsAt`
 * the time of the first one it reaches and lacks.
 */
function liveReplay(
  recording: LoadedRun["recording"],
  held: HeldVersion | undefined,
  at: (tick: number) => string,
): { text: string; caveat: boolean; blocked: boolean; stopsAt: string | null } | null {
  const swaps = recording.swaps ?? [];
  if (recording.sceneVersion === undefined && swaps.length === 0) return null;
  if (!held) {
    return {
      text: "This run played live versions of the scene. Replay needs the ones Live in Play built in this editor, and stops where the run reached a version this editor doesn't have.",
      caveat: true,
      blocked: false,
      stopsAt: null,
    };
  }
  const missing = (id: Sha256 | null) => id !== null && held(id) === null;
  if (recording.sceneVersion !== undefined && missing(recording.sceneVersion)) {
    return {
      text: "This run starts on a live version of the scene this editor doesn't have, so it can't replay here.",
      caveat: true,
      blocked: true,
      stopsAt: null,
    };
  }
  const gone = swaps.find((swap) => missing(swap.version));
  if (gone) {
    const when = at(gone.tick);
    return {
      text: `Replay stops at ${when}: the run reached a live version of the scene this editor doesn't have.`,
      caveat: true,
      blocked: false,
      stopsAt: when,
    };
  }
  return {
    text: "This run played live versions of the scene that this editor holds, so Replay plays all of it.",
    caveat: false,
    blocked: false,
    stopsAt: null,
  };
}

const OUTCOME_VARIANT: Record<string, BadgeVariant> = {
  won: "success",
  lost: "destructive",
};

function LoadRunDialog({
  open,
  onOpenChange,
  onLoaded,
  notify,
  registry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoaded: (run: LoadedRun) => void;
  notify: EditorNotify;
  registry: Pick<Registry, "time">;
}) {
  const [pasted, setPasted] = useState("");
  const fileId = useId();
  const pasteId = useId();
  const pending = usePending();
  const reading = useBusy(READ_RUN_SCOPE);

  const load = (text: string, name: string) => {
    const parsed = parseRun(text, name, registry);
    if (!parsed.ok) {
      notify.error("Couldn't load that run", { description: parsed.error });
      return;
    }
    setPasted("");
    onLoaded(parsed.run);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Load a run</DialogTitle>
          <DialogDescription>
            A run recording, or a playtest report as the scene CLI's playtest --json prints it. Its
            trail, markers and outcome draw over the scene, and Replay plays its input again.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={fileId} className="je-run-field">
          <MicroLabel>Recording file</MicroLabel>
          <Input
            id={fileId}
            type="file"
            accept="application/json,.json"
            disabled={reading !== undefined}
            aria-busy={reading !== undefined || undefined}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const read = await pending.run(
                {
                  label: `Reading ${file.name}`,
                  scope: READ_RUN_SCOPE,
                  error: "Couldn't read that file",
                },
                () => readText(file),
              );
              if (read.ok) load(read.value, file.name);
            }}
          />
          {reading ? (
            <span className="je-run-reading">
              <Spinner size={12} label={null} />
              <Text as="span" size="xs" variant="muted">
                {reading.label}
              </Text>
            </span>
          ) : null}
        </label>
        <label htmlFor={pasteId} className="je-run-field">
          <MicroLabel>Or paste it</MicroLabel>
          <Textarea
            id={pasteId}
            rows={5}
            value={pasted}
            placeholder='{"v": 1, "scene": …}'
            onChange={(e) => setPasted(e.target.value)}
            className="je-run-paste"
          />
        </label>
        <div className="je-run-actions-end">
          <Button size="sm" disabled={!pasted.trim()} onClick={() => load(pasted, "pasted")}>
            Load
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RunSummary({
  run,
  stale,
  timeKind,
  held,
  onPlayFrom,
  onReplay,
}: {
  run: LoadedRun;
  stale: boolean;
  timeKind: TimeKind;
  held: HeldVersion | undefined;
  onPlayFrom: (opts: PlayOptions) => void;
  onReplay: (run: LoadedRun) => void;
}) {
  const { recording } = run;
  const times = runTimes(recording, timeKind);
  const { outcome } = recording;
  const markers = recording.markers.slice(0, MAX_EVENTS);
  const live = liveReplay(recording, held, times.at);
  return (
    <div className="je-run-summary">
      <div className="je-run-head">
        <span className="je-sp-truncate je-run-name">{run.name}</span>
        <Badge size="label" variant={OUTCOME_VARIANT[outcome.result] ?? "secondary"}>
          {outcome.result}
        </Badge>
      </div>
      <Text as="p" size="xs" variant="muted">
        {recording.scene} · {times.length}
        {outcome.cause ? ` · ${outcome.cause}` : ""}
        {outcome.entityId ? ` at ${outcome.entityId}` : ""}
      </Text>
      {stale ? (
        <p role="status" className="je-run-stale">
          The scene changed since this run, so the trail may not match it and a replay may end
          differently.
        </p>
      ) : null}
      {live?.caveat ? (
        <p role="status" className="je-run-stale">
          {live.text}
        </p>
      ) : live ? (
        <Text as="p" size="xs" variant="muted">
          {live.text}
        </Text>
      ) : null}
      <div className="je-run-actions">
        <Button
          size="xs"
          disabled={live?.blocked}
          focusableWhenDisabled={live?.blocked}
          onClick={() => onReplay(run)}
          tooltip={
            live?.blocked
              ? "This editor doesn't have the live version the run starts on"
              : live?.stopsAt
                ? `Play this run's recorded input again until ${live.stopsAt}, then hold there`
                : "Play this run's recorded input again, then hold on its last frame"
          }
        >
          Replay
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => onPlayFrom(runStart(run))}
          tooltip="Play live from where this run started"
        >
          Play from its start
        </Button>
      </div>
      <h3>
        <MicroLabel>
          Markers · {recording.markers.length} · trail {recording.trail?.pts.length ?? 0} points
        </MicroLabel>
      </h3>
      {markers.length > 0 ? (
        <ol aria-label="Run markers" className="je-run-markers je-scene-panel-scroll">
          {markers.map((e, i) => (
            <li key={`${e.tick}:${i}`} className="je-run-marker">
              <span className="je-run-marker-at">{times.at(e.tick)}</span>
              <span className="je-sp-truncate">
                {e.type}
                {e.entityId ? ` · ${e.entityId}` : ""}
              </span>
            </li>
          ))}
          {recording.markers.length > markers.length ? (
            <li className="je-run-more">and {recording.markers.length - markers.length} more</li>
          ) : null}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * A run shown over the scene through `run` (the canvas layer draws
 * `runOverlay` of it): the editor's last Play, or a recording loaded from a
 * file or pasted. It notes when the scene, or a prefab it places, changed
 * since, and offers **Replay** and **Play from its start**. Its summary
 * stays in view while the markers scroll, so a long run never grows the
 * panel. With `liveVersion` it says whether Replay plays all of a run that
 * played live versions or where it stops. Outside an editor it reads files
 * through a `Pending` of its own.
 */
export function LoadRunPanel({
  session,
  run,
  onPlayFrom,
  onReplay,
  liveVersion,
  notify,
}: {
  session: EditorSession;
  run: Store<LoadedRun | null>;
  onPlayFrom: (opts: PlayOptions) => void;
  onReplay: (run: LoadedRun) => void;
  /** The live versions this editor holds; without it the panel can't tell whether a replay plays through. */
  liveVersion?: HeldVersion;
  notify: EditorNotify;
}) {
  const loaded = useStoreValue(run);
  const def = useEditorDoc(session);
  const prefabs = useEditorPrefabs(session);
  const stale = useMemo(
    () => (loaded ? runIsStale(loaded, def, prefabs, session.getHash()) : false),
    [loaded, def, prefabs, session],
  );
  const [open, setOpen] = useState(false);
  const pending = useOwnOrSharedPending(notify);

  return (
    <PendingProvider pending={pending}>
      <section aria-label="Run" className="je-scene-panel">
        <div className="je-panel-toolbar">
          <Button
            size="xs"
            variant="outline"
            busyScope={READ_RUN_SCOPE}
            onClick={() => setOpen(true)}
            tooltip="A run recording file, or a pasted playtest report"
          >
            Load run
          </Button>
          {loaded ? (
            <Button size="xs" variant="ghost" onClick={() => run.setState(() => null)}>
              Clear
            </Button>
          ) : null}
        </div>
        {loaded ? (
          <RunSummary
            run={loaded}
            stale={stale}
            timeKind={resolveTime({ game: session.registry.time }).kind}
            held={liveVersion}
            onPlayFrom={onPlayFrom}
            onReplay={onReplay}
          />
        ) : (
          <Text as="p" size="xs" variant="muted">
            Play the scene, or load a recording, to see its trail over the scene.
          </Text>
        )}
        <LoadRunDialog
          open={open}
          notify={notify}
          registry={session.registry}
          onOpenChange={setOpen}
          onLoaded={(next) => {
            run.setState(() => next);
            setOpen(false);
          }}
        />
      </section>
    </PendingProvider>
  );
}
