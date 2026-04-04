import { useState } from "react";
import { useDebounceFn } from "ahooks";
import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { Macro } from "@/data/commands";

interface MacroRowProps {
  macro: Macro;
}

export function MacroRow({ macro }: MacroRowProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { run: scheduleExpand, cancel: cancelExpand } = useDebounceFn(() => setExpanded(true), {
    wait: 140,
  });

  const handleMouseEnter = () => scheduleExpand();
  const handleMouseLeave = () => {
    cancelExpand();
    setExpanded(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(`/macro name:${macro.name}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <li
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative flex flex-col list-none px-5 py-3 transition-all duration-200 ${
        expanded
          ? "bg-card/80 border-x border-primary/40 shadow-[0_6px_24px_rgba(0,0,0,0.6)] -translate-y-px z-20"
          : "z-0"
      }`}
    >
      {/* Name + aliases + copy button row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 min-w-0">
          <code
            className={`font-mono text-sm font-bold px-2 py-0.5 border shrink-0 self-start transition-colors duration-150 ${
              expanded
                ? "text-brackeys-yellow border-brackeys-yellow/60 bg-brackeys-yellow-muted/20"
                : "text-brackeys-yellow bg-brackeys-yellow-muted/20 border-brackeys-yellow/30"
            }`}
          >
            []{macro.name}
          </code>

          {macro.aliases.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {macro.aliases.map((alias) => (
                <span
                  key={alias}
                  className="text-[10px] font-mono text-muted-foreground border border-muted/40 px-1.5 py-0.5 bg-card/30"
                >
                  []{alias}
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className={`flex items-center gap-1.5 px-2 py-1 bg-black border text-muted-foreground hover:text-white transition-all duration-150 shrink-0 font-mono text-[10px] font-bold uppercase ${
            expanded
              ? "opacity-100 border-primary/40 hover:border-primary"
              : "opacity-0 border-muted hover:border-primary"
          }`}
        >
          <HugeiconsIcon icon={Copy01Icon} size={12} />
          {copied ? "OK!" : "Copy"}
        </button>
      </div>

      {/* Expandable description */}
      <div
        className={`overflow-hidden transition-all duration-250 ease-out ${
          expanded ? "max-h-48 opacity-100 mt-2.5" : "max-h-0 opacity-0 mt-0"
        }`}
      >
        <OverlayScrollbarsComponent
          element="div"
          className="max-h-40"
          options={{
            scrollbars: {
              theme: "os-theme-dark",
              autoHide: "scroll",
              autoHideDelay: 600,
            },
          }}
          defer
        >
          <p className="text-xs font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap pr-1">
            {macro.description}
          </p>
        </OverlayScrollbarsComponent>
      </div>
    </li>
  );
}
