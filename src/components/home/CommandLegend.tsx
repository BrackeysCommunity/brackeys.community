import { Badge } from "@/components/ui/badge";
import { Well } from "@/components/ui/well";

/**
 * Legend panel explaining the visual conventions used in the command list —
 * slash prefix, bot tag, required marker, and alias format.
 */
export function CommandLegend() {
  return (
    <Well notchOpts={{ size: 10 }}>
      <div className="mt-1 flex flex-col gap-3 px-4 py-3 font-mono text-[11px] tracking-wider text-muted-foreground">
        <span className="text-[10px] tracking-widest text-muted-foreground/70 uppercase">
          // Legend
        </span>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px] text-brackeys-yellow">
              /slash
            </Badge>
            <span>command name</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="destructive" className="font-mono text-[10px]">
              ◆ required
            </Badge>
            <span>must be supplied</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[10px] uppercase">
              bot
            </Badge>
            <span>which bot owns it</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              [/alias]
            </Badge>
            <span>alternative names</span>
          </div>
        </div>
      </div>
    </Well>
  );
}
