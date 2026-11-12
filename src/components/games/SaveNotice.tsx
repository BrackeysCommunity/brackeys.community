import { SIGNED_IN_SAVES_DESCRIBE, SIGNED_OUT_SAVES_DESCRIBE } from "@/lib/engine/local-saves";
import { SITE } from "@/lib/legal-meta";
import { cn } from "@/lib/utils";

export type SaveMode = "site" | "own" | "none";

export type SaveNoticeProps = {
  mode: SaveMode;
  /** The project's declared connect origins; a game with its own save store names them too. */
  connectOrigins: readonly string[];
  /** Whether the viewer is signed in, which decides where a site game's saves go. */
  signedIn: boolean;
  className?: string;
};

/**
 * The sentence after "Saves." for a save mode and the viewer's state, the
 * same on the game page and the play page. A site game says what the save
 * menu says for that state.
 */
export function savesSentence(
  mode: SaveMode,
  origins: readonly string[],
  signedIn: boolean,
): string {
  switch (mode) {
    case "site":
      return signedIn ? SIGNED_IN_SAVES_DESCRIBE : SIGNED_OUT_SAVES_DESCRIBE;
    case "own": {
      const where = origins.length > 0 ? ` (${origins.join(", ")})` : "";
      return `This game keeps its saves on its own servers${where}. ${SITE.name} doesn't store or control them.`;
    }
    case "none":
      return "This game doesn't save progress.";
  }
}

export const PREFS_SENTENCE =
  "Key bindings, volume, language and caption settings stay in this browser and are never uploaded.";

export function connectsToSentence(origins: readonly string[]): string | null {
  if (origins.length === 0) return null;
  return `This game connects to: ${origins.join(", ")}. Those sites' own terms apply to what you send them.`;
}

/** Where a game's saves and settings live, by its save mode. */
export function SaveNotice({ mode, connectOrigins, signedIn, className }: SaveNoticeProps) {
  const connects = connectsToSentence(connectOrigins);
  // The spaces between paragraphs keep the sentences apart in the notice's text.
  return (
    <div className={cn("space-y-2 text-sm text-muted-foreground", className)} data-save-mode={mode}>
      <p>
        <strong className="font-semibold text-foreground">Saves.</strong>{" "}
        {savesSentence(mode, connectOrigins, signedIn)}
      </p>{" "}
      <p>{PREFS_SENTENCE}</p>
      {connects ? (
        <>
          {" "}
          <p>{connects}</p>
        </>
      ) : null}
    </div>
  );
}
