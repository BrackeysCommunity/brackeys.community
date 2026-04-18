import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-store";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { BotCommand } from "@/data/commands";
import { activeUserStore } from "@/lib/active-user-store";

interface CommandRowProps {
  command: BotCommand;
}

const botBadgeStyles: Record<string, string> = {
  hammer: "text-cyan-400 border-cyan-400/40 bg-cyan-950/20",
  pencil: "text-violet-400 border-violet-400/40 bg-violet-950/20",
};

/** Build the Discord slash-command string: `/cmd opt1: opt2:` */
export function buildCopyText(command: BotCommand, username?: string): string {
  if (!command.options?.length) return command.cmd;
  const opts = command.options
    .filter((o) => username || !["mention", "user"].includes(o.name))
    .map((o) =>
      ["mention", "user"].includes(o.name) && username
        ? `${o.name}:@${username}`
        : `${o.name}:${o.default}`,
    )
    .join(" ");
  return opts ? `${command.cmd} ${opts}` : command.cmd;
}

export function CommandRow({ command }: CommandRowProps) {
  const user = useStore(activeUserStore);
  const username = user.profile?.discordUsername ?? undefined;
  console.log(buildCopyText(command, username ?? undefined));
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(buildCopyText(command, username ?? undefined));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group flex flex-col justify-between gap-4 p-6 transition-colors hover:bg-card/50 md:flex-row md:items-start">
      <div className="flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <code className="border border-brackeys-yellow/30 bg-brackeys-yellow-muted/20 px-2 py-0.5 font-mono text-lg font-bold text-brackeys-yellow">
            {command.cmd}
          </code>
          <span
            className={`border px-1.5 py-0.5 font-mono text-xs uppercase ${botBadgeStyles[command.bot]}`}
          >
            {command.bot}
          </span>
        </div>

        <p className="max-w-2xl font-sans text-sm leading-relaxed text-[#cccccc] md:text-base">
          {command.description}
        </p>

        {command.options && command.options.length > 0 && (
          <div className="space-y-1">
            {command.options
              .filter((opt) => username || opt.name !== "mention")
              .map((opt) => (
                <div
                  key={opt.name}
                  className="flex items-center gap-2 font-mono text-xs text-muted-foreground"
                >
                  <span className="text-primary">{opt.name}:</span>
                  <span>{opt.description}</span>
                  {opt.required && (
                    <span className="text-[10px] tracking-wider text-destructive/70 uppercase">
                      required
                    </span>
                  )}
                </div>
              ))}
          </div>
        )}

        <div className="font-mono text-xs text-muted-foreground">
          <span className="text-primary">EXAMPLE:</span>{" "}
          <span className="text-brackeys-yellow/80">{buildCopyText(command, username)}</span>
        </div>
      </div>

      <Button
        variant="outline"
        isMagnetic
        onClick={handleCopy}
        className="relative z-10 flex shrink-0 items-center gap-2 self-start border border-muted bg-black px-3 py-2 text-muted-foreground transition-all group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:shadow-[2px_2px_0px_var(--color-primary)] hover:border-primary hover:text-white active:translate-x-0 active:translate-y-0 active:shadow-none md:self-center"
      >
        <HugeiconsIcon icon={Copy01Icon} size={16} />
        <span className="font-mono text-xs font-bold uppercase">{copied ? "Copied!" : "Copy"}</span>
      </Button>
    </div>
  );
}
