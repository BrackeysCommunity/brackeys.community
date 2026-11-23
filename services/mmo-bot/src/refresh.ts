import type * as api from "./api.ts";
import { pollEvery } from "./hunts.ts";
import type { Lexicon } from "./lexicon.ts";

/** How often the lexicon is read again when LEXICON_REFRESH_MS is unset. */
export const LEXICON_REFRESH_MS = 5 * 60_000;

/**
 * Keeps a lexicon fresh: read again every ms, and at once when asked, as
 * after a promotion is posted. A failed read keeps the names it had.
 */
export class LexiconRefresher {
  private reading: Promise<void> | null = null;

  constructor(
    private readonly lex: Lexicon,
    private readonly read: () => Promise<api.Lexicon>,
    private readonly log: (line: string) => void = console.log,
  ) {}

  /** Reads the lexicon again; reads already under way are shared. */
  refresh(): Promise<void> {
    this.reading ??= this.read()
      .then((data) => this.lex.update(data))
      .catch((e: unknown) => this.log(`[lexicon] ${String(e)}`))
      .finally(() => {
        this.reading = null;
      });
    return this.reading;
  }

  start(ms = LEXICON_REFRESH_MS): () => void {
    return pollEvery(ms, () => this.refresh(), this.log, "lexicon");
  }
}
