import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useDebounceFn } from "ahooks";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useState } from "react";

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
      className={`relative flex list-none flex-col px-5 py-3 transition-all duration-200 ${
        expanded
          ? "z-20 -translate-y-px border-x border-primary/40 bg-card/80 shadow-[0_6px_24px_rgba(0,0,0,0.6)]"
          : "z-0"
      }`}
    >
      {/* Name + aliases + copy button row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <code
            className={`shrink-0 self-start border px-2 py-0.5 font-mono text-sm font-bold transition-colors duration-150 ${
              expanded
                ? "border-brackeys-yellow/60 bg-brackeys-yellow-muted/20 text-brackeys-yellow"
                : "border-brackeys-yellow/30 bg-brackeys-yellow-muted/20 text-brackeys-yellow"
            }`}
          >
            []{macro.name}
          </code>

          {macro.aliases.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {macro.aliases.map((alias) => (
                <span
                  key={alias}
                  className="border border-muted/40 bg-card/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
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
          className={`flex shrink-0 items-center gap-1.5 border bg-black px-2 py-1 font-mono text-[10px] font-bold text-muted-foreground uppercase transition-all duration-150 hover:text-white ${
            expanded
              ? "border-primary/40 opacity-100 hover:border-primary"
              : "border-muted opacity-0 hover:border-primary"
          }`}
        >
          <HugeiconsIcon icon={Copy01Icon} size={12} />
          {copied ? "OK!" : "Copy"}
        </button>
      </div>

      {/* Expandable description */}
      <div
        className={`overflow-hidden transition-all duration-250 ease-out ${
          expanded ? "mt-2.5 max-h-48 opacity-100" : "mt-0 max-h-0 opacity-0"
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
          <p className="pr-1 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {macro.description}
          </p>
        </OverlayScrollbarsComponent>
      </div>
    </li>
  );
}
