/**
 * Tag an email CTA URL so the session it opens is attributable. Without
 * these, every email-driven visit reads as direct traffic — PostHog ingests
 * UTM parameters natively, no client code involved.
 *
 * `utm_source` is always `email`; `medium` says which sender (per-event
 * notification, weekly digest, auth flow); `campaign` carries the
 * notification type so opt-out pressure can be traced to the emails that
 * caused it.
 */
export function withUtm(
  url: string,
  medium: "immediate" | "digest" | "auth",
  campaign?: string,
): string {
  try {
    const tagged = new URL(url);
    tagged.searchParams.set("utm_source", "email");
    tagged.searchParams.set("utm_medium", medium);
    if (campaign) tagged.searchParams.set("utm_campaign", campaign);
    return tagged.toString();
  } catch {
    // A relative or malformed URL is the caller's bug to surface, not ours
    // to mangle — send it through untagged.
    return url;
  }
}
