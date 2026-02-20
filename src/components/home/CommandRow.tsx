import { useState } from 'react';
import { Copy01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Button } from '@/components/ui/button';
import type { BotCommand } from '@/data/commands';

interface CommandRowProps {
  command: BotCommand;
}

const botBadgeStyles: Record<string, string> = {
  hammer: 'text-cyan-400 border-cyan-400/40 bg-cyan-950/20',
  pencil: 'text-violet-400 border-violet-400/40 bg-violet-950/20',
};

export function CommandRow({ command }: CommandRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command.usage ?? command.cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group flex flex-col md:flex-row md:items-start justify-between p-6 hover:bg-card/50 transition-colors gap-4">
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <code className="text-brackeys-yellow font-mono text-lg font-bold bg-brackeys-yellow-muted/20 px-2 py-0.5 border border-brackeys-yellow/30">
            {command.cmd}
          </code>
          <span
            className={`text-xs font-mono border px-1.5 py-0.5 uppercase ${botBadgeStyles[command.bot]}`}
          >
            {command.bot}
          </span>
        </div>

        <p className="text-[#cccccc] text-sm md:text-base leading-relaxed font-sans max-w-2xl">
          {command.description}
        </p>

        {command.params && (
          <div className="text-xs font-mono text-muted-foreground">
            <span className="text-primary">PARAMS:</span> {command.params}
          </div>
        )}

        {command.usage && (
          <div className="text-xs font-mono text-muted-foreground">
            <span className="text-primary">USAGE:</span> {command.usage}
          </div>
        )}
      </div>

      <Button
        variant="outline"
        isMagnetic
        onClick={handleCopy}
        className="flex items-center gap-2 px-3 py-2 bg-black border border-muted hover:border-primary text-muted-foreground hover:text-white transition-all group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:shadow-[2px_2px_0px_var(--color-primary)] active:translate-x-0 active:translate-y-0 active:shadow-none self-start md:self-center shrink-0 relative z-10"
      >
        <HugeiconsIcon icon={Copy01Icon} size={16} />
        <span className="font-mono text-xs font-bold uppercase">
          {copied ? 'Copied!' : 'Copy'}
        </span>
      </Button>
    </div>
  );
}
