import { SITE_SAVE_EXPIRY_DAYS, SITE_SAVE_LIMITS } from "@/lib/engine/limits";
import { formatBytes } from "@/lib/format-bytes";
import { SITE } from "@/lib/legal-meta";
import { cn } from "@/lib/utils";

export type SaveMode = "site" | "own" | "none";

export type SaveNoticeProps = {
  mode: SaveMode;
  /** The project's declared connect origins; a game with its own save store names them too. */
  connectOrigins: readonly string[];
  className?: string;
};

/** The sentence after "Saves." for a save mode, the same on the game page and the play page. */
export function savesSentence(mode: SaveMode, origins: readonly string[]): string {
  switch (mode) {
    case "site":
      return (
        `Signed in, this game saves to your ${SITE.name} account: up to ${SITE_SAVE_LIMITS.maxSlots} saves of ` +
        `${formatBytes(SITE_SAVE_LIMITS.maxBytes)}, deleted after ${SITE_SAVE_EXPIRY_DAYS} days you don't use them. ` +
        "Signed out, saves stay in this browser until you clear its site data."
      );
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
export function SaveNotice({ mode, connectOrigins, className }: SaveNoticeProps) {
  const connects = connectsToSentence(connectOrigins);
  return (
    <div className={cn("space-y-2 text-sm text-muted-foreground", className)} data-save-mode={mode}>
      <p>
        <strong className="font-semibold text-foreground">Saves.</strong>{" "}
        {savesSentence(mode, connectOrigins)}
      </p>
      <p>{PREFS_SENTENCE}</p>
      {connects ? <p>{connects}</p> : null}
    </div>
  );
}
