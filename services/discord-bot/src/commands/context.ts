/** What every command gets besides its input. `now` is injected so the jam
 *  phases and countdowns are testable against a fixed clock. */
export interface CommandContext {
  now: Date;
  /** Deep-link origin, no trailing slash. */
  appUrl: string;
  /** Whose jams `/jam now` looks up. */
  hostName: string;
  /** Resolves ids from autocompleted options back to names for the filter
   *  echo. Optional: the memo may be cold. */
  names?: {
    skill(id: number): string | undefined;
    role(id: number): string | undefined;
  };
}
