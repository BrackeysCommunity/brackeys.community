/**
 * Route params for a profile link. `/profile/$userId` resolves either a
 * raw id or a vanity stub server-side, so prefer whatever handle the
 * user set for themselves and fall back to the id only when they
 * haven't claimed one.
 */
export function profileLinkParams(user: { id: string; urlStub?: string | null }) {
  return { userId: user.urlStub || user.id };
}

/** Coarse relative time for list rows — "just now" through "12d ago". */
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
