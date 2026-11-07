import { NextIcon, PauseIcon, PlayIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { shallow, useStore } from "@tanstack/react-store";

import { Island } from "@/components/canvas/shell/CanvasShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { EditorControls } from "./EditorShell";
import { KeyHint } from "./key-hint";

/** The time scales `[` and `]` walk through. */
export const TIME_SCALES = [0.25, 0.5, 1] as const;

/** The next scale down (-1) or up (+1) from `current`; it stays put at either end. */
export function nextTimeScale(current: number, dir: 1 | -1): number {
  const next =
    dir > 0
      ? TIME_SCALES.find((s) => s > current)
      : [...TIME_SCALES].reverse().find((s) => s < current);
  return next ?? current;
}

const scaleLabel = (s: number) => `${s}×`;

/** While playing: the chip, pause, step, time scale, stop, and a restart when the scene moved on. */
export function EditorPlayBar({ game, host, keymap, onStop, onRestart }: EditorControls) {
  const { paused, timeScale } = useStore(game.getStore(), (s) => s.sim, { equal: shallow });
  const sceneChanged = useStore(host, (s) => s.sceneChanged);

  return (
    <div className="flex items-center gap-2">
      <Badge size="label" variant="secondary">
        Playing · Esc to stop
      </Badge>
      <Island role="toolbar" aria-label="Play controls">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={paused ? "Resume" : "Pause"}
          onClick={() => (paused ? game.resume() : game.pause())}
          tooltip={<KeyHint text={paused ? "Resume" : "Pause"} chord={keymap.chordOf("pause")} />}
        >
          <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Step"
          disabled={!paused}
          onClick={() => game.step()}
          tooltip={<KeyHint text="Step one tick" chord={keymap.chordOf("step")} />}
        >
          <HugeiconsIcon icon={NextIcon} />
        </Button>
        <div role="group" aria-label="Time scale" className="flex items-center">
          {TIME_SCALES.map((s) => (
            <Button
              key={s}
              variant={s === timeScale ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={s === timeScale}
              onClick={() => game.setTimeScale(s)}
              tooltip={
                <KeyHint
                  text={`Run at ${scaleLabel(s)}`}
                  chord={
                    s === timeScale
                      ? undefined
                      : keymap.chordOf(s < timeScale ? "slower" : "faster")
                  }
                />
              }
            >
              {scaleLabel(s)}
            </Button>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onStop}
          tooltip={<KeyHint text="Stop" chord={keymap.chordOf("stop")} />}
        >
          <HugeiconsIcon icon={StopIcon} data-icon="inline-start" />
          Stop
        </Button>
      </Island>
      {sceneChanged ? (
        <Island role="status" className="gap-2 pl-3 text-xs">
          Scene changed
          <Button size="xs" variant="secondary" onClick={onRestart}>
            Restart
          </Button>
        </Island>
      ) : null}
    </div>
  );
}
