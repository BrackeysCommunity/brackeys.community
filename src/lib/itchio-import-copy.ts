/**
 * Toast copy for the itch.io library import, shared by the OAuth callback
 * (fresh link) and the profile sync bar (manual re-sync). The count users
 * see must not quietly disagree with the games that actually appear —
 * drafts import fine but stay owner-only, so they get named.
 */

export interface ItchImportResult {
  imported: number;
  total: number;
  drafts: number;
}

function draftsNote(drafts: number): string {
  if (drafts === 0) return "";
  return drafts === 1
    ? ` — 1 is a draft and stays hidden until published on itch.io`
    : ` — ${drafts} are drafts and stay hidden until published on itch.io`;
}

/** After a fresh link's auto-import. */
export function describeLinkImport({ imported, total, drafts }: ItchImportResult): string {
  if (total === 0) return "Linked! No games found on this itch.io account yet";
  // Re-linking an account whose games are already imported used to read
  // "Imported 0 games", which lands as an error.
  if (imported === 0)
    return `Linked! Your itch.io library is already imported${draftsNote(drafts)}`;
  return `Imported ${imported} game${imported === 1 ? "" : "s"} from itch.io${draftsNote(drafts)}`;
}

/** After the sync bar's manual re-import. */
export function describeResyncImport({ imported, total, drafts }: ItchImportResult): string {
  if (imported === 0) {
    if (total === 0) return "No games found on this itch.io account yet";
    return `itch.io library is up to date${draftsNote(drafts)}`;
  }
  return `Imported ${imported} new game${imported === 1 ? "" : "s"} from itch.io${draftsNote(drafts)}`;
}
