/**
 * The app's feature flags, and what each one falls back to when PostHog
 * hasn't answered — no key configured, flags still in flight, the request
 * blocked, or the visitor opted out. Every flag needs an entry here: the keys
 * are what `useFlag` accepts, so a typo is a type error rather than a
 * silently-false flag.
 *
 * Keys must match the flag key in PostHog exactly. Defaults are the
 * pre-rollout state — normally `false` for anything not yet fully shipped.
 */
export const FEATURE_FLAGS = {
  /** Wiring check: flip it in PostHog to confirm flags reach the client. */
  "flag-smoke-test": false,
  /** The `/arcade` subtree: the landing, the store, and every game route. */
  "arcade-enabled": false,
  /** En Prison specifically, so it can soft-launch behind `arcade-enabled`. */
  "arcade-en-prison": false,
  /**
   * Paint rank icons in the guild's own gradient instead of the
   * theme-matched one. Off by default: the server's art is a single baked
   * yellow→magenta→violet sweep, which reads the same on a staff pill and a
   * community one and goes muddy against the non-default themes.
   */
  "server-role-icon-og-color": false,
} as const satisfies Record<string, boolean>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
