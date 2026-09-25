import { useStore } from "@tanstack/react-store";

import { ThemePreview } from "@/components/settings/ThemePreview";
import { Badge } from "@/components/ui/badge";
import { InlineCode, MarkedText, MicroLabel } from "@/components/ui/typography";
import { activeUserStore } from "@/lib/active-user-store";
import { buildCopyText, macroMarkdown } from "@/lib/command-copy";

import type { PaletteDetail } from "./use-palette-commands";

/** The preview pane for a local command: what it does, before you run it. */
export function CommandPreview({ label, detail }: { label: string; detail: PaletteDetail }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-3">
      <CommandPreviewBody label={label} detail={detail} />
    </div>
  );
}

function Example({ text, alt }: { text: string; alt?: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-t pt-2">
      <MicroLabel>EXAMPLE</MicroLabel>
      <InlineCode className="w-fit max-w-full truncate text-xs">{text}</InlineCode>
      {alt ? <InlineCode className="w-fit max-w-full truncate text-xs">{alt}</InlineCode> : null}
    </div>
  );
}

function BotExample({ detail }: { detail: Extract<PaletteDetail, { type: "bot" }> }) {
  const username = useStore(activeUserStore, (s) => s.profile?.discordUsername ?? undefined);
  return <Example text={buildCopyText(detail.command, username)} />;
}

function CommandPreviewBody({ label, detail }: { label: string; detail: PaletteDetail }) {
  switch (detail.type) {
    case "action":
      return (
        <>
          <MicroLabel>ACTION</MicroLabel>
          <p className="text-sm font-bold">{label}</p>
          <p className="text-muted-foreground">{detail.description}</p>
        </>
      );
    case "theme":
      return (
        <>
          <MicroLabel>THEME · {detail.mode.toUpperCase()}</MicroLabel>
          <ThemePreview theme={detail.theme} />
          <p className="text-sm font-bold">{detail.theme.name}</p>
          {detail.active ? (
            <Badge size="label" variant="outline" className="w-fit">
              ACTIVE
            </Badge>
          ) : null}
          <p className="text-muted-foreground">{detail.theme.description}</p>
        </>
      );
    case "bot":
      return (
        <>
          <MicroLabel>{detail.command.bot.toUpperCase()} BOT</MicroLabel>
          <p className="text-sm font-bold">{detail.command.cmd}</p>
          <p className="text-muted-foreground">{detail.command.description}</p>
          {detail.command.options?.length ? (
            <ul className="flex flex-col gap-1">
              {detail.command.options.map((option) => (
                <li key={option.name} className="text-muted-foreground">
                  <InlineCode className="text-xs">{option.name}</InlineCode> {option.description}
                  {option.required ? " (required)" : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <BotExample detail={detail} />
        </>
      );
    case "macro":
      return (
        <>
          <MicroLabel>MARCO MACRO</MicroLabel>
          <p className="text-sm font-bold">[]{detail.macro.name}</p>
          <MarkedText className="line-clamp-[12] text-xs text-muted-foreground">
            {macroMarkdown(detail.macro.description)}
          </MarkedText>
          {detail.macro.aliases.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {detail.macro.aliases.map((alias) => (
                <Badge key={alias} size="label" variant="outline">
                  []{alias}
                </Badge>
              ))}
            </div>
          ) : null}
          <Example text={`/macro name:${detail.macro.name}`} alt={`[]${detail.macro.name}`} />
        </>
      );
    case "recent-search":
      return (
        <>
          <MicroLabel>RECENT SEARCH</MicroLabel>
          <p className="text-sm font-bold">{detail.query}</p>
          <p className="text-muted-foreground">Run this search again.</p>
        </>
      );
    case "tag":
      return (
        <>
          <MicroLabel>FORUM TAG</MicroLabel>
          <p className="text-sm font-bold">#{detail.slug}</p>
          {detail.name !== detail.slug ? (
            <p className="text-muted-foreground">{detail.name}</p>
          ) : null}
          <p className="text-muted-foreground">
            {detail.usageCount} {detail.usageCount === 1 ? "post" : "posts"}
          </p>
        </>
      );
  }
}
