import {
  BookOpen01Icon,
  ComputerTerminal01Icon,
  Fire02Icon,
  FlashIcon,
  MortarboardIcon,
  UserAdd01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";

import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

type FeedEventType = "join" | "entry" | "protocol" | "streak" | "mentor" | "squad" | "kb";

interface FeedEvent {
  age: string;
  type: FeedEventType;
  text: React.ReactNode;
}

const ICON_MAP: Record<FeedEventType, IconSvgElement> = {
  join: UserAdd01Icon,
  entry: FlashIcon,
  protocol: ComputerTerminal01Icon,
  streak: Fire02Icon,
  mentor: MortarboardIcon,
  squad: UserGroupIcon,
  kb: BookOpen01Icon,
};

const MOCK_EVENTS: FeedEvent[] = [
  {
    age: "now",
    type: "join",
    text: (
      <>
        <span className="text-foreground">ava.mori</span> joined collab{" "}
        <span className="text-muted-foreground">// UNITY · 3D ART</span>
      </>
    ),
  },
  {
    age: "12s",
    type: "entry",
    text: (
      <>
        New jam entry ✦ <span className="text-foreground">"Cloudbank"</span> by{" "}
        <span className="text-foreground">tangerine</span>
      </>
    ),
  },
  {
    age: "48s",
    type: "protocol",
    text: (
      <>
        <span className="text-foreground">HAMMER</span> deployed 3 new protocols
      </>
    ),
  },
  {
    age: "2m",
    type: "streak",
    text: (
      <>
        <span className="text-foreground">pipewool</span> unlocked STREAK 14 🔥
      </>
    ),
  },
  {
    age: "5m",
    type: "mentor",
    text: (
      <>
        Mentor session opened · shaders w/ <span className="text-foreground">mira.k</span>
      </>
    ),
  },
  {
    age: "8m",
    type: "squad",
    text: (
      <>
        6 devs formed squad in <span className="text-foreground">#find-a-team</span>
      </>
    ),
  },
  {
    age: "14m",
    type: "kb",
    text: (
      <>
        KB updated · <span className="text-foreground">"Softbody physics in Godot 4.4"</span>
      </>
    ),
  },
];

export function LiveFeed({ className }: { className?: string }) {
  return (
    <Well notchOpts={{ size: 16 }} className={cn(className)}>
      <div className="mt-1 flex items-center justify-between border-b border-muted/40 bg-muted/50 px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground uppercase">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
          </span>
          // Live Feed
        </span>
      </div>
      <ul className="flex flex-col">
        {MOCK_EVENTS.map((e, i) => (
          <li
            key={`${e.age}-${i}`}
            className="flex items-center gap-3 border-b border-muted/30 px-4 py-2.5 last:border-b-0"
          >
            <span className="w-8 shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground uppercase tabular-nums">
              {e.age}
            </span>
            <HugeiconsIcon
              icon={ICON_MAP[e.type]}
              size={14}
              className="shrink-0 text-muted-foreground"
            />
            <span className="font-mono text-xs text-muted-foreground">{e.text}</span>
          </li>
        ))}
      </ul>
    </Well>
  );
}
