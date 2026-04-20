import {
  ComputerTerminal01Icon,
  IdentityCardIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { Variants } from "framer-motion";
import { motion } from "framer-motion";

import { CyclingWord } from "@/components/home/CyclingWord";
import { HeroWordmark } from "@/components/home/HeroWordmark";
import { JamPanel } from "@/components/home/JamPanel";
import { LiveFeed } from "@/components/home/LiveFeed";
import {
  NodeCard,
  NodeCardCommandList,
  NodeCardSparkline,
  NodeCardTagRow,
} from "@/components/home/NodeCard";
import { SectionRule } from "@/components/home/SectionRule";
import { OnlinePulse, StatCell, StatStrip } from "@/components/home/StatStrip";
import { SystemStatusBar } from "@/components/home/SystemStatusBar";
import { GlitchTransition } from "@/components/ui/glitch-transition";

// TODO: replace with real data
const MOCK_STATS = {
  onlineNow: "2,148",
  protocols: "58",
  entrants: "31.7K",
  botsActive: "6",
};

const NODE_TAGS = ["UNITY", "GODOT", "PIXEL ART", "MUSIC", "SHADERS", "3D ART", "UX"];
const NODE_COMMANDS = ["rule", "userinfo", "color", "tex"];
const SPARKLINE = [45, 30, 25, 55, 80, 40, 70, 90, 50, 85, 95, 75];

// TODO: wire to real feature flag when live-feed backend is ready
const SHOW_LIVE_FEED = false;

const container: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.25 },
  },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};

const fadeLeft: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
};

const cardRow: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

export function HomePage() {
  return (
    <GlitchTransition
      trigger="mount"
      duration={0.7}
      intensity={0.7}
      flicker
      style={{ width: "100%" }}
    >
      <motion.div
        className="flex flex-col gap-8 lg:gap-10"
        variants={container}
        initial="hidden"
        animate="visible"
      >
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:gap-10">
          {/* LEFT: hero + nav cards + stats */}
          <div className="flex flex-col gap-8">
            {/* Hero */}
            <div className="flex flex-col">
              <motion.div variants={fadeUp}>
                <SystemStatusBar />
              </motion.div>
              <motion.div variants={fadeUp} className="mt-20 lg:mt-28">
                <HeroWordmark primary={<CyclingWord />} secondary="GAMES" />
              </motion.div>
              <motion.p
                variants={fadeUp}
                className="mt-6 max-w-xl font-sans text-base text-foreground [text-shadow:0_1px_3px_rgba(0,0,0,0.75)] lg:text-lg"
              >
                The central neural network for the Brackeys game dev community. Find your squad,
                search the knowledge base, and deploy your build with a crew that ships.
              </motion.p>
            </div>

            <motion.div variants={fadeUp}>
              <SectionRule label="Enter Node" />
            </motion.div>

            {/* Node cards — staggered in as a row */}
            <motion.div className="grid grid-cols-1 gap-4 md:grid-cols-3" variants={cardRow}>
              <motion.div variants={fadeUp}>
                <NodeCard
                  index="01"
                  title={"COLLAB\nBOARD"}
                  icon={UserGroupIcon}
                  to="/collab"
                  stat="312"
                  statLabel="Open Roles"
                  middle={<NodeCardTagRow tags={NODE_TAGS} />}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <NodeCard
                  index="02"
                  title={"COMMAND\nCENTER"}
                  icon={ComputerTerminal01Icon}
                  to="/command-center"
                  stat="58"
                  statLabel="Protocols"
                  middle={<NodeCardCommandList commands={NODE_COMMANDS} />}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <NodeCard
                  index="03"
                  title={"DEV\nPROFILE"}
                  icon={IdentityCardIcon}
                  to="/profile"
                  stat="LV 14"
                  statLabel="joshe.dev"
                  middle={<NodeCardSparkline heights={SPARKLINE} />}
                />
              </motion.div>
            </motion.div>

            <motion.div variants={fadeUp}>
              <StatStrip>
                <StatCell
                  value={MOCK_STATS.onlineNow}
                  label="Online Now"
                  accent={<OnlinePulse />}
                />
                <StatCell value={MOCK_STATS.protocols} label="Protocols" />
                <StatCell value={MOCK_STATS.entrants} label="Entrants (2026.1)" />
                <StatCell value={MOCK_STATS.botsActive} label="Bots Active" />
              </StatStrip>
            </motion.div>
          </div>

          {/* RIGHT: jam panel + (optional) live feed */}
          <div className="flex flex-col gap-6">
            <motion.div
              variants={fadeLeft}
              className={SHOW_LIVE_FEED ? undefined : "flex flex-1 [&>*]:flex-1"}
            >
              <JamPanel />
            </motion.div>
            {SHOW_LIVE_FEED && (
              <motion.div variants={fadeLeft}>
                <LiveFeed />
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>
    </GlitchTransition>
  );
}
