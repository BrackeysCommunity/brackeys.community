import type { Store } from "@tanstack/store";
import { useId, useState } from "react";

import type { EditorSession } from "../../editor/index";
import type { PlayOptions } from "../../index";
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
  Text,
  Textarea,
  type BadgeVariant,
} from "../kit/index";
import { parseRun, runIsStale, runStart, type LoadedRun } from "../session/loaded-run";
import { useEditorStore } from "../session/use-editor-store";
import { useStoreValue } from "../session/use-store-value";

/** Markers listed before the rest are summarised as a count. */
const MAX_EVENTS = 50;

function readText(file: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => fail(reader.error ?? new Error("couldn't read the file"));
    reader.readAsText(file);
  });
}

const seconds = (tick: number) => `${(tick / 60).toFixed(1)}s`;

const OUTCOME_VARIANT: Record<string, BadgeVariant> = {
  won: "success",
  lost: "destructive",
};

function LoadRunDialog({
  open,
  onOpenChange,
  onLoaded,
  notify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoaded: (run: LoadedRun) => void;
  notify: EditorNotify;
}) {
  const [pasted, setPasted] = useState("");
  const fileId = useId();
  const pasteId = useId();

  const load = (text: string, name: string) => {
    const parsed = parseRun(text, name);
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
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                load(await readText(file), file.name);
              } catch (err) {
                notify.error("Couldn't read that file", { description: (err as Error).message });
              }
            }}
          />
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
  onPlayFrom,
  onReplay,
  onClear,
  onReplace,
}: {
  run: LoadedRun;
  stale: boolean;
  onPlayFrom: (opts: PlayOptions) => void;
  onReplay: (run: LoadedRun) => void;
  onClear: () => void;
  onReplace: () => void;
}) {
  const { recording } = run;
  const { outcome } = recording;
  const markers = recording.markers.slice(0, MAX_EVENTS);
  return (
    <div className="je-run-summary">
      <div className="je-run-head">
        <span className="je-sp-truncate je-run-name">{run.name}</span>
        <Badge size="label" variant={OUTCOME_VARIANT[outcome.result] ?? "secondary"}>
          {outcome.result}
        </Badge>
      </div>
      <Text as="p" size="xs" variant="muted">
        {recording.scene} · {recording.ticks} ticks ({seconds(recording.ticks)})
        {outcome.cause ? ` · ${outcome.cause}` : ""}
        {outcome.entityId ? ` at ${outcome.entityId}` : ""}
      </Text>
      {stale ? (
        <p role="status" className="je-run-stale">
          The scene changed since this run, so the trail may not match it and a replay may end
          differently.
        </p>
      ) : null}
      <div className="je-run-actions">
        <Button
          size="xs"
          onClick={() => onReplay(run)}
          tooltip="Play this run's recorded input again, then hold on its last frame"
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
        <Button size="xs" variant="ghost" onClick={onReplace}>
          Load another
        </Button>
        <Button size="xs" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
      <h3>
        <MicroLabel>
          Markers · {recording.markers.length} · trail {recording.trail?.pts.length ?? 0} points
        </MicroLabel>
      </h3>
      {markers.length > 0 ? (
        <ol aria-label="Run markers" className="je-run-markers">
          {markers.map((e, i) => (
            <li key={`${e.tick}:${i}`} className="je-run-marker">
              <span className="je-run-marker-at">{seconds(e.tick)}</span>
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
 * file or pasted. It notes when the scene changed since, and offers
 * **Replay** and **Play from its start**.
 */
export function LoadRunPanel({
  session,
  run,
  onPlayFrom,
  onReplay,
  notify,
}: {
  session: EditorSession;
  run: Store<LoadedRun | null>;
  onPlayFrom: (opts: PlayOptions) => void;
  onReplay: (run: LoadedRun) => void;
  notify: EditorNotify;
}) {
  const loaded = useStoreValue(run);
  const hash = useEditorStore(session, (s) => s.hash);
  const [open, setOpen] = useState(false);

  return (
    <section aria-label="Run" className="je-scene-panel">
      <h2 className="je-scene-panel-title">Run</h2>
      {loaded ? (
        <RunSummary
          run={loaded}
          stale={runIsStale(loaded, hash)}
          onPlayFrom={onPlayFrom}
          onReplay={onReplay}
          onClear={() => run.setState(() => null)}
          onReplace={() => setOpen(true)}
        />
      ) : (
        <div className="je-run-empty">
          <Text as="p" size="xs" variant="muted">
            Play the scene, or load a recording, to see its trail over the scene.
          </Text>
          <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
            Load run
          </Button>
        </div>
      )}
      <LoadRunDialog
        open={open}
        notify={notify}
        onOpenChange={setOpen}
        onLoaded={(next) => {
          run.setState(() => next);
          setOpen(false);
        }}
      />
    </section>
  );
}
