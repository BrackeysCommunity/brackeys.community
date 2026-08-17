/**
 * The event taxonomy. Names and shared property shapes live here, and
 * nothing else — no PostHog import — so both browser components and server
 * procedures can pull from the same list.
 *
 * ## The naming rule
 *
 * `<domain>_<object>_<action>`, snake_case, past tense. The domain leads so
 * PostHog's alphabetical event list groups a whole surface together: every
 * `collab_*` sits in one block, `team_*` in the next. Resist naming an event
 * after the UI that fired it (`flyout_next_clicked`) — the same flow moves
 * between surfaces and the name stops matching.
 *
 * ## Multi-step flows
 *
 * A wizard emits one `*_step_advanced` event per step rather than a distinct
 * event name per step, with the step in a property. Build the funnel in
 * PostHog by repeating that event and filtering on `step` — the drop-off
 * between "roles" and "review" is then a property filter, not five event
 * names to keep in sync with the code.
 *
 * `*_step_blocked` is the companion worth having: it fires when validation
 * refuses to advance, so a step with heavy drop-off can be read as "people
 * left" versus "the form wouldn't let them through", which are opposite
 * problems.
 *
 * ## Where each event fires
 *
 * Outcomes are captured **server-side**, inside the procedure that performed
 * the write: that is where success is actually known, and it survives ad
 * blockers and the analytics opt-out. Intent and navigation are captured
 * **client-side**, because the server never sees them. A funnel therefore
 * mixes both, which is fine — they share a distinct id, since the browser
 * calls `identify(user.id)` and server captures pass the same id.
 *
 * ⚠️ One funnel shape is impossible: cookieless mode has no persistent
 * anonymous id, so an anonymous visitor never merges into their identified
 * self. Any funnel whose first step precedes sign-in will not stitch. Start
 * funnels at or after the sign-in boundary.
 */

export const EVENTS = {
  // Account lifecycle. Server-side, from better-auth's database hooks.
  authSignedUp: "auth_signed_up",
  authSignedIn: "auth_signed_in",
  authAccountDeleted: "auth_account_deleted",

  // Collab post authoring — the create/edit wizard.
  collabPostFlowStarted: "collab_post_flow_started",
  collabPostStepAdvanced: "collab_post_step_advanced",
  collabPostStepBlocked: "collab_post_step_blocked",
  collabPostSubmitted: "collab_post_submitted",
  collabPostCreated: "collab_post_created",

  // Collab post responses — the other half of the loop.
  collabResponseSubmitted: "collab_response_submitted",
  collabResponseStatusChanged: "collab_response_status_changed",

  // Teams.
  teamCreated: "team_created",
  teamInviteSent: "team_invite_sent",
  teamInviteAnswered: "team_invite_answered",

  // Jams.
  jamWatchToggled: "jam_watch_toggled",
  jamParticipationAdded: "jam_participation_added",

  // Profile editing — the four-step flyout.
  profileEditStarted: "profile_edit_started",
  profileEditStepAdvanced: "profile_edit_step_advanced",
  profileSaved: "profile_saved",
} as const;

export type AnalyticsEvent = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * Flow identifiers. A step event is only interpretable next to the flow it
 * belongs to, and two flows share step names (`review`), so this keeps them
 * apart in a filter.
 */
export const FLOWS = {
  collabPost: "collab_post",
  profileEdit: "profile_edit",
} as const;

export type AnalyticsFlow = (typeof FLOWS)[keyof typeof FLOWS];

/**
 * The envelope every step event carries. `step_index` is 1-based to match
 * what the UI shows the user ("STEP 2/5"), so a funnel chart and a
 * screenshot of the wizard agree.
 */
export interface FlowStepProps extends Record<string, unknown> {
  flow: AnalyticsFlow;
  step: string;
  step_index: number;
  step_count: number;
}

export function flowStep(
  flow: AnalyticsFlow,
  step: string,
  index: number,
  count: number,
): FlowStepProps {
  return { flow, step, step_index: index, step_count: count };
}
