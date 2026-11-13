import { NextIcon, PauseIcon, PlayIcon, StopIcon } from "@hugeicons/core-free-icons";
import type { Store } from "@tanstack/store";
import { useEffect, useId, useState } from "react";

import type { GameStoreState } from "../../types";
import { Island } from "../frame/EditorFrame";
import type { EditorControls } from "../frame/keys";
import { STORAGE_PREFIX } from "../host";
import { Badge, Button, Hint, IconButton, KeyHint, Switch, Text, useKit } from "../kit/index";
import type { EditorHostState } from "../session/live-scene-editor";
import { readStored, storedFlag, writeStored } from "../session/stored";
import { useStoreValue } from "../session/use-store-value";
import { LiveInPlayStatus, livePlayPending } from "./LiveInPlayStatus";

/** Where the viewer's Live in Play choice is kept. */
export const LIVE_PLAY_KEY = `${STORAGE_PREFIX}live-in-play`;

export const LIVE_PLAY_TOOLTIP =
  "Apply edits to the running game, the way players get a live update";

/** Where those edits come from, since the editing panels are hidden while you play. */
export const LIVE_PLAY_SOURCES =
  "While you play, they come from other editors, agents and the files on disk.";

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
 * While playing: the chip, pause, step, time scale, stop, and above them the
 * Live in Play status, a restart when the scene moved on, and the scene a flow
 * request asked for when one ended Play, which opens it. Once the session has
 * an outcome, Resume and Step are off.
 */
export function EditorPlayBar({
  game,
  host,
  keymap,
  onStop,
  onRestart,
  onLivePlay,
  project,
}: EditorControls) {
  const { paused, timeScale } = useStoreValue(game.getStore(), (s) => s.sim);
  // While Live in Play applies edits, the game already has them; Restart is offered when one didn't land.
  const sceneChanged = useStoreValue(
    host,
    (s) => s.sceneChanged && !(s.livePlay?.on && !livePlayPending(s.livePlay.status)),
  );
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
      <Island role="toolbar" aria-label="Play controls" className="je-play-controls">
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
        {onLivePlay ? <LiveInPlayToggle host={host} onChange={onLivePlay} /> : null}
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
      {/* Out of the row's flow, so a status coming or going never moves the controls under the pointer. */}
      <div className="je-play-notes">
        <LiveInPlayStatus host={host} />
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
    </div>
  );
}

/**
 * The Live in Play switch: off by default, the viewer's last choice taken
 * again at each Play. Its label toggles it too. Where the scene or game can't
 * take live updates it is disabled but focusable, so its hint, which gives the
 * reason, opens from the keyboard as well as on hover. Once flipped, its hint
 * stays shut until the pointer or focus leaves, so the status it would cover
 * above the bar can be read.
 */
function LiveInPlayToggle({
  host,
  onChange,
}: {
  host: Store<EditorHostState>;
  onChange: (on: boolean) => void;
}) {
  const { storage } = useKit();
  const id = useId();
  const reasonId = useId();
  const on = useStoreValue(host, (s) => s.livePlay?.on ?? false);
  const unavailable = useStoreValue(host, (s) => s.livePlay?.unavailable ?? null);
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    if (readStored(storage, LIVE_PLAY_KEY, false, storedFlag)) onChange(true);
  }, [storage, onChange]);
  const label = (
    <Text size="sm" variant={unavailable !== null ? "muted" : "primary"} aria-hidden>
      Live in Play
    </Text>
  );
  if (unavailable !== null) {
    return (
      <Hint content={unavailable}>
        <span className="je-live-toggle" data-unavailable="">
          <Switch
            aria-label="Live in Play"
            aria-describedby={reasonId}
            checked={on}
            disabled
            focusableWhenDisabled
          />
          {label}
          <span id={reasonId} className="je-sr-only">
            {unavailable}
          </span>
        </span>
      </Hint>
    );
  }
  return (
    <Hint content={`${LIVE_PLAY_TOOLTIP}. ${LIVE_PLAY_SOURCES}`} closed={flipped}>
      <label
        className="je-live-toggle"
        htmlFor={id}
        onPointerLeave={() => setFlipped(false)}
        onBlur={() => setFlipped(false)}
      >
        <Switch
          id={id}
          aria-label="Live in Play"
          checked={on}
          onCheckedChange={(next) => {
            setFlipped(true);
            writeStored(storage, LIVE_PLAY_KEY, next);
            onChange(next);
          }}
        />
        {label}
      </label>
    </Hint>
  );
}
