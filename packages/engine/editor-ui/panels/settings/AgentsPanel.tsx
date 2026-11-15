import { useKit, Switch } from "../../kit/index";
import {
  AGENTS_DRIVE_PLAY_HINT,
  AGENTS_DRIVE_PLAY_LABEL,
  useAgentsDrivePlay,
} from "../../session/live-responder";
import { FieldRow } from "../inspector/field-widgets";
import { SettingsNote } from "./SettingsRows";

/** Said above the viewer's own switches, so they don't read as project settings. */
export const AGENTS_PANEL_NOTE =
  "Kept for you in this browser. Nothing here is saved to the project or seen by others.";

/**
 * The viewer's switches for agents: whether agents with this scene open may
 * take frames of the canvas and drive Play here. On by default against the
 * dev server, off on a hosted one.
 */
export function AgentsPanel({ hosted = false }: { hosted?: boolean }) {
  const { storage } = useKit();
  const [on, setOn] = useAgentsDrivePlay(storage, hosted);
  return (
    <>
      <SettingsNote>{AGENTS_PANEL_NOTE}</SettingsNote>
      <FieldRow label={AGENTS_DRIVE_PLAY_LABEL} hint={`${AGENTS_DRIVE_PLAY_HINT}.`}>
        <div className="je-insp-row je-insp-line">
          <Switch aria-label={AGENTS_DRIVE_PLAY_LABEL} checked={on} onCheckedChange={setOn} />
          <span className="je-insp-muted">{on ? "on" : "off"}</span>
        </div>
      </FieldRow>
    </>
  );
}
