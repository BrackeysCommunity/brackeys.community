import { NextIcon, PauseIcon, PlayIcon, StopIcon } from "@hugeicons/core-free-icons";

import { Island } from "../frame/EditorFrame";
import type { EditorControls } from "../frame/keys";
import { Badge, Button, IconButton, KeyHint } from "../kit/index";
import { useStoreValue } from "../session/use-store-value";

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
  const { paused, timeScale } = useStoreValue(game.getStore(), (s) => s.sim);
  const sceneChanged = useStoreValue(host, (s) => s.sceneChanged);

  return (
    <div className="je-play-bar">
      <Badge size="label" variant="secondary">
        Playing · Esc to stop
      </Badge>
      <Island role="toolbar" aria-label="Play controls">
        <IconButton
          icon={paused ? PlayIcon : PauseIcon}
          label={paused ? "Resume" : "Pause"}
          onClick={() => (paused ? game.resume() : game.pause())}
          tooltip={<KeyHint text={paused ? "Resume" : "Pause"} chord={keymap.chordOf("pause")} />}
        />
        <IconButton
          icon={NextIcon}
          label="Step"
          disabled={!paused}
          onClick={() => game.step()}
          tooltip={<KeyHint text="Step one tick" chord={keymap.chordOf("step")} />}
        />
        <div role="group" aria-label="Time scale" className="je-play-scales">
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
          icon={StopIcon}
          onClick={onStop}
          tooltip={<KeyHint text="Stop" chord={keymap.chordOf("stop")} />}
        >
          Stop
        </Button>
      </Island>
      {sceneChanged ? (
        <Island role="status" className="je-scene-changed">
          Scene changed
          <Button size="xs" variant="secondary" onClick={onRestart}>
            Restart
          </Button>
        </Island>
      ) : null}
    </div>
  );
}
