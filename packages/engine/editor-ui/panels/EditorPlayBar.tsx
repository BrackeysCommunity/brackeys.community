import {
  LayoutThreeColumnIcon,
  LiveStreaming02Icon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import type { Store } from "@tanstack/store";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { ProjectSession } from "../../collab/index";
import { DIALOGUE_KIND, type AssetKindName } from "../../project/index";
import type { GameInstance, GameStoreState } from "../../types";
import { onLocale } from "../../ui/bind";
import { applySoundInPlay, useSoundInPlay } from "../audio/editor-audio";
import { Island } from "../frame/EditorFrame";
import type { EditorControls } from "../frame/keys";
import { PANELS_IN_PLAY_TOOLTIP, usePanelsInPlay } from "../frame/panels-in-play";
import { STORAGE_PREFIX } from "../host";
import {
  Badge,
  Button,
  Hint,
  Icon,
  IconButton,
  type IconSvgElement,
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
import { useProjectView } from "./EditorProject";
import { assetOptions } from "./inspector/asset-picker";
import { LiveInPlayStatus, livePlayPending } from "./LiveInPlayStatus";
import { PlayCaptions, previewDialogues, type DialoguePreview } from "./play-overlay/PlayCaptions";

/** Where the viewer's Live in Play choice is kept. */
export const LIVE_PLAY_KEY = `${STORAGE_PREFIX}live-in-play`;

export const LIVE_PLAY_TOOLTIP =
  "Apply edits to the running game, the way players get a live update";

/** Where those edits come from, since the editing panels are hidden while you play. */
export const LIVE_PLAY_SOURCES =
  "While you play, they come from other editors, agents and the files on disk.";

export const SOUND_IN_PLAY_TOOLTIP =
  "Hear the game while you play here. Off by default, so a shared session stays quiet";

/** Said when Sound in Play is turned on and this Play could start no sound. */
export const SOUND_NEXT_PLAY = "No sound in this Play; trying again at the next one";

export const LOCALE_TOOLTIP = "Preview the game's text in another language";

export const DIALOGUE_PREVIEW_TOOLTIP =
  "Run one of the project's dialogues over the game, to read its lines and choices. Its effects stay in the preview";

/** The dialogue picker's hint, naming the running preview in full since the picker may cut it short. */
export const dialoguePickerHint = (running: string | null): string =>
  running === null
    ? `${DIALOGUE_PREVIEW_TOOLTIP}.`
    : `Previewing ${running}. Pick it again to start over.`;

const DIALOGUE_KINDS: readonly AssetKindName[] = [DIALOGUE_KIND];

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
 * an outcome, Resume and Step are off. A project without game code also gets
 * its sounds' captions and a dialogue box over the canvas, and a picker that
 * previews its dialogues there.
 */
export function EditorPlayBar({
  game,
  host,
  keymap,
  onStop,
  onRestart,
  onLivePlay,
  project,
  canvas,
}: EditorControls) {
  const { storage } = useKit();
  const [sound, setSound] = useSoundInPlay(storage);
  const panels = usePanelsInPlay();
  const { paused, timeScale } = useStoreValue(game.getStore(), (s) => s.sim);
  // While Live in Play applies edits, the game already has them; Restart is offered when one didn't land.
  const sceneChanged = useStoreValue(
    host,
    (s) => s.sceneChanged && !(s.livePlay?.on && !livePlayPending(s.livePlay.status)),
  );
  const requested = useStoreValue(game.getStore(), flowRequestedScene);
  const ended = useStoreValue(game.getStore(), (s) => (s.session?.outcome ?? null) !== null);
  const [soundLater, setSoundLater] = useState(false);
  const [dialogue, setDialogue] = useState<DialoguePreview | null>(null);
  const endDialogue = useCallback(() => setDialogue(null), []);
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
        <SoundInPlayToggle game={game} on={sound} onChange={setSound} onLater={setSoundLater} />
        {panels ? (
          <PlayBarSwitch
            label="Panels"
            icon={LayoutThreeColumnIcon}
            tooltip={`${PANELS_IN_PLAY_TOOLTIP}.`}
            checked={panels[0]}
            onChange={panels[1]}
          />
        ) : null}
        <div className="je-play-pickers">
          <LocalePicker game={game} canvas={canvas} />
          <DialoguePicker
            game={game}
            canvas={canvas}
            session={project?.session ?? null}
            running={dialogue?.id ?? null}
            onPick={(id) => setDialogue((was) => ({ id, run: (was?.run ?? 0) + 1 }))}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={StopIcon}
          aria-label="Stop"
          onClick={onStop}
          tooltip={<KeyHint text="Stop" chord={keymap.chordOf("stop")} />}
        >
          <span className="je-play-stop-label">Stop</span>
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
      <PlayCaptions game={game} canvas={canvas} dialogue={dialogue} onDialogueEnd={endDialogue} />
    </div>
  );
}

/**
 * A labelled switch in the play bar; its label toggles it too, and a narrow
 * bar swaps the label's text for `icon`. Once flipped, its hint stays shut
 * until the pointer or focus leaves, so the status it would cover above the
 * bar can be read. With an `unavailable` reason it is disabled but
 * focusable, so the hint giving the reason opens from the keyboard as well
 * as on hover.
 */
function PlayBarSwitch({
  label,
  icon,
  tooltip,
  checked,
  onChange,
  unavailable = null,
}: {
  label: string;
  icon: IconSvgElement;
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
      <Icon icon={icon} className="je-play-switch-icon" />
      <span className="je-play-switch-label">{label}</span>
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
      icon={LiveStreaming02Icon}
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
 * changed mid-Play, off silences the game at once and on brings it back,
 * starting it in a Play that began silent.
 */
function SoundInPlayToggle({
  game,
  on,
  onChange,
  onLater,
}: {
  game: object;
  on: boolean;
  onChange: (on: boolean) => void;
  onLater: (later: boolean) => void;
}) {
  useEffect(() => {
    onLater(!applySoundInPlay(game, on));
  }, [game, on, onLater]);
  return (
    <PlayBarSwitch
      label="Sound in Play"
      icon={VolumeHighIcon}
      tooltip={`${SOUND_IN_PLAY_TOOLTIP}.`}
      checked={on}
      onChange={onChange}
    />
  );
}

/** The chrome's game type leaves these out; a stand-in game may have none. */
type LocaleGame = Partial<Pick<GameInstance, "locale" | "on" | "off">>;

/**
 * Puts the game back on the locale it had when Play started once Play stops.
 * The play bar's picker only previews a language, and edit mode has no picker
 * to switch it back, so neither edit mode nor the next Play keeps the preview.
 */
export function usePlayLocale(game: object, playing: boolean): void {
  useEffect(() => {
    const locale = (game as LocaleGame).locale;
    if (!playing || !locale) return;
    const atStart = locale.current();
    return () => {
      if (locale.current() !== atStart && locale.available().includes(atStart)) {
        locale.set(atStart);
      }
    };
  }, [game, playing]);
}

/**
 * What a pick in one of the bar's pickers hands focus to once its list
 * closes: the canvas, so the play keys reach the game rather than reopening
 * the picker. Dismissing the list without a pick leaves focus on its trigger.
 */
function useFocusCanvasOnPick(canvas: EditorControls["canvas"]) {
  const picked = useRef(false);
  return {
    picked: () => {
      picked.current = true;
    },
    finalFocus: () => {
      const to = picked.current ? (canvas?.() ?? null) : null;
      picked.current = false;
      return to ?? true;
    },
  };
}

/** `tag` with its language's own name, "fr · français"; the tag alone where none is known. */
export function localeOption(tag: string): string {
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
  } catch {
    name = undefined;
  }
  return name && name !== tag ? `${tag} · ${name}` : tag;
}

/**
 * Switches the game's locale while playing, so translated text and its font
 * can be checked; Stop puts back the locale Play started in (`usePlayLocale`).
 * The trigger shows the tag, as the game settings and string tables name it,
 * and the list adds each language's name. Shown only when the project lists
 * more than one locale.
 */
function LocalePicker({ game, canvas }: { game: object; canvas: EditorControls["canvas"] }) {
  const { cue } = useKit();
  const focus = useFocusCanvasOnPick(canvas);
  const g = game as LocaleGame;
  const locale = g.locale ?? null;
  const [current, setCurrent] = useState(() => locale?.current() ?? null);
  useEffect(() => {
    if (!locale || !g.on || !g.off) return;
    return onLocale(g as Pick<GameInstance, "on" | "off">, () => setCurrent(locale.current()));
  }, [g, locale]);
  const available = locale?.available() ?? [];
  if (!locale || current === null || available.length < 2) return null;
  return (
    <Select
      value={current}
      onValueChange={(next) => {
        if (typeof next !== "string" || next === current) return;
        focus.picked();
        cue("toggle");
        locale.set(next);
        setCurrent(locale.current());
      }}
    >
      <Hint content={`${LOCALE_TOOLTIP}.`}>
        <SelectTrigger size="sm" aria-label="Locale" className="je-play-select je-play-locale">
          <SelectValue>{current}</SelectValue>
        </SelectTrigger>
      </Hint>
      <SelectContent finalFocus={focus.finalFocus}>
        {available.map((code) => (
          <SelectItem key={code} value={code}>
            {localeOption(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Previews one of a gameless project's dialogues in the Play overlay; picking
 * the running one again starts it over. Each reads as the asset pickers name
 * it. A pick hands focus to the canvas, so the play keys move the dialogue on
 * rather than reopening the picker. Shown only when the project has a
 * dialogue and no game code, whose own UI would start and show them.
 */
function DialoguePicker({
  game,
  canvas,
  session,
  running,
  onPick,
}: {
  game: object;
  canvas: EditorControls["canvas"];
  session: ProjectSession | null;
  running: string | null;
  onPick: (id: string) => void;
}) {
  const { cue } = useKit();
  const focus = useFocusCanvasOnPick(canvas);
  const view = useProjectView(session);
  const ids = previewDialogues(game);
  if (ids.length === 0) return null;
  const options = view ? assetOptions(view, DIALOGUE_KINDS) : [];
  const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  return (
    <Select
      value={running}
      onValueChange={(next) => {
        if (typeof next !== "string") return;
        focus.picked();
        cue("toggle");
        onPick(next);
      }}
    >
      <Hint content={dialoguePickerHint(running === null ? null : label(running))}>
        <SelectTrigger size="sm" aria-label="Preview a dialogue" className="je-play-select">
          <SelectValue>{running === null ? "Dialogue" : label(running)}</SelectValue>
        </SelectTrigger>
      </Hint>
      <SelectContent finalFocus={focus.finalFocus}>
        {ids.map((id) => (
          <SelectItem key={id} value={id}>
            {label(id)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
