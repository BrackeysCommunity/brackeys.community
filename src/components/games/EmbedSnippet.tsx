import { Copy01Icon, SourceCodeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Text } from "@/components/ui/typography";
import { siteUrl } from "@/env";
import { SITE } from "@/lib/legal-meta";
import { toast } from "@/lib/toast";

/** The `<iframe>` another site pastes to embed a game's live version. */
export function embedSnippet(projectId: string, title: string): string {
  const src = siteUrl(`/games/${encodeURIComponent(projectId)}/embed/latest`);
  const label = title.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  return (
    `<iframe src="${src}" title="${label}" width="960" height="600" ` +
    `allow="autoplay; fullscreen; gamepad" allowfullscreen style="border:0"></iframe>`
  );
}

async function copySnippet(snippet: string) {
  try {
    await navigator.clipboard.writeText(snippet);
    toast.success("Embed code copied.");
  } catch {
    toast.error("Couldn't copy the embed code.");
  }
}

/** "Embed": the snippet for a public or unlisted game, to read or copy. */
export function EmbedSnippet({ projectId, title }: { projectId: string; title: string }) {
  const snippet = embedSnippet(projectId, title);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <HugeiconsIcon icon={SourceCodeIcon} data-icon="inline-start" />
        Embed
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="flex w-96 max-w-[92vw] flex-col gap-3"
      >
        <Text as="p" size="sm" variant="muted">
          Paste this on your site to play the live version there. Saves made in an embed stay in
          that browser; players can open the game on {SITE.name} to keep them.
        </Text>
        <Textarea
          readOnly
          value={snippet}
          aria-label="Embed code"
          rows={4}
          className="text-xs break-all"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button size="sm" className="self-end" onClick={() => void copySnippet(snippet)}>
          <HugeiconsIcon icon={Copy01Icon} data-icon="inline-start" />
          Copy
        </Button>
      </PopoverContent>
    </Popover>
  );
}
