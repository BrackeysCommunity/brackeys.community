import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

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
}: {
  /** Set to make the note dismissable; the choice persists under this key. */
  dismissKey?: string;
  title?: string;
  steps?: string[];
  note?: string;
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
