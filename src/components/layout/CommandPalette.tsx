import {
  Comment01Icon,
  ComputerTerminal01Icon,
  LegalHammerIcon,
  Login01Icon,
  PaintBrush04Icon,
  PencilIcon,
  Robot01Icon,
  Settings02Icon,
  Share01Icon,
  Shield02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { openDiscordInvite } from "@/components/ui/discord-invite-link";
import { allBotCommands, hammerCommands, marcoMacros, pencilCommands } from "@/data/commands";
import { activeUserStore } from "@/lib/active-user-store";
import { authClient, signInWithDiscord } from "@/lib/auth-client";
import { forumPostParam, forumPostTitle } from "@/lib/forum-posts";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useFlag } from "@/lib/hooks/use-flag";
import { useSearchPerformed } from "@/lib/hooks/use-search-performed";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  // cmdk filters synchronously on render, so counting rendered items after
  // the query commits is the result count — it has no count API of its own.
  const [resultCount, setResultCount] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    setResultCount(listRef.current?.querySelectorAll("[cmdk-item]").length ?? 0);
  }, [query, open]);
  useSearchPerformed({
    surface: "command_palette",
    query: open ? query : undefined,
    filterKinds: [],
    resultCount,
  });
  const navigate = useNavigate();
  const { themeId, setTheme, sections } = useAppTheme();
  const { data: session } = authClient.useSession();
  const isStaff = useStore(activeUserStore, (s) => s.profile?.isStaff ?? false);
  const forumOn = useFlag("forum-enabled");
  const forumQuery = useDebouncedValue(query.trim(), 250);
  const forumSearchable = open && forumOn && forumQuery.length >= 2;
  const { data: forumPosts } = useQuery({
    ...orpc.searchForumPosts.queryOptions({ input: { query: forumQuery, limit: 5 } }),
    enabled: forumSearchable,
    staleTime: STALE.listing,
  });
  const { data: forumTags } = useQuery({
    ...orpc.searchForumTags.queryOptions({ input: { query: forumQuery, limit: 4 } }),
    enabled: forumSearchable,
    staleTime: STALE.listing,
  });

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Search commands, bots, and macros"
    >
      <Command className="font-mono">
        <CommandInput
          placeholder="Search commands, bots, macros..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList ref={listRef}>
          <CommandEmpty>
            <span className="font-mono text-xs text-destructive">{"// PROTOCOL NOT FOUND"}</span>
          </CommandEmpty>

          {/* Quick Actions */}
          <CommandGroup heading="ACTIONS">
            {!session?.user && (
              <CommandItem onSelect={() => run(() => signInWithDiscord("command_palette"))}>
                <HugeiconsIcon icon={Login01Icon} className="text-primary" />
                <span>Login</span>
              </CommandItem>
            )}
            {/* Staff only, and a shortcut like the user-menu entry — the route
                loader and every procedure behind it re-check server-side. */}
            {isStaff && (
              <CommandItem
                value="admin staff moderation"
                onSelect={() => run(() => navigate({ to: "/admin" }))}
              >
                <HugeiconsIcon icon={Shield02Icon} className="text-primary" />
                <span>Admin</span>
              </CommandItem>
            )}
            <CommandItem onSelect={() => run(() => openDiscordInvite("command_palette"))}>
              <HugeiconsIcon icon={Share01Icon} className="text-cyan-400" />
              <span>Join Discord</span>
            </CommandItem>
            <CommandItem
              value="settings preferences theme motion notifications privacy blocked account devices sessions"
              onSelect={() => run(() => navigate({ to: "/settings/appearance" }))}
            >
              <HugeiconsIcon icon={Settings02Icon} className="text-muted-foreground" />
              <span>Open Settings</span>
            </CommandItem>
            <CommandItem onSelect={() => run(() => navigate({ to: "/command-center" }))}>
              <HugeiconsIcon icon={ComputerTerminal01Icon} className="text-muted-foreground" />
              <span>Open Command Center</span>
              <CommandShortcut>
                {allBotCommands.length + marcoMacros.length} protocols
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>

          {forumOn ? (
            <CommandGroup heading="FORUM">
              <CommandItem
                value="forum devlogs questions posts"
                onSelect={() => run(() => navigate({ to: "/forum" }))}
              >
                <HugeiconsIcon icon={Comment01Icon} className="text-primary" />
                <span>Open Forum</span>
              </CommandItem>
              {/* Server matches, so each carries the query in its value —
                  cmdk's own filter must not throw away what the server found. */}
              {forumSearchable
                ? (forumPosts?.posts ?? []).map((post) => (
                    <CommandItem
                      key={post.id}
                      value={`forum post ${forumQuery} ${post.id} ${post.title ?? ""}`}
                      onSelect={() =>
                        run(() =>
                          navigate({
                            to: "/forum/$postId",
                            params: { postId: forumPostParam(post) },
                          }),
                        )
                      }
                    >
                      <HugeiconsIcon icon={Comment01Icon} className="text-muted-foreground" />
                      <span className="truncate">{forumPostTitle(post)}</span>
                      <CommandShortcut>{post.kind}</CommandShortcut>
                    </CommandItem>
                  ))
                : null}
              {forumSearchable
                ? (forumTags ?? []).map((tag) => (
                    <CommandItem
                      key={tag.slug}
                      value={`forum tag ${forumQuery} ${tag.slug}`}
                      onSelect={() =>
                        run(() => navigate({ to: "/forum/tags/$tag", params: { tag: tag.slug } }))
                      }
                    >
                      <span className="text-muted-foreground">#</span>
                      <span>{tag.slug}</span>
                      <CommandShortcut>{tag.usageCount}</CommandShortcut>
                    </CommandItem>
                  ))
                : null}
            </CommandGroup>
          ) : null}

          <CommandSeparator />

          {/* Theme Switcher — the mode rides along in `value` so typing
              "light" filters down to the light themes. */}
          {sections.map((section) => (
            <CommandGroup key={section.mode} heading={`THEMES · ${section.label.toUpperCase()}`}>
              {section.themes.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`theme ${section.mode} ${t.name} ${t.description}`}
                  onSelect={() => run(() => setTheme(t.id))}
                >
                  <HugeiconsIcon
                    icon={PaintBrush04Icon}
                    className={t.id === themeId ? "text-primary" : "text-muted-foreground"}
                  />
                  <span>{t.name}</span>
                  {t.id === themeId && <CommandShortcut>active</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          <CommandSeparator />

          {/* Hammer Bot Commands */}
          <CommandGroup heading="HAMMER BOT">
            {hammerCommands.map((cmd) => (
              <CommandItem
                key={cmd.id}
                value={`hammer ${cmd.cmd} ${cmd.description}`}
                onSelect={() => run(() => navigate({ to: "/command-center" }))}
              >
                <HugeiconsIcon icon={LegalHammerIcon} className="text-muted-foreground" />
                <span>{cmd.cmd}</span>
                {cmd.options && (
                  <CommandShortcut>
                    {cmd.options.map((o) => `${o.name}:`).join(" ")}
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          {/* Pencil Bot Commands */}
          <CommandGroup heading="PENCIL BOT">
            {pencilCommands.map((cmd) => (
              <CommandItem
                key={cmd.id}
                value={`pencil ${cmd.cmd} ${cmd.description}`}
                onSelect={() => run(() => navigate({ to: "/command-center" }))}
              >
                <HugeiconsIcon icon={PencilIcon} className="text-muted-foreground" />
                <span>{cmd.cmd}</span>
                {cmd.options && (
                  <CommandShortcut>
                    {cmd.options.map((o) => `${o.name}:`).join(" ")}
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          {/* Marco Macros */}
          <CommandGroup heading="MARCO MACROS">
            {marcoMacros.map((macro) => (
              <CommandItem
                key={macro.name}
                value={`macro ${macro.name} ${macro.aliases.join(" ")}`}
                onSelect={() => run(() => navigate({ to: "/command-center" }))}
              >
                <HugeiconsIcon icon={Robot01Icon} className="text-muted-foreground" />
                <span>[]{macro.name}</span>
                {macro.aliases.length > 0 && (
                  <CommandShortcut>{macro.aliases.slice(0, 2).join(", ")}</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-muted/40 px-3 py-2 font-mono text-[10px] text-muted-foreground/60">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span className="ml-auto">ctrl+k to toggle</span>
        </div>
      </Command>
    </CommandDialog>
  );
}
