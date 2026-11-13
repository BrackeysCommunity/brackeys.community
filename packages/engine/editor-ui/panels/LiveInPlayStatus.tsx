import type { ReactNode } from "react";

import { Island } from "../frame/EditorFrame";
import { Hint, Spinner, Text, type TextTone } from "../kit/index";
import type { EditorHostState, LivePlayStatus } from "../session/live-scene-editor";
import { useStoreValue, type ReadableStore } from "../session/use-store-value";

const LIVE_TONES: Readonly<Record<LivePlayStatus["tone"], TextTone>> = {
  busy: "muted",
  applied: "success",
  waiting: "warning",
  failed: "danger",
};

/** Live in Play's status line while it is on and no update is under way. */
export const LIVE_PLAY_IDLE = "Live in Play: listening for edits";

/** Whether Live in Play's last update didn't reach the running game: it failed or is waiting. */
export function livePlayPending(status: LivePlayStatus | null | undefined): boolean {
  return status?.tone === "failed" || status?.tone === "waiting";
}

/**
 * Live in Play's status line while playing: listening for edits, the update
 * staging, then how it was applied, when it will apply under the game's
 * timings, or why it wasn't. Nothing while Live in Play is off.
 */
export function LiveInPlayStatus({ host }: { host: ReadableStore<EditorHostState> }) {
  const on = useStoreValue(host, (s) => s.livePlay?.on ?? false);
  const status = useStoreValue(host, (s) => (s.livePlay?.on ? s.livePlay.status : null));
  if (!on) return null;
  if (!status) {
    return (
      <Island role="status" className="je-scene-changed je-live-status" data-live="idle">
        <Text size="sm" variant="muted" ellipsis>
          {LIVE_PLAY_IDLE}
        </Text>
      </Island>
    );
  }
  // A failure or a wait can outrun the island: its hint holds the whole reason.
  const detail = livePlayPending(status) ? statusDetail(status) : null;
  const line = (
    <Text size="sm" variant={LIVE_TONES[status.tone]} ellipsis {...(detail ? { tabIndex: 0 } : {})}>
      {status.text}
    </Text>
  );
  return (
    <Island role="status" className="je-scene-changed je-live-status" data-live={status.tone}>
      {status.tone === "busy" ? <Spinner size={12} label={null} /> : null}
      {detail ? (
        <Hint
          content={detail}
          tone={status.tone === "failed" ? "error" : "default"}
          maxWidth={360}
          hoverable
        >
          {line}
        </Hint>
      ) : (
        line
      )}
    </Island>
  );
}

/** The status's text, and its issue's message when the text doesn't already say it. */
function statusDetail(status: LivePlayStatus): ReactNode {
  const message = status.issue?.message;
  if (!message || status.text.includes(message)) return status.text;
  return (
    <>
      {status.text}
      <br />
      {message}
    </>
  );
}
