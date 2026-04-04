import { GridViewIcon, Share01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useCountDown } from "ahooks";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";
import { useMagnetic } from "@/lib/hooks/use-cursor";
import { jamStore, setJamData, setJamError, setJamLoading, setJamView } from "@/lib/jam-store";
import { NOTCH_SIZE, notchClip, notchClipInner } from "@/lib/notch";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";
import { SubmissionsList } from "./SubmissionsList";

// Feb 22, 2026 at 5:00 AM CST = 11:00 AM UTC
const JAM_DEADLINE = new Date("2026-02-22T11:00:00Z");

const deadlineLocalStr = JAM_DEADLINE.toLocaleString(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const springTransition = { type: "spring", stiffness: 1000, damping: 30, mass: 0.1 } as const;

function MagneticFooterLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, position } = useMagnetic(0.1);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      data-cursor-no-drift
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="flex-1"
    >
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    </motion.div>
  );
}

function MagneticFooterButton({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, position } = useMagnetic(0.25);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="flex-1"
    >
      <button type="button" onClick={onClick} className={className}>
        {children}
      </button>
    </motion.div>
  );
}

export function Sidebar() {
  const [, { days, hours, minutes, seconds }] = useCountDown({ targetDate: JAM_DEADLINE });

  const { view, joinedCount, submissionCount, ratingCount, submissions, loading } =
    useStore(jamStore);

  const { data, isLoading, isError } = useQuery({
    ...orpc.getJamData.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  useEffect(() => {
    setJamLoading(isLoading);
  }, [isLoading]);

  useEffect(() => {
    if (data) {
      setJamData(data);
    }
  }, [data]);

  useEffect(() => {
    if (isError) {
      setJamError("Failed to load jam data");
    }
  }, [isError]);

  const isDeadlinePassed = Date.now() >= JAM_DEADLINE.getTime();

  useEffect(() => {
    if (isDeadlinePassed) {
      setJamView("submissions");
    }
  }, [isDeadlinePassed]);

  const countdownStr =
    days > 0
      ? `${days}D ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const isSubmissionsView = view === "submissions";

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        className="w-full h-full max-h-[min(800px,calc(100vh-120px))] bg-muted/60 pointer-events-auto"
        style={{ clipPath: notchClip, padding: "2px" }}
      >
        <div
          className="flex flex-col w-full h-full bg-background/90 backdrop-blur-md relative"
          style={{ clipPath: notchClipInner }}
        >
          {/* Corner decorators */}
          <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-brackeys-yellow/50 pointer-events-none" />
          <span className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-brackeys-yellow/50 pointer-events-none" />
          {/* Top-right notch accent */}
          <svg
            aria-hidden="true"
            className="absolute top-0 right-0 pointer-events-none text-brackeys-yellow/40"
            width={NOTCH_SIZE + 2}
            height={NOTCH_SIZE + 2}
            viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
            fill="none"
          >
            <line
              x1="0"
              y1="1"
              x2={NOTCH_SIZE + 1}
              y2={NOTCH_SIZE + 2}
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
          {/* Bottom-left notch accent */}
          <svg
            aria-hidden="true"
            className="absolute bottom-0 left-0 pointer-events-none text-brackeys-yellow/40"
            width={NOTCH_SIZE + 2}
            height={NOTCH_SIZE + 2}
            viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
            fill="none"
          >
            <line
              x1={NOTCH_SIZE + 1}
              y1={NOTCH_SIZE + 1}
              x2="0"
              y2="0"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>

          {/* Card header */}
          <div className="flex items-center justify-between border-b border-muted/60 bg-card/40 px-4 py-2.5">
            <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
              2026.1
            </span>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
              </span>
              <span className="animate-pulse font-mono text-xs font-bold tracking-widest text-destructive">
                LIVE JAM
              </span>
            </div>
          </div>

          {/* Deadline info */}
          <div className="flex flex-col items-center gap-1.5 px-5 py-5 text-center justify-center border-b border-muted/60">
            {isDeadlinePassed ? (
              <>
                <h3 className="font-mono text-sm tracking-[0.2em] text-muted-foreground uppercase">
                  {"// Deadline"}
                </h3>
                <p className="font-mono text-4xl font-bold text-muted-foreground tabular-nums tracking-tight">
                  JAM ENDED
                </p>
                <p className="font-mono text-md text-muted-foreground/40 mt-0.5">
                  {deadlineLocalStr}
                </p>
              </>
            ) : (
              <>
                <h3 className="font-mono text-sm tracking-[0.2em] text-destructive uppercase">
                  {"// Deadline"}
                </h3>
                <p className="font-mono text-6xl font-bold text-foreground tabular-nums tracking-tight">
                  {countdownStr}
                </p>
                <p className="font-mono text-md tracking-[0.2em] text-muted-foreground uppercase">
                  Remaining
                </p>
                <p className="font-mono text-md text-muted-foreground/40 mt-0.5">
                  {deadlineLocalStr}
                </p>
              </>
            )}
          </div>

          {/* Jam stats */}
          <div className="grid grid-cols-2 divide-x divide-muted/60 border-b border-muted/60">
            <div className="flex flex-col items-center py-3 px-2 gap-0.5">
              <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
                {isDeadlinePassed ? "Ratings" : "Joined"}
              </span>
              <span
                className={cn(
                  "font-mono text-xl font-bold tabular-nums tracking-tight text-brackeys-yellow transition-opacity duration-300",
                  loading && "opacity-40 animate-pulse",
                )}
              >
                {(isDeadlinePassed ? ratingCount : joinedCount) ?? "—"}
              </span>
            </div>
            <div className="flex flex-col items-center py-3 px-2 gap-0.5">
              <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
                Entries
              </span>
              <span
                className={cn(
                  "font-mono text-xl font-bold tabular-nums tracking-tight text-brackeys-yellow transition-opacity duration-300",
                  loading && "opacity-40 animate-pulse",
                )}
              >
                {submissionCount ?? "—"}
              </span>
            </div>
          </div>

          {/* Main content: jam image or submissions list */}
          <div className="flex-1 relative overflow-hidden">
            {isSubmissionsView ? (
              <SubmissionsList entries={submissions} />
            ) : (
              <>
                <div className="p-5 flex items-center justify-center h-full">
                  <img
                    alt="Strange Places theme art"
                    className="max-w-3xl w-full m-auto object-cover object-top grayscale transition-all duration-500 hover:grayscale-0"
                    src="https://img.itch.zone/aW1nLzI1NTk5ODA3LnBuZw==/original/vYJgdy.png"
                  />
                </div>
                <div
                  className="absolute inset-0 pointer-events-none opacity-20 animate-scanlines"
                  style={{
                    background:
                      "linear-gradient(to bottom, rgba(255,255,255,0) 50%, rgba(0,0,0,0.4) 50%)",
                    backgroundSize: "100% 4px",
                  }}
                />
              </>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-muted/60 bg-card/30 px-6 py-4 flex gap-8">
            <MagneticFooterLink
              href="https://discord.gg/brackeys"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "w-full border-brackeys-yellow/40 text-brackeys-yellow hover:bg-brackeys-yellow/10 hover:border-brackeys-yellow font-mono text-[10px] font-bold tracking-widest uppercase justify-between",
              )}
            >
              Discord
              <HugeiconsIcon icon={Share01Icon} size={13} />
            </MagneticFooterLink>

            {!isDeadlinePassed && (
              <MagneticFooterButton
                onClick={() => setJamView(isSubmissionsView ? "jam" : "submissions")}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "w-full font-mono text-[10px] font-bold tracking-widest uppercase justify-between transition-colors duration-150",
                  isSubmissionsView
                    ? "border-brackeys-yellow/80 text-brackeys-yellow bg-brackeys-yellow/10 hover:bg-brackeys-yellow/20"
                    : "border-brackeys-yellow/40 text-brackeys-yellow hover:bg-brackeys-yellow/10 hover:border-brackeys-yellow",
                )}
              >
                {isSubmissionsView ? "Jam Info" : "Entries"}
                <HugeiconsIcon icon={GridViewIcon} size={13} />
              </MagneticFooterButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
