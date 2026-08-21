/**
 * The one definition of what a profile URL stub may look like, shared by
 * the settings endpoint (user-chosen stubs) and the Discord sync (stubs
 * defaulted from the Discord username at sign-in).
 */
export const STUB_REGEX = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;

/**
 * Derive a default stub from a Discord username, or null when the result
 * wouldn't be a valid stub. Discord usernames are lowercase `a-z 0-9 _ .`;
 * the `.` is the only character stubs disallow, so it maps to `-`.
 */
export function discordUsernameToStub(username: string): string | null {
  const stub = username.trim().toLowerCase().replaceAll(".", "-");
  return STUB_REGEX.test(stub) ? stub : null;
}
