/** One day of milliseconds — the constant every hand-rolled day-math site
 * used to respell. */
export const DAY_MS = 86_400_000;

/**
 * Coarse relative time for dense list rows — "just now" through "12d ago".
 *
 * Deliberately terser than date-fns' `formatDistanceToNowStrict` ("3h ago"
 * vs "3 hours ago"): these render inside collab cards and notification
 * rows where the timestamp is a trailing annotation, not the content. One
 * voice everywhere, so the notification inbox and the collab board agree.
 */
export function timeAgo(date: string | Date | null): string {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
