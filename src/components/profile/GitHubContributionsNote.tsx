import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/** GitHub's own profile settings, where the contribution-visibility
 *  toggle lives. */
const GITHUB_PROFILE_SETTINGS = "https://github.com/settings/profile";

/**
 * The one thing that makes an ACTIVITY graph look broken when it isn't.
 *
 * GitHub's API only reports work in private repos when the member has
 * turned on *Private contributions* — so anyone whose day job lives in
 * private orgs sees a near-empty graph here and reasonably concludes we
 * lost their history. It's a GitHub-side toggle nobody can flip for them,
 * and it applies to the token we already hold, so flipping it is the whole
 * fix: the graph catches up once `getContributions` falls out of its edge
 * cache (15 minutes, see `PUBLIC_EDGE_TTL`). No relink needed.
 *
 * Shown wherever someone links GitHub or looks at the graph it feeds.
 */
export function GitHubContributionsNote({ className }: { className?: string }) {
  return (
    <Text size="xs" variant="muted" className={cn("text-balance", className)}>
      Work in private repos only shows up if GitHub&apos;s{" "}
      <a
        href={GITHUB_PROFILE_SETTINGS}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 transition-colors hover:text-foreground"
      >
        Private contributions
      </a>{" "}
      setting is on — that one is on GitHub&apos;s side, not ours. Turn it on, then reload here: the
      graph catches up within about 15 minutes.
    </Text>
  );
}
