import { NextIcon, PauseIcon, PlayIcon, StopIcon } from "@hugeicons/core-free-icons";
import type { Store } from "@tanstack/store";
import { useEffect, useId, useState } from "react";

import type { GameInstance, GameStoreState } from "../../types";
import { applySoundInPlay, useSoundInPlay } from "../audio/editor-audio";
import { Island } from "../frame/EditorFrame";
import type { EditorControls } from "../frame/keys";
import { STORAGE_PREFIX } from "../host";
import {
  Badge,
  Button,
  Hint,
  IconButton,
  KeyHint,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  useKit,
} from "../kit/index";
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

export const SOUND_IN_PLAY_TOOLTIP =
  "Hear the game while you play here. Off by default, so a shared session stays quiet";

/** Said when Sound in Play is turned on in a Play that started without it. */
export const SOUND_NEXT_PLAY = "Sound starts at the next Play";

export const LOCALE_TOOLTIP = "Preview the game's text in another language";

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
  const [soundLater, setSoundLater] = useState(false);
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
        <SoundInPlayToggle game={game} onLater={setSoundLater} />
        <LocalePicker game={game} />
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
        {soundLater ? (
          <Island role="status" className="je-scene-changed" data-sound-later="">
            {SOUND_NEXT_PLAY}
          </Island>
        ) : null}
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
 * A labelled switch in the play bar; its label toggles it too. Once flipped,
 * its hint stays shut until the pointer or focus leaves, so the status it
 * would cover above the bar can be read. With an `unavailable` reason it is
 * disabled but focusable, so the hint giving the reason opens from the
 * keyboard as well as on hover.
 */
function PlayBarSwitch({
  label,
  tooltip,
  checked,
  onChange,
  unavailable = null,
}: {
  label: string;
  tooltip: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  unavailable?: string | null;
}) {
  const id = useId();
  const reasonId = useId();
  const [flipped, setFlipped] = useState(false);
  const text = (
    <Text size="sm" variant={unavailable !== null ? "muted" : "primary"} aria-hidden>
      {label}
    </Text>
  );
  if (unavailable !== null) {
    return (
      <Hint content={unavailable}>
        <span className="je-live-toggle" data-unavailable="">
          <Switch
            aria-label={label}
            aria-describedby={reasonId}
            checked={checked}
            disabled
            focusableWhenDisabled
          />
          {text}
          <span id={reasonId} className="je-sr-only">
            {unavailable}
          </span>
        </span>
      </Hint>
    );
  }
  return (
    <Hint content={tooltip} closed={flipped}>
      <label
        className="je-live-toggle"
        htmlFor={id}
        onPointerLeave={() => setFlipped(false)}
        onBlur={() => setFlipped(false)}
      >
        <Switch
          id={id}
          aria-label={label}
          checked={checked}
          onCheckedChange={(next) => {
            setFlipped(true);
            onChange(next);
          }}
        />
        {text}
      </label>
    </Hint>
  );
}

/** The Live in Play switch: off by default, the viewer's last choice taken again at each Play. */
function LiveInPlayToggle({
  host,
  onChange,
}: {
  host: Store<EditorHostState>;
  onChange: (on: boolean) => void;
}) {
  const { storage } = useKit();
  const on = useStoreValue(host, (s) => s.livePlay?.on ?? false);
  const unavailable = useStoreValue(host, (s) => s.livePlay?.unavailable ?? null);
  useEffect(() => {
    if (readStored(storage, LIVE_PLAY_KEY, false, storedFlag)) onChange(true);
  }, [storage, onChange]);
  return (
    <PlayBarSwitch
      label="Live in Play"
      tooltip={`${LIVE_PLAY_TOOLTIP}. ${LIVE_PLAY_SOURCES}`}
      checked={on}
      unavailable={unavailable}
      onChange={(next) => {
        writeStored(storage, LIVE_PLAY_KEY, next);
        onChange(next);
      }}
    />
  );
}

/**
 * The Sound in Play switch: off by default, kept per viewer, and following a
 * change made in another tab. The editor's game reads it when Play starts;
 * changed mid-Play, off silences the game at once and on brings it back, or,
 * in a Play that started silent, says the sound starts at the next one.
 */
function SoundInPlayToggle({ game, onLater }: { game: object; onLater: (later: boolean) => void }) {
  const { storage } = useKit();
  const [on, setOn] = useSoundInPlay(storage);
  useEffect(() => {
    onLater(!applySoundInPlay(game, on));
  }, [game, on, onLater]);
  return (
    <PlayBarSwitch
      label="Sound in Play"
      tooltip={`${SOUND_IN_PLAY_TOOLTIP}.`}
      checked={on}
      onChange={setOn}
    />
  );
}

/** The chrome's game type leaves these out; a stand-in game may have none. */
type LocaleGame = Partial<Pick<GameInstance, "locale" | "on" | "off">>;

/** A locale's name in the editor's language ("French"), or its code when the browser has none. */
function localeName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Switches the game's locale while playing, so translated text and its font
 * can be checked; the choice is the viewer's, kept in the game's prefs. Shown
 * only when the project lists more than one locale.
 */
function LocalePicker({ game }: { game: object }) {
  const { cue } = useKit();
  const g = game as LocaleGame;
  const locale = g.locale ?? null;
  const [current, setCurrent] = useState(() => locale?.current() ?? null);
  useEffect(() => {
    if (!locale || !g.on || !g.off) return;
    const changed = ({ to }: { to: string }) => setCurrent(to);
    g.on("locale:change", changed);
    return () => g.off?.("locale:change", changed);
  }, [g, locale]);
  const available = locale?.available() ?? [];
  if (!locale || current === null || available.length < 2) return null;
  return (
    <Select
      value={current}
      onValueChange={(next) => {
        if (typeof next !== "string" || next === current) return;
        cue("toggle");
        locale.set(next);
        setCurrent(locale.current());
      }}
    >
      <Hint content={LOCALE_TOOLTIP}>
        <SelectTrigger size="xs" aria-label="Locale">
          <SelectValue>{localeName(current)}</SelectValue>
        </SelectTrigger>
      </Hint>
      <SelectContent>
        {available.map((code) => (
          <SelectItem key={code} value={code}>
            {localeName(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
