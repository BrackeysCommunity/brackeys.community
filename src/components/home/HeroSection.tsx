import {
  ComputerTerminal01Icon,
  IdentityCardIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

import { useMagnetic } from "@/lib/hooks/use-cursor";

import { CyclingWord } from "./CyclingWord";

const springTransition = { type: "spring", stiffness: 1000, damping: 30, mass: 0.1 } as const;

interface NavItem {
  id: string;
  label: string;
  icon: IconSvgElement;
  to: string;
}

function NavCard({ item }: { item: NavItem }) {
  const { ref, position } = useMagnetic(0.1);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      data-cursor-no-drift
      data-cursor-corner-size="lg"
      data-cursor-padding-x="24"
      data-cursor-padding-y="24"
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="pointer-events-auto relative z-10 w-full sm:w-auto"
    >
      <Link
        to={item.to}
        className="group flex h-24 w-full min-w-[200px] flex-col justify-between border-2 border-muted bg-card p-4 transition-all duration-100 hover:-translate-y-1 hover:border-primary hover:bg-background hover:shadow-[4px_4px_0px_var(--color-primary)] active:translate-y-0 active:shadow-none"
      >
        <div className="flex justify-between">
          <span className="font-mono text-xs text-muted-foreground group-hover:text-primary">
            {item.id}
          </span>
          <HugeiconsIcon
            icon={item.icon}
            size={20}
            className="text-muted-foreground group-hover:text-primary"
          />
        </div>
        <div className="font-mono text-2xl leading-none font-bold tracking-tight whitespace-pre-line text-foreground group-hover:text-primary">
          {item.label}
        </div>
      </Link>
    </motion.div>
  );
}

const NAV_ITEMS = [
  { id: "01", label: "COLLAB\nBOARD", icon: UserGroupIcon, to: "/collab" },
  { id: "02", label: "COMMAND\nCENTER", icon: ComputerTerminal01Icon, to: "/command-center" },
  { id: "03", label: "DEV\nPROFILE", icon: IdentityCardIcon, to: "/profile" },
];

export function HeroSection() {
  return (
    <div className="flex h-full w-full flex-col justify-center">
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{">"}</span>
        {"SYSTEM READY"}
        <span className="mx-2 text-primary">{"//"}</span>
        {`v${__APP_VERSION__}`}
        <span className="mx-2 text-primary">{"//"}</span>
        {"WELCOME USER"}
      </div>

      <div className="flex flex-col justify-center">
        <h1 className="font-mono text-[clamp(2.5rem,5.5vw,7rem)] leading-[0.85] font-bold tracking-tighter text-foreground">
          <CyclingWord />
          <br />
          <span className="text-transparent transition-colors duration-300 [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary">
            GAMES.
          </span>
        </h1>
        <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl">
          The central neural network for the Brackeys Game Dev community. Find your squad, access
          the knowledge base, and deploy your build.
        </p>
      </div>

      <nav className="my-6 flex flex-col gap-4 sm:mt-12 sm:flex-row sm:flex-wrap sm:items-end">
        {NAV_ITEMS.map((item) => (
          <NavCard key={item.id} item={item} />
        ))}
      </nav>
    </div>
  );
}
