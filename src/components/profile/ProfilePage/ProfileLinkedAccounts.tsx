import {
  Add01Icon,
  ArrowUpRight01Icon,
  Delete02Icon,
  GithubIcon,
  Link01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { env } from "@/env";
import { authClient } from "@/lib/auth-client";
import { client } from "@/orpc/client";

import type { ProfileLink } from "./helpers";
import { ProfileEmptyState } from "./ProfileEmptyState";
import { ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileLinkedAccountsSectionProps {
  index: string;
  links: ProfileLink[];
  isOwner: boolean;
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
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to unlink GitHub"),
  });
  const unlinkItch = useMutation({
    mutationFn: () => client.unlinkItchIo({}),
    onSuccess: () => {
      invalidate();
      toast.success("Unlinked itch.io");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to unlink itch.io"),
  });

  // Map a row's display label back to the OAuth provider whose
  // unlink mutation owns the row. Custom-URL rows (synthesized
  // from the legacy `githubUrl` / `websiteUrl` columns) bounce to
  // the flyout instead of running an unlink — those values live on
  // `developer_profiles`, not the `linked_accounts` table.
  const handleRemove = (link: ProfileLink) => {
    const provider = link.label.toUpperCase();
    if (provider === "GITHUB" && link.id !== "github-url") unlinkGithub.mutate();
    else if (provider === "ITCHIO" || provider === "ITCH.IO") unlinkItch.mutate();
    else onEdit();
  };

  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader
        index={index}
        title="LINKED"
        action={
          isOwner ? (
            <AddProviderMenu
              onManual={onEdit}
              hideGithub={links.some(
                (l) => l.label.toUpperCase() === "GITHUB" && l.id !== "github-url",
              )}
              hideItch={links.some((l) => {
                const lbl = l.label.toUpperCase();
                return lbl === "ITCHIO" || lbl === "ITCH.IO";
              })}
            />
          ) : null
        }
      />
      {links.length === 0 ? (
        <ProfileEmptyState
          glyph="↗"
          title="No linked accounts yet"
          hint="Wire your GitHub, itch.io, portfolio site, or fediverse handle so collaborators can find you anywhere."
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
                <LinkRow link={link} onRemove={isOwner ? () => handleRemove(link) : undefined} />
              </li>
            ))}
          </ul>
        </Well>
      )}
    </section>
  );
}

function AddProviderMenu({
  onManual,
  hideGithub,
  hideItch,
}: {
  onManual: () => void;
  hideGithub: boolean;
  hideItch: boolean;
}) {
  const [linking, setLinking] = useState<"github" | "itchio" | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="xs" className="font-mono tracking-widest">
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
            className="font-mono text-xs tracking-widest uppercase"
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
            className="font-mono text-xs tracking-widest uppercase"
          >
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center font-bold">⌑</span>
            itch.io
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={onManual}
          className="font-mono text-xs tracking-widest uppercase"
        >
          <HugeiconsIcon icon={Link01Icon} size={14} />
          Custom URL
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function linkGithub(): Promise<void> {
  try {
    const result = await authClient.signIn.social({
      provider: "github",
      callbackURL: "/oauth/github/callback",
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
    toast.error(e instanceof Error ? e.message : "Failed to link GitHub");
  }
}

function startItchOAuth(): void {
  const clientId = env.VITE_ITCHIO_CLIENT_ID;
  if (!clientId) {
    toast.error("itch.io integration is not configured");
    return;
  }
  // Same flow shape `ProfileEditForm` uses — kept inline here so the
  // section is self-contained and the redesigned page can stand on
  // its own without depending on the legacy form's helpers.
  const productionOrigin = env.VITE_OAUTH_PROXY_ORIGIN;
  const currentOrigin = window.location.origin;
  const isPreview = productionOrigin && currentOrigin !== productionOrigin;
  const redirectUri = isPreview
    ? `${productionOrigin}/oauth/itchio/callback`
    : `${currentOrigin}/oauth/itchio/callback`;
  const state = isPreview ? currentOrigin : "";
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "profile:me profile:games",
    response_type: "token",
    redirect_uri: redirectUri,
    ...(state ? { state } : {}),
  });
  window.location.href = `https://itch.io/user/oauth?${params.toString()}`;
}

function LinkRow({ link, onRemove }: { link: ProfileLink; onRemove?: () => void }) {
  // The row is anchor-by-default — clicking opens the linked
  // account in a new tab. When `onRemove` is provided we layer a
  // standalone remove `Button` on top of it (taking its own click
  // out of the anchor's bubble), so owners get a one-tap unlink
  // without losing the rest of the row's open-on-click behaviour.
  return (
    <div className="group relative grid grid-cols-[3rem_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/15">
      <Chonk
        variant="surface"
        size="lg"
        className="flex h-12 w-12 items-center justify-center font-mono text-sm font-bold tracking-widest text-warning"
      >
        {link.monogram}
      </Chonk>
      <div className="flex min-w-0 flex-col">
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          {link.label}
        </Text>
        <Text size="sm" className="truncate">
          {link.display}
        </Text>
      </div>
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${link.label}`}
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
