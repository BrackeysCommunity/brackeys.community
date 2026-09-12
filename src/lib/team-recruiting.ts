/**
 * What RECRUITING is allowed to mean.
 *
 * `teams.recruiting` is a self-declared boolean the owner sets in the manage
 * flyout, and nothing tied it to whether there was anywhere to apply. So a
 * team could wear the badge over a page with no OPEN POSITIONS section at
 * all — Cookie, on staging: "it's weird that i can see a 'recruiting' team
 * but can't apply to join it if they have no positions open." The only ways
 * into a team are an invite and an accepted response to one of its posts, so
 * with no open post the badge promises a door that does not exist.
 *
 * The column keeps its meaning — it is the owner's intent, and the manage
 * switch still edits exactly that. Display derives: the badge, the
 * directory's RECRUITING filter and the home page's count all ask this
 * question instead. `buildTeamFilter` mirrors it in SQL; keep the two in
 * step.
 */

/** True when the badge is honest: the team says it is recruiting *and* has
 *  at least one open post to respond to. */
export function isRecruiting(team: { recruiting: boolean | null; openPostCount: number }): boolean {
  return Boolean(team.recruiting) && team.openPostCount > 0;
}

/** The owner's side of the same rule: the switch is on, but the badge is
 *  dormant because nothing is posted. Drives the nudge to post an opening —
 *  without it the flag looks broken to the person who set it. */
export function isRecruitingWithoutPosts(team: {
  recruiting: boolean | null;
  openPostCount: number;
}): boolean {
  return Boolean(team.recruiting) && team.openPostCount === 0;
}
