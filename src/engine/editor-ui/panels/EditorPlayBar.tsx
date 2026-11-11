import { NextIcon, PauseIcon, PlayIcon, StopIcon } from "@hugeicons/core-free-icons";

import type { GameStoreState } from "../../types";
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

/** The scene a flow request asked for when that request ended the editor's Play, else null. */
export function flowRequestedScene(state: Pick<GameStoreState, "session">): string | null {
  const outcome = state.session?.outcome;
  return outcome?.result === "flow" ? (outcome.to ?? null) : null;
}

/**
 * While playing: the chip, pause, step, time scale, stop, a restart when the
 * scene moved on, and the scene a flow request asked for when one ended Play,
 * which opens it. Once the session has an outcome, Resume and Step are off.
 */
export function EditorPlayBar({ game, host, keymap, onStop, onRestart, project }: EditorControls) {
  const { paused, timeScale } = useStoreValue(game.getStore(), (s) => s.sim);
  const sceneChanged = useStoreValue(host, (s) => s.sceneChanged);
  const requested = useStoreValue(game.getStore(), flowRequestedScene);
  const ended = useStoreValue(game.getStore(), (s) => (s.session?.outcome ?? null) !== null);
  const openScene = project?.openScene;
  const openRequested =
    requested !== null && openScene && requested !== project?.scene
      ? () => {
          onStop();
          openScene(requested);
        }
      : null;

  return (
    <div className="je-play-bar">
      <Badge size="label" variant="secondary">
        {ended ? "Ended" : "Playing"} · Esc to stop
      </Badge>
      <Island role="toolbar" aria-label="Play controls">
        <IconButton
          icon={paused ? PlayIcon : PauseIcon}
          label={paused ? "Resume" : "Pause"}
          disabled={ended && paused}
          onClick={() => (paused ? game.resume() : game.pause())}
          tooltip={<KeyHint text={paused ? "Resume" : "Pause"} chord={keymap.chordOf("pause")} />}
        />
        <IconButton
          icon={NextIcon}
          label="Step"
          disabled={!paused || ended}
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
      {requested !== null ? (
        <Island role="status" className="je-scene-changed" data-flow-requested="">
          Ended: requested {requested}
          {openRequested ? (
            <Button size="xs" variant="secondary" onClick={openRequested}>
              Open {requested}
            </Button>
          ) : null}
        </Island>
      ) : null}
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
