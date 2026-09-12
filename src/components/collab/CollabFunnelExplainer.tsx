import { Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { authStore } from "@/lib/auth-store";
import { useMyProfileParams } from "@/lib/hooks/use-my-profile-params";

function readDismissed(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Private mode / quota — the note just shows again next time.
  }
}

const QUICK_POST_STEPS = [
  "Say who you're looking for, give the post a title and a description, and publish. That's all you need to get started.",
  "You don't need a team first. When someone responds and you accept them, you can start a team right then, or add them to one you already have.",
  "If your game has a page on the site, you can link it from the post afterwards. If it doesn't have one yet, that's fine too.",
];

/**
 * A plain-language note for people posting for the first time: what the
 * form needs now, and what can wait until after the post is live. Shown
 * above the quick-post screen (dismissal persists per browser) and again
 * on a freshly started team's page with its own wording.
 */
export function CollabFunnelExplainer({
  dismissKey,
  title = "How posting works",
  steps = QUICK_POST_STEPS,
  note = "Nothing here is final. You can change any of it after the post is live.",
  aside,
}: {
  /** Set to make the note dismissable; the choice persists under this key. */
  dismissKey?: string;
  title?: string;
  steps?: string[];
  note?: string;
  /** The other door. Three testers pressed POST A ROLE trying to *join*
      something, so the surface that explains posting also has to say what
      it is not for — see §3.1. Rendered under the note, above the
      dismissal. */
  aside?: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(() =>
    dismissKey ? readDismissed(dismissKey) : false,
  );
  if (dismissed) return null;

  return (
    <Well variant="ghost" className="gap-3 border-primary/30 bg-primary/5 p-4">
      <Text size="sm" bold>
        {title}
      </Text>
      <ol className="flex list-decimal flex-col gap-2 pl-5">
        {steps.map((step) => (
          <li key={step}>
            <Text size="sm" textWrap="pretty" className="text-foreground/90">
              {step}
            </Text>
          </li>
        ))}
      </ol>
      {aside ? <div className="border-t border-dashed border-primary/25 pt-3">{aside}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text size="sm" variant="muted" textWrap="pretty">
          {note}
        </Text>
        {dismissKey ? (
          <Button
            variant="outline"
            size="xs"
            className="tracking-widest"
            onClick={() => {
              writeDismissed(dismissKey);
              setDismissed(true);
            }}
          >
            OK, GOT IT
          </Button>
        ) : null}
      </div>
    </Well>
  );
}

/**
 * The signpost to the other door, for the explainer's `aside`.
 *
 * Yasahiro's two-line summary of the model — form a team with the collab
 * wizard, join one by opening your profile to work — is the copy, because
 * three testers in one morning went looking for the second door on the
 * first one's surface. The draft line is not reassurance for its own sake:
 * this link navigates out of an open wizard, and the creation draft does
 * survive it (`persistWizardDraft`).
 */
export function JoinInsteadNote() {
  const { session } = useStore(authStore);
  const profileParams = useMyProfileParams(session?.user?.id);
  if (!profileParams) return null;

  return (
    <Text size="sm" textWrap="pretty" className="text-foreground/90">
      <strong className="font-bold">Looking to be hired instead?</strong> This form is for finding
      people. To be found,{" "}
      <Link
        to="/profile/$userId"
        params={profileParams}
        className="text-primary underline-offset-4 hover:underline"
      >
        open your profile to work
      </Link>{" "}
      — anything you have typed here is saved.
    </Text>
  );
}
