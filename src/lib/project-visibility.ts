import { sql } from "drizzle-orm";

import { profileProjects } from "@/db/schema";

/**
 * The four conditions that make a profile placement public — a `SQL` chunk
 * so it reads the same inside a `.where()` and inside the directory's
 * correlated subqueries.
 *
 * Every surface that lists someone's shipped work has to apply the whole
 * set, and they drifted apart once already: the jam community shelf honoured
 * `status` and `published` but not the two visibility stamps, so an itch.io
 * "Restricted" game stayed hidden on its owner's profile and listed on the
 * jam page.
 *
 *   status        moderation.
 *   published     the provider's own flag — an itch.io draft is owner-only.
 *   restricted_at set by the crawler's URL probe for pages the API reports
 *                 published but which 404 for anonymous visitors (itch.io
 *                 "Restricted" visibility, which the API exposes no field
 *                 for). See the `itchio-scraper` library tier.
 *   missing_since the game left the linked library — deleted on itch, or
 *                 this member lost access.
 */
export const PUBLIC_PLACEMENT = sql`${profileProjects.status} = 'approved'
  and ${profileProjects.published} = true
  and ${profileProjects.restrictedAt} is null
  and ${profileProjects.missingSince} is null`;
