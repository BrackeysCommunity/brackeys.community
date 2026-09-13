import {
  Add01Icon,
  ArrowUpRight01Icon,
  Delete02Icon,
  GithubIcon,
  GitlabIcon,
  Link01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/error-message";
import { EVENTS } from "@/lib/event-taxonomy";
import { gitlabCallbackPath, isGitLabProvider } from "@/lib/gitlab-instances";
import { startItchOAuth } from "@/lib/itchio-oauth";
import { toastMutationError } from "@/lib/mutation-errors";
import { captureEvent, reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import type { ProfileLink } from "./helpers";
import { ProfileEmptyState } from "./ProfileEmptyState";
import { ProfileSectionHeader } from "./ProfileSectionHeader";
import { WebsiteVerifyDialog } from "./WebsiteVerifyDialog";

interface ProfileLinkedAccountsSectionProps {
  index: string;
  links: ProfileLink[];
  isOwner: boolean;
  /** Names the member in visitor-facing empty copy. */
  profileName?: string;
  /** Deep-link into the flyout's LINKS step — used for the trailing
   * "edit URLs" affordance and as a fallback if a provider OAuth
   * isn't available. */
  onEdit: () => void;
  /** Query key for the underlying `getProfile` fetch — invalidated
   * after every owner mutation (add/remove) so the section
   * re-renders with the persisted data. */
  queryKey?: readonly unknown[];
}

/**
 * `§NN LINKED` — vertical list of linked accounts. Each row leads
 * with a square monogram chip (provider initials), then an uppercase
 * label + URL stub, then a trailing external-link icon. The header
 * `+ ADD` action drops a small dropdown of the providers we support
 * via OAuth (GitHub auth-link, itch.io OAuth) plus a "manual URL"
 * fallback that hops over to the LINKS step of the edit flyout.
 */
export function ProfileLinkedAccountsSection({
  index,
  links,
  isOwner,
  profileName,
  onEdit,
  queryKey,
}: ProfileLinkedAccountsSectionProps) {
  const qc = useQueryClient();
  const invalidate = () => {
    if (queryKey) void qc.invalidateQueries({ queryKey });
  };

  const unlinkGithub = useMutation({
    mutationFn: () => client.unlinkGitHub({}),
    onSuccess: () => {
      invalidate();
      toast.success("Unlinked GitHub");
    },
    onError: toastMutationError("profile.unlink_github", "Failed to unlink GitHub"),
  });
  const unlinkGitlab = useMutation({
    mutationFn: (providerId: string) => client.unlinkGitLab({ providerId }),
    onSuccess: () => {
      invalidate();
      toast.success("Unlinked GitLab");
    },
    onError: toastMutationError("profile.unlink_gitlab", "Failed to unlink GitLab"),
  });
  const unlinkItch = useMutation({
    mutationFn: () => client.unlinkItchIo({}),
    onSuccess: () => {
      invalidate();
      toast.success("Unlinked itch.io");
    },
    onError: toastMutationError("profile.unlink_itchio", "Failed to unlink itch.io"),
  });

  // Map a row back to the OAuth provider whose unlink mutation owns it.
  // Custom-URL rows (synthesized from the legacy `githubUrl` /
  // `websiteUrl` columns) carry no `provider` and bounce to the flyout
  // instead — those values live on `developer_profiles`, not the
  // `linked_accounts` table.
  const handleRemove = (link: ProfileLink) => {
    const provider = link.provider;
    if (provider === "github") unlinkGithub.mutate();
    else if (isItchProvider(provider)) unlinkItch.mutate();
    else if (provider && isGitLabProvider(provider)) unlinkGitlab.mutate(provider);
    else onEdit();
  };

  // One PORTFOLIO row per profile, so one piece of state rather than a
  // dialog mounted per row.
  const [verifyOpen, setVerifyOpen] = useState(false);

  const linkedProviders = new Set(
    links.map((l) => l.provider).filter((p): p is string => p != null),
  );

  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader
        index={index}
        title="LINKED"
        action={
          isOwner ? <AddProviderMenu onManual={onEdit} linkedProviders={linkedProviders} /> : null
        }
      />
      {links.length === 0 ? (
        <ProfileEmptyState
          glyph="↗"
          title="No linked accounts yet"
          hint={
            isOwner
              ? "Wire your GitHub, itch.io, portfolio site, or fediverse handle so collaborators can find you anywhere."
              : `${profileName ?? "This member"} hasn't linked any accounts yet.`
          }
          cta={
            isOwner
              ? {
                  label: "+ LINK GITHUB",
                  onClick: () => void linkGithub(),
                }
              : undefined
          }
        />
      ) : (
        <Well className="overflow-hidden p-0">
          <ul className="flex flex-col divide-y divide-muted/30">
            {links.map((link) => (
              <li key={link.id}>
                <LinkRow
                  link={link}
                  onRemove={isOwner ? () => handleRemove(link) : undefined}
                  // The PORTFOLIO row is the only one whose host nobody has
                  // proved — GITHUB and GITLAB rows are their own proof.
                  onVerify={
                    isOwner && link.id === "website-url" ? () => setVerifyOpen(true) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </Well>
      )}
      {isOwner ? (
        <WebsiteVerifyDialog
          open={verifyOpen}
          onClose={() => setVerifyOpen(false)}
          onVerified={invalidate}
        />
      ) : null}
    </section>
  );
}

function AddProviderMenu({
  onManual,
  linkedProviders,
}: {
  onManual: () => void;
  /** `linked_accounts.provider` values already on the profile — each one
   *  drops out of the menu. */
  linkedProviders: Set<string>;
}) {
  const [linking, setLinking] = useState<string | null>(null);
  // Which GitLab instances this deployment has credentials for. An
  // unconfigured instance is absent rather than an entry that 500s.
  const { data: gitlabInstances } = useQuery({
    ...orpc.listGitLabInstances.queryOptions({ input: {} }),
    staleTime: STALE.taxonomy,
  });
  const hideGithub = linkedProviders.has("github");
  const hideItch = linkedProviders.has("itchio") || linkedProviders.has("itch.io");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="xs" className="tracking-widest">
            <HugeiconsIcon icon={Add01Icon} size={12} />
            ADD
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-44">
        {hideGithub ? null : (
          <DropdownMenuItem
            onClick={() => {
              setLinking("github");
              void linkGithub().finally(() => setLinking(null));
            }}
            disabled={linking === "github"}
            className="text-xs tracking-widest uppercase"
          >
            <HugeiconsIcon icon={GithubIcon} size={14} />
            {linking === "github" ? "Connecting…" : "GitHub"}
          </DropdownMenuItem>
        )}
        {hideItch ? null : (
          <DropdownMenuItem
            onClick={() => {
              setLinking("itchio");
              try {
                startItchOAuth();
              } finally {
                setLinking(null);
              }
            }}
            disabled={linking === "itchio"}
            className="text-xs tracking-widest uppercase"
          >
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center font-bold">⌑</span>
            itch.io
          </DropdownMenuItem>
        )}
        {(gitlabInstances ?? [])
          .filter((instance) => !linkedProviders.has(instance.providerId))
          .map((instance) => (
            <DropdownMenuItem
              key={instance.providerId}
              onClick={() => {
                setLinking(instance.providerId);
                void linkGitlab(instance.providerId).finally(() => setLinking(null));
              }}
              disabled={linking === instance.providerId}
              className="text-xs tracking-widest uppercase"
            >
              <HugeiconsIcon icon={GitlabIcon} size={14} />
              {linking === instance.providerId ? "Connecting…" : instance.label}
            </DropdownMenuItem>
          ))}
        <DropdownMenuItem onClick={onManual} className="text-xs tracking-widest uppercase">
          <HugeiconsIcon icon={Link01Icon} size={14} />
          Custom URL
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function linkGithub(): Promise<void> {
  try {
    captureEvent(EVENTS.accountLinkStarted, { provider: "github" });
    const result = await authClient.signIn.social({
      provider: "github",
      callbackURL: "/oauth/github/callback",
      // Same handoff as GitLab's: a cancelled consent screen comes back
      // into the app rather than better-auth's error page.
      errorCallbackURL: "/oauth/github/callback",
    });
    if (
      result &&
      typeof result === "object" &&
      "error" in result &&
      (result as { error: unknown }).error
    ) {
      const err = (result as { error: string | { message?: string } }).error;
      const message = typeof err === "string" ? err : err.message || "Failed to start GitHub OAuth";
      throw new Error(message);
    }
  } catch (e) {
    reportMutationError(e, "profile.link_github");
    toast.error(errorMessage(e, "Failed to link GitHub"));
  }
}

function isItchProvider(provider: string | undefined): boolean {
  return provider === "itchio" || provider === "itch.io";
}

async function linkGitlab(providerId: string): Promise<void> {
  try {
    captureEvent(EVENTS.accountLinkStarted, { provider: providerId });
    // `oauth2.link` rather than `signIn.oauth2`: the member is already
    // signed in, and this attaches the instance to that account.
    const result = await authClient.oauth2.link({
      providerId,
      callbackURL: gitlabCallbackPath(providerId),
      // Without this, cancelling the consent screen lands on better-auth's
      // own `/api/auth/error` page — outside the app, with no way back.
      errorCallbackURL: gitlabCallbackPath(providerId),
    });
    if (result?.error) {
      throw new Error(result.error.message || "Failed to start GitLab OAuth");
    }
  } catch (e) {
    reportMutationError(e, "profile.link_gitlab");
    toast.error(errorMessage(e, "Failed to link GitLab"));
  }
}

function LinkRow({
  link,
  onRemove,
  onVerify,
}: {
  link: ProfileLink;
  onRemove?: () => void;
  /** Owner-only, PORTFOLIO row only: opens the domain-proof dialog. An
   *  unverified row gets a VERIFY button; a verified one gets the badge,
   *  which reveals a re-check on hover rather than carrying a second
   *  control the owner has no reason to look at. */
  onVerify?: () => void;
}) {
  // The row is anchor-by-default — clicking opens the linked
  // account in a new tab. When `onRemove` is provided we layer a
  // standalone remove `Button` on top of it (taking its own click
  // out of the anchor's bubble), so owners get a one-tap unlink
  // without losing the rest of the row's open-on-click behaviour.
  return (
    <div className="group relative grid grid-cols-[3rem_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/15">
      <Chonk
        variant="surface"
        size="lg"
        className="flex h-12 w-12 items-center justify-center font-mono text-sm font-bold tracking-widest text-warning"
      >
        {link.monogram}
      </Chonk>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2">
          <Text size="xs" variant="muted" className="tracking-widest">
            {link.label}
          </Text>
          {link.verifiedAt ? (
            // Domain control, never identity — so a word, not a checkmark.
            <SimpleTooltip
              content={`Domain control verified on ${new Date(link.verifiedAt).toLocaleDateString()}`}
            >
              {/* z-10, like the RECONNECT chip: the row's stretched anchor
                  would otherwise sit above this and swallow the hover that
                  reveals the re-check. */}
              <span className="group/verified relative z-10 inline-flex items-center gap-1">
                <Badge variant="success" size="label">
                  VERIFIED
                </Badge>
                {onVerify ? (
                  // Collapsed to nothing until the badge is hovered or this
                  // is tabbed to, so a proof that holds says one thing.
                  <button
                    type="button"
                    onClick={onVerify}
                    aria-label="Check this domain again"
                    className="relative z-10 w-0 -translate-x-1 overflow-hidden text-muted-foreground opacity-0 transition-all duration-150 ease-out group-hover/verified:w-3.5 group-hover/verified:translate-x-0 group-hover/verified:opacity-100 hover:text-foreground focus-visible:w-3.5 focus-visible:translate-x-0 focus-visible:opacity-100 motion-reduce:transition-none"
                  >
                    <HugeiconsIcon icon={RefreshIcon} size={14} />
                  </button>
                ) : null}
              </span>
            </SimpleTooltip>
          ) : null}
          {link.needsReconnect && isItchProvider(link.provider) ? (
            // z-10 lifts the button above the row's stretched anchor so the
            // click starts the OAuth flow instead of opening the stale link.
            // Itch is the only provider whose tokens are swept, and the only
            // one this button knows how to restart.
            <button
              type="button"
              onClick={() => startItchOAuth()}
              aria-label={`Reconnect ${link.label}`}
              className="relative z-10 cursor-pointer"
            >
              <Badge variant="warning" size="label">
                RECONNECT
              </Badge>
            </button>
          ) : null}
        </div>
        <Text size="sm" className="truncate">
          {link.display}
        </Text>
      </div>
      {onVerify && !link.verifiedAt ? (
        <Button
          variant="outline"
          size="xs"
          onClick={onVerify}
          className="relative z-10 tracking-widest"
        >
          VERIFY
        </Button>
      ) : (
        <span />
      )}
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${link.label}`}
          tooltip={`Remove ${link.label}`}
          onClick={onRemove}
          className="relative z-10 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon icon={Delete02Icon} size={14} />
        </Button>
      ) : (
        <span />
      )}
      <HugeiconsIcon
        icon={ArrowUpRight01Icon}
        size={16}
        className="text-muted-foreground transition-colors group-hover:text-foreground"
      />
      {/* Stretched anchor — covers the row so clicks anywhere except
          on the explicit remove button open the link. */}
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${link.label}`}
        className="absolute inset-0"
      />
    </div>
  );
}
