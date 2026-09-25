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
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useMemo } from "react";

import { openDiscordInvite } from "@/components/ui/discord-invite-link";
import {
  allBotCommands,
  hammerCommands,
  marcoMacros,
  pencilCommands,
  type BotCommand,
  type Macro,
} from "@/data/commands";
import { activeUserStore } from "@/lib/active-user-store";
import { authClient, signInWithDiscord } from "@/lib/auth-client";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import type { Theme } from "@/lib/themes";

type Icon = typeof Login01Icon;

/** What the preview pane shows for a local command. */
export type PaletteDetail =
  | { type: "action"; description: string }
  | { type: "theme"; theme: Theme; mode: string; active: boolean }
  | { type: "bot"; command: BotCommand }
  | { type: "macro"; macro: Macro }
  | { type: "tag"; slug: string; name: string; usageCount: number }
  | { type: "recent-search"; query: string };

export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra words it answers to; matched along with the label. */
  keywords?: string;
  icon: Icon;
  iconClassName?: string;
  shortcut?: string;
  /** Leave the palette open after running, so the next one can be tried. */
  keepOpen?: boolean;
  detail: PaletteDetail;
  perform: () => void;
}

export interface PaletteCommandGroup {
  heading: string;
  /** `cards` lays the group out as a two-column grid of theme cards. */
  layout?: "cards";
  commands: PaletteCommand[];
}

/**
 * The palette's local commands, grouped. They're filtered on the client so
 * they answer on the first keystroke, while site search waits for the
 * server.
 */
export function usePaletteCommands(forumOn: boolean): {
  actions: PaletteCommandGroup;
  rest: PaletteCommandGroup[];
} {
  const navigate = useNavigate();
  const { themeId, setTheme, sections } = useAppTheme();
  const { data: session } = authClient.useSession();
  const isStaff = useStore(activeUserStore, (s) => s.profile?.isStaff ?? false);
  const signedIn = session?.user != null;

  return useMemo(() => {
    const toCommandCenter = () => void navigate({ to: "/command-center" });

    const actions: PaletteCommand[] = [
      ...(signedIn
        ? []
        : [
            {
              id: "login",
              label: "Login",
              keywords: "sign in discord",
              icon: Login01Icon,
              iconClassName: "text-primary",
              detail: {
                type: "action" as const,
                description: "Sign in with Discord to post, join teams and follow jams.",
              },
              perform: () => signInWithDiscord("command_palette"),
            },
          ]),
      // Staff only, and a shortcut like the user-menu entry — the route
      // loader and every procedure behind it re-check server-side.
      ...(isStaff
        ? [
            {
              id: "admin",
              label: "Admin",
              keywords: "staff moderation",
              icon: Shield02Icon,
              iconClassName: "text-primary",
              detail: {
                type: "action" as const,
                description: "The staff dashboard: reports, flags and moderation queues.",
              },
              perform: () => void navigate({ to: "/admin" }),
            },
          ]
        : []),
      {
        id: "discord",
        label: "Join Discord",
        icon: Share01Icon,
        iconClassName: "text-cyan-400",
        detail: {
          type: "action",
          description: "Open an invite to the Brackeys Discord server.",
        },
        perform: () => openDiscordInvite("command_palette"),
      },
      {
        id: "settings",
        label: "Open Settings",
        keywords: "preferences theme motion notifications privacy blocked account devices sessions",
        icon: Settings02Icon,
        iconClassName: "text-muted-foreground",
        detail: {
          type: "action",
          description:
            "Theme, motion, notifications, privacy, blocked members, and your signed-in devices.",
        },
        perform: () => void navigate({ to: "/settings/appearance" }),
      },
      {
        id: "command-center",
        label: "Open Command Center",
        icon: ComputerTerminal01Icon,
        iconClassName: "text-muted-foreground",
        shortcut: `${allBotCommands.length + marcoMacros.length} protocols`,
        detail: {
          type: "action",
          description: "Every Hammer and Pencil command and Marco macro, with examples to copy.",
        },
        perform: toCommandCenter,
      },
      ...(forumOn
        ? [
            {
              id: "forum",
              label: "Open Forum",
              keywords: "devlogs questions posts",
              icon: Comment01Icon,
              iconClassName: "text-primary",
              detail: {
                type: "action" as const,
                description: "Devlogs, questions and posts from the community.",
              },
              perform: () => void navigate({ to: "/forum" }),
            },
          ]
        : []),
    ];

    const themes = sections.map((section) => ({
      heading: `THEMES · ${section.label.toUpperCase()}`,
      layout: "cards" as const,
      commands: section.themes.map((t) => ({
        id: `theme-${t.id}`,
        label: t.name,
        // The mode rides along so typing "light" filters down to the light themes.
        keywords: `theme ${section.mode} ${t.description}`,
        icon: PaintBrush04Icon,
        iconClassName: t.id === themeId ? "text-primary" : "text-muted-foreground",
        shortcut: t.id === themeId ? "active" : undefined,
        detail: { type: "theme" as const, theme: t, mode: section.label, active: t.id === themeId },
        keepOpen: true,
        perform: () => setTheme(t.id),
      })),
    }));

    const bot = (prefix: string, icon: Icon, list: typeof hammerCommands) =>
      list.map((cmd) => ({
        id: `${prefix}-${cmd.id}`,
        label: cmd.cmd,
        keywords: `${prefix} ${cmd.description}`,
        icon,
        iconClassName: "text-muted-foreground",
        shortcut: cmd.options?.map((o) => `${o.name}:`).join(" "),
        detail: { type: "bot" as const, command: cmd },
        perform: toCommandCenter,
      }));

    return {
      actions: { heading: "ACTIONS", commands: actions },
      rest: [
        ...themes,
        { heading: "HAMMER BOT", commands: bot("hammer", LegalHammerIcon, hammerCommands) },
        { heading: "PENCIL BOT", commands: bot("pencil", PencilIcon, pencilCommands) },
        {
          heading: "MARCO MACROS",
          commands: marcoMacros.map((macro) => ({
            id: `macro-${macro.name}`,
            label: `[]${macro.name}`,
            keywords: `macro ${macro.name} ${macro.aliases.join(" ")}`,
            icon: Robot01Icon,
            iconClassName: "text-muted-foreground",
            shortcut: macro.aliases.slice(0, 2).join(", ") || undefined,
            detail: { type: "macro" as const, macro },
            perform: toCommandCenter,
          })),
        },
      ],
    };
  }, [navigate, signedIn, isStaff, forumOn, themeId, setTheme, sections]);
}

/** The commands in `group` that match `query`, best first; all of them for an empty query. */
export function filterCommands(group: PaletteCommandGroup, query: string): PaletteCommandGroup {
  const indexed = group.commands.map((command) => ({
    command,
    name: `${command.label} ${command.keywords ?? ""}`,
  }));
  return {
    ...group,
    commands: fuzzyFilter(indexed, query).map((entry) => entry.command),
  };
}
