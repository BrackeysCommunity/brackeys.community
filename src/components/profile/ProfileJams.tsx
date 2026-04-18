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
      <div className="absolute top-2 bottom-2 left-[5.5px] w-px bg-muted/30" />

      <div className="flex flex-col gap-3">
        {jams.map((jam) => (
          <div key={jam.id} className="group relative flex items-start gap-3">
            <div className="relative z-10 mt-1.5 shrink-0">
              <div className="h-3 w-3 rounded-full border-2 border-muted/50 bg-background transition-colors group-hover:border-brackeys-yellow/60 group-hover:bg-brackeys-yellow/10" />
            </div>

            <div className="min-w-0 flex-1 pb-0.5">
              <p className="truncate font-mono text-xs font-bold tracking-widest text-foreground uppercase">
                {jam.jamUrl ? (
                  <a
                    href={jam.jamUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-primary"
                  >
                    {jam.jamName}
                  </a>
                ) : (
                  jam.jamName
                )}
              </p>

              {jam.submissionTitle && (
                <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/60">
                  {jam.submissionUrl ? (
                    <a
                      href={jam.submissionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-colors hover:text-primary"
                    >
                      {jam.submissionTitle}
                    </a>
                  ) : (
                    jam.submissionTitle
                  )}
                </p>
              )}

              <div className="mt-1 flex items-center gap-2">
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
