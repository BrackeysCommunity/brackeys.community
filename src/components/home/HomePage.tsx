import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  IdentityCardIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

import { CyclingWord } from "@/components/home/CyclingWord";
import { HeroWordmark } from "@/components/home/HeroWordmark";
import { JamsLandingSection } from "@/components/home/JamsLandingSection";
import { NewestSignups } from "@/components/home/NewestSignups";
import {
  NodeCard,
  NodeCardCommandList,
  NodeCardSparkline,
  NodeCardTagRow,
} from "@/components/home/NodeCard";
import { RecentCollabPosts } from "@/components/home/RecentCollabPosts";
import { SectionRule } from "@/components/home/SectionRule";

const NODE_TAGS = ["UNITY", "GODOT", "PIXEL ART", "MUSIC", "SHADERS", "3D ART", "UX"];
const NODE_COMMANDS = ["rule", "userinfo", "color", "tex"];
const SPARKLINE = [45, 30, 25, 55, 80, 40, 70, 90, 50, 85, 95, 75];
const JAM_CALENDAR_HEIGHTS = [40, 55, 70, 50, 65, 80, 60, 75, 50, 70, 85, 60];

export function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-16">
      {/* Hero block */}
      <div className="flex flex-col items-start gap-6">
        <div className="mt-8 lg:mt-12">
          <HeroWordmark primary={<CyclingWord />} secondary="GAMES" />
        </div>

        <p className="max-w-xl font-sans text-sm text-foreground [text-shadow:0_1px_3px_rgba(0,0,0,0.75)] lg:text-base">
          The central neural network for the Brackeys game dev community. Find your squad, browse
          every jam on itch, and deploy your build with a crew that ships.
        </p>
      </div>

      {/* Enter Node */}
      <div className="flex flex-col gap-4">
        <SectionRule label="Enter Node" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <NodeCard
            index="01"
            title={"COLLAB\nBOARD"}
            icon={UserGroupIcon}
            to="/collab"
            stat="312"
            statLabel="Open Roles"
            middle={<NodeCardTagRow tags={NODE_TAGS} />}
          />
          <NodeCard
            index="02"
            title={"JAM\nCALENDAR"}
            icon={Calendar03Icon}
            // TODO: wire to /jams route when it exists
            to="/"
            stat="50+"
            statLabel="Openings"
            middle={<NodeCardSparkline heights={JAM_CALENDAR_HEIGHTS} />}
          />
          <NodeCard
            index="03"
            title={"COMMAND\nCENTER"}
            icon={ComputerTerminal01Icon}
            to="/command-center"
            stat="58"
            statLabel="Protocols"
            middle={<NodeCardCommandList commands={NODE_COMMANDS} />}
          />
          <NodeCard
            index="04"
            title={"DEV\nPROFILE"}
            icon={IdentityCardIcon}
            to="/profile"
            stat="LV 14"
            statLabel="joshe.dev"
            middle={<NodeCardSparkline heights={SPARKLINE} />}
          />
        </div>
      </div>

      <JamsLandingSection />
      <RecentCollabPosts />
      <NewestSignups />
    </div>
  );
}
