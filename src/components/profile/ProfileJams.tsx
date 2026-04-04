import { cn } from "@/lib/utils";

interface Jam {
  id: number;
  jamName: string;
  jamUrl: string | null;
  submissionTitle: string | null;
  submissionUrl: string | null;
  result: string | null;
  participatedAt: Date | null;
}

interface ProfileJamsProps {
  jams: Jam[];
  className?: string;
}

export function ProfileJams({ jams, className }: ProfileJamsProps) {
  if (jams.length === 0) return null;

  return (
    <div className={cn("relative", className)}>
      <div className="absolute left-[5.5px] top-2 bottom-2 w-px bg-muted/30" />

      <div className="flex flex-col gap-3">
        {jams.map((jam) => (
          <div key={jam.id} className="flex items-start gap-3 relative group">
            <div className="relative z-10 mt-1.5 shrink-0">
              <div className="w-3 h-3 rounded-full border-2 border-muted/50 bg-background group-hover:border-brackeys-yellow/60 group-hover:bg-brackeys-yellow/10 transition-colors" />
            </div>

            <div className="flex-1 min-w-0 pb-0.5">
              <p className="font-mono text-xs font-bold tracking-widest text-foreground uppercase truncate">
                {jam.jamUrl ? (
                  <a
                    href={jam.jamUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary transition-colors"
                  >
                    {jam.jamName}
                  </a>
                ) : (
                  jam.jamName
                )}
              </p>

              {jam.submissionTitle && (
                <p className="font-mono text-[10px] text-muted-foreground/60 truncate mt-0.5">
                  {jam.submissionUrl ? (
                    <a
                      href={jam.submissionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary transition-colors"
                    >
                      {jam.submissionTitle}
                    </a>
                  ) : (
                    jam.submissionTitle
                  )}
                </p>
              )}

              <div className="flex items-center gap-2 mt-1">
                {jam.result && (
                  <span className="font-mono text-[10px] font-bold tracking-widest text-brackeys-yellow uppercase">
                    {jam.result}
                  </span>
                )}
                {jam.participatedAt && (
                  <span className="font-mono text-[10px] text-muted-foreground/40">
                    {new Date(jam.participatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
