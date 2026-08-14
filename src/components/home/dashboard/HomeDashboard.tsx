import { Skeleton } from "@/components/ui/skeleton";
import { Well } from "@/components/ui/well";

import { AttentionStrip } from "./AttentionStrip";
import { JamDeadlines } from "./JamDeadlines";
import { MyApplications } from "./MyApplications";
import { MyPosts } from "./MyPosts";
import { MyTeams } from "./MyTeams";
import type { HomeDashboardData } from "./use-home-dashboard";

/**
 * The signed-in home: what's waiting on you, what you sent, what you posted,
 * who you're with, and what's on the clock. Every section hides itself when
 * empty, so a member with one application sees one strip rather than four
 * empty frames.
 *
 * Inserted under the feature rail rather than in place of anything: the hero
 * and the jam band are the same news for everyone, signed in or not. See
 * `HomePage` for the full argument.
 *
 * The same component serves both layouts — the grids collapse to one column
 * on a phone, which is exactly the stacked-cards shape the mobile home wants.
 * Two hierarchies for one dashboard would tell the same person different
 * things depending on which device they opened.
 */
export function HomeDashboard({ data }: { data: HomeDashboardData }) {
  if (data.isPending) return <HomeDashboardSkeleton />;

  return (
    <div className="flex flex-col gap-8">
      <AttentionStrip attention={data.attention} />

      <div className="grid gap-8 lg:grid-cols-2">
        <MyApplications applications={data.applications} />
        <MyPosts posts={data.posts} onExtended={data.attention.invalidatePosts} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <MyTeams teams={data.teams} />
        <JamDeadlines deadlines={data.jamDeadlines} />
      </div>
    </div>
  );
}

/**
 * Holds the dashboard's slot while its queries resolve. Without it the whole
 * page below settles at one height and then gets shoved down a moment later
 * when the sections arrive.
 */
function HomeDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-hidden>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-48 bg-muted/50" />
        <Well className="overflow-hidden">
          <ul className="divide-y divide-muted/20">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="h-4 w-16 shrink-0 bg-muted/50" />
                <Skeleton className="h-3.5 flex-1 bg-muted/50" />
                <Skeleton className="h-3 w-16 shrink-0 bg-muted/50" />
              </li>
            ))}
          </ul>
        </Well>
      </div>
    </div>
  );
}
