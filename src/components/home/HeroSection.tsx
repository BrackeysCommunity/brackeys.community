import { ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';
import { Suspense, useState } from 'react';
import { cn } from '../../lib/utils';
import { useActiveUser } from '../../store';
import { LoginButton } from '../auth/LoginButton';
import { Button } from '../ui/Button';
import { AnnouncementCard } from './AnnouncementCard';
import { CommandsList } from './CommandsList';

const HERO_CONTENT = {
  mainHeading: 'Learn, Play, Create',
  subHeading: 'Level Up in Brackeys Community',
  description:
    "A community for developers of all skill levels to learn, share, and collaborate. Join us today and let's make coding fun!",
};

const BUTTON_CONTENT = {
  github: 'View on GitHub',
  joinNow: 'Join now!',
  visitServer: 'Visit server',
};

type TabType = 'announcements' | 'commands';

const DISCORD_SERVER_URL = 'https://discord.gg/brackeys';

const ContentFallback = () => (
  <div className="bg-gray-900/90 backdrop-blur-sm rounded-2xl p-6 border border-gray-800 shadow-xl h-full flex items-center justify-center">
    <div className="animate-pulse flex flex-col items-center gap-3">
      <div className="h-5 w-5 bg-gray-700 rounded" />
      <div className="h-4 w-48 bg-gray-700 rounded" />
      <div className="h-3 w-full bg-gray-700 rounded" />
      <div className="h-3 w-3/4 bg-gray-700 rounded" />
    </div>
  </div>
);

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'px-6 py-2 rounded-full backdrop-blur-sm shadow-2xl font-medium transition-all pointer-events-auto',
      active
        ? 'bg-brackeys-purple-600 text-white shadow-lg'
        : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800 hover:text-gray-300',
    )}
  >
    {children}
  </button>
);

export const HeroSection = () => {
  const [activeTab, setActiveTab] = useState<TabType>('announcements');
  const { user } = useActiveUser();
  const isInGuild = user?.discord?.guildMember?.inGuild ?? false;

  return (
    <section
      className="container mx-auto w-full px-4 sm:px-6 lg:px-8 relative"
      aria-labelledby="hero-heading"
      data-testid="hero-section"
    >
      <div className="max-w-7xl w-full mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start">
          {/* Left Column - Sticky CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="lg:sticky lg:top-54 2xl:top-64 space-y-8"
          >
            <div className="drop-shadow-[0_0_30px_rgba(0,0,0,0.9)]">
              <h1
                title={HERO_CONTENT.mainHeading}
                className="text-4xl font-extrabold text-white sm:text-5xl lg:text-6xl"
              >
                <span className="block drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                  {HERO_CONTENT.mainHeading}
                </span>
                <span className="block drop-shadow-[0_0_10px_var(--color-brackeys-purple-light)] text-brackeys-purple-600 mt-2">
                  {HERO_CONTENT.subHeading}
                </span>
              </h1>
              <p className="mt-6 text-xl text-gray-300 drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                {HERO_CONTENT.description}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <LoginButton className="w-full sm:w-auto pointer-events-auto" />
              <Button
                href="https://github.com/josh-complex/brackeys-web"
                target="_blank"
                variant="secondary"
                size="lg"
                className="w-full sm:w-auto flex items-center gap-2 pointer-events-auto"
                aria-label="View source code on GitHub"
              >
                {BUTTON_CONTENT.github}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </motion.div>

          {/* Right Column - Content with Sticky Tabs */}
          <div>
            {/* Sticky Tab Buttons */}
            <div className="sticky top-5 z-30 pb-4 mb-4">
              <div className="flex gap-2">
                <TabButton
                  active={activeTab === 'announcements'}
                  onClick={() => setActiveTab('announcements')}
                >
                  Announcements
                </TabButton>
                <TabButton
                  active={activeTab === 'commands'}
                  onClick={() => setActiveTab('commands')}
                >
                  Commands
                </TabButton>
              </div>
            </div>

            {/* Tab Content */}
            <div className="bg-gray-900/50 backdrop-blur-lg rounded-2xl p-6 border border-gray-800 shadow-xl">
              {activeTab === 'announcements' ? (
                <Suspense fallback={<ContentFallback />}>
                  <AnnouncementCard />
                </Suspense>
              ) : (
                <CommandsList />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
