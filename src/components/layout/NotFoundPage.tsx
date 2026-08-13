import { ArrowLeft02Icon, Login01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { authClient, signInWithDiscord } from "@/lib/auth-client";

interface NotFoundPageProps {
  /** What is missing, capitalized — "Jam", "Project". Defaults to "Page". */
  subject?: string;
  /** Replaces the default line under the heading. */
  message?: string;
}

const DESTINATIONS = [
  { to: "/jams", label: "Jam board", blurb: "Every jam we track, live and upcoming." },
  { to: "/members", label: "Member directory", blurb: "The people building here." },
  { to: "/teams", label: "Teams", blurb: "Crews shipping together." },
  { to: "/collab", label: "Collab board", blurb: "Open posts looking for people." },
] as const;

/**
 * The one 404 surface. Every dead URL lands here: a route that matches
 * nothing, a loader that threw `notFound()`, and — deliberately — anything
 * the viewer isn't allowed to see. Restricted pages 404 rather than 403 so
 * their existence leaks nothing, which is why this page never says
 * "forbidden" and never names what it's hiding. The signed-out note is the
 * only nod to authorization, and it's true of the site generally rather
 * than of the URL in the address bar.
 */
export function NotFoundPage({ subject = "Page", message }: NotFoundPageProps) {
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: session, isPending } = authClient.useSession();
  const signedOut = !isPending && !session;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-8">
      <div className="flex flex-col gap-3">
        <MicroLabel as="p" variant="danger" className="uppercase">
          § ERROR 404
        </MicroLabel>
        <Heading as="h1" size="3xl" display>
          {subject} not found
        </Heading>
        <Text as="p" variant="muted" textWrap="pretty">
          {message ??
            "That link doesn't match anything here. It may have moved, been deleted, or never existed."}
        </Text>

        {/* The path is what people actually check on a 404 — a typo or a
            truncated paste is visible the moment they can read it back. */}
        <Well variant="ghost" className="w-full flex-row items-center gap-2 px-3 py-2">
          <MicroLabel as="span" ellipsis className="min-w-0 flex-1">
            {pathname}
          </MicroLabel>
        </Well>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="default"
          className="tracking-widest"
          nativeButton={false}
          render={<Link to="/" aria-label="Back to the home page" />}
        >
          HOME
        </Button>
        <Button
          variant="outline"
          className="gap-1.5 tracking-widest"
          onClick={() => router.history.back()}
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} size={12} />
          GO BACK
        </Button>
      </div>

      {signedOut ? (
        <Well className="items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <Text as="p" size="sm" variant="muted" textWrap="pretty" className="min-w-0 flex-1">
            Signed out. Some pages only load for members — signing in may bring this one back.
          </Text>
          <Button variant="outline" className="shrink-0 gap-2" onClick={() => signInWithDiscord()}>
            <HugeiconsIcon icon={Login01Icon} size={13} />
            Sign In with Discord
          </Button>
        </Well>
      ) : null}

      <Section title="TRY THESE" blurb="The parts of the site that are definitely still here.">
        <Well className="gap-0 divide-y divide-dashed divide-muted/40 p-0 backdrop-blur-none">
          {DESTINATIONS.map((destination) => (
            <Link
              key={destination.to}
              to={destination.to}
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Text
                  as="span"
                  size="sm"
                  bold
                  className="tracking-wider transition-colors group-hover:text-primary"
                >
                  {destination.label}
                </Text>
                <Text as="span" size="sm" variant="muted" ellipsis>
                  {destination.blurb}
                </Text>
              </span>
              <MicroLabel as="span" className="shrink-0 uppercase">
                OPEN →
              </MicroLabel>
            </Link>
          ))}
        </Well>
      </Section>
    </div>
  );
}
