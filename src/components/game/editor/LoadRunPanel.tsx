import type { PlayOptions } from "@jams/engine";
import type { EditorSession } from "@jams/engine/editor";
import { useStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/store";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MicroLabel, Text } from "@/components/ui/typography";
import { toast } from "@/lib/toast";

import { parseRun, runIsStale, runStart, type LoadedRun } from "./loaded-run";
import { useEditorStore } from "./use-editor-store";

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

const OUTCOME_VARIANT: Record<string, "success" | "destructive" | "secondary"> = {
  won: "success",
  lost: "destructive",
};

function LoadRunDialog({
  open,
  onOpenChange,
  onLoaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoaded: (run: LoadedRun) => void;
}) {
  const [pasted, setPasted] = useState("");
  const fileId = useId();
  const pasteId = useId();

  const load = (text: string, name: string) => {
    const parsed = parseRun(text, name);
    if (!parsed.ok) {
      toast.error("Couldn't load that run", { description: parsed.error });
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
        <label htmlFor={fileId} className="flex flex-col gap-1">
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
                toast.error("Couldn't read that file", { description: (err as Error).message });
              }
            }}
          />
        </label>
        <label htmlFor={pasteId} className="flex flex-col gap-1">
          <MicroLabel>Or paste it</MicroLabel>
          <Textarea
            id={pasteId}
            rows={5}
            value={pasted}
            placeholder='{"v": 1, "scene": …}'
            onChange={(e) => setPasted(e.target.value)}
            className="max-h-48"
          />
        </label>
        <div className="flex justify-end">
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
    <div className="flex flex-col gap-2 px-2 pb-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{run.name}</span>
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
        <p role="status" className="rounded-md bg-warning/15 px-2 py-1 text-foreground">
          The scene changed since this run, so the trail may not match it and a replay may end
          differently.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
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
        <ol aria-label="Run markers" className="flex flex-col">
          {markers.map((e, i) => (
            <li key={`${e.tick}:${i}`} className="flex gap-2 tabular-nums">
              <span className="w-10 shrink-0 text-right text-muted-foreground">
                {seconds(e.tick)}
              </span>
              <span className="truncate">
                {e.type}
                {e.entityId ? ` · ${e.entityId}` : ""}
              </span>
            </li>
          ))}
          {recording.markers.length > markers.length ? (
            <li className="text-muted-foreground">
              and {recording.markers.length - markers.length} more
            </li>
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
}: {
  session: EditorSession;
  run: Store<LoadedRun | null>;
  onPlayFrom: (opts: PlayOptions) => void;
  onReplay: (run: LoadedRun) => void;
}) {
  const loaded = useStore(run, (s) => s);
  const hash = useEditorStore(session, (s) => s.hash);
  const [open, setOpen] = useState(false);

  return (
    <section aria-label="Run" className="flex min-h-0 w-full flex-col">
      <h2 className="px-2 pt-1 pb-1 text-sm font-medium">Run</h2>
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
        <div className="flex flex-col items-start gap-2 px-2 pb-2">
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
        onOpenChange={setOpen}
        onLoaded={(next) => {
          run.setState(() => next);
          setOpen(false);
        }}
      />
    </section>
  );
}
