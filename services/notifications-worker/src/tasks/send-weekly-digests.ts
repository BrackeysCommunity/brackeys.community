export async function handleWeeklyDigests(): Promise<void> {
  // PR1: stub. Phase 10 will scan unread notifications since each user's
  // last digest, group by user, and enqueue per-user `email:send` jobs.
  console.log("[weekly_digests] stub tick");
}
