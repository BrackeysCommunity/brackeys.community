import type { client } from "@/orpc/client";

/** What `getPost` resolves for an existing post — the shape the post page
 *  renders, and what its loader passes back in. */
export type CollabPostDetailData = NonNullable<Awaited<ReturnType<typeof client.getPost>>>;
