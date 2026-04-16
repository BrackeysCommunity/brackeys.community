import {
  ComputerTerminal01Icon,
  LegalHammerIcon,
  Login01Icon,
  PaintBrush04Icon,
  PencilIcon,
  Robot01Icon,
  Share01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import { useKeyPress } from "ahooks";

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
import { allBotCommands, hammerCommands, marcoMacros, pencilCommands } from "@/data/commands";
import { authClient } from "@/lib/auth-client";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const navigate = useNavigate();
  const { themeId, setTheme, themes } = useAppTheme();

  useKeyPress(
    ["ctrl.k", "meta.k"],
    (e) => {
      e.preventDefault();
      setOpen((prev) => !prev);
    },
    { exactMatch: true },
  );

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
        <CommandInput placeholder="Search commands, bots, macros..." />
        <CommandList>
          <CommandEmpty>
            <span className="font-mono text-xs text-destructive">{"// PROTOCOL NOT FOUND"}</span>
          </CommandEmpty>

          {/* Quick Actions */}
          <CommandGroup heading="ACTIONS">
            <CommandItem
              onSelect={() => run(() => authClient.signIn.social({ provider: "discord" }))}
            >
              <HugeiconsIcon icon={Login01Icon} className="text-primary" />
              <span>Login</span>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() =>
                  window.open("https://discord.gg/brackeys", "_blank", "noopener,noreferrer"),
                )
              }
            >
              <HugeiconsIcon icon={Share01Icon} className="text-cyan-400" />
              <span>Join Discord</span>
            </CommandItem>
            <CommandItem onSelect={() => run(() => navigate({ to: "/command-center" }))}>
              <HugeiconsIcon icon={ComputerTerminal01Icon} className="text-muted-foreground" />
              <span>Open Command Center</span>
              <CommandShortcut>
                {allBotCommands.length + marcoMacros.length} protocols
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* Theme Switcher */}
          <CommandGroup heading="THEMES">
            {themes.map((t) => (
              <CommandItem
                key={t.id}
                value={`theme ${t.name} ${t.description}`}
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
