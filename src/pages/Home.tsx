import { Bell, BotMessageSquare, Calendar } from 'lucide-react';
import { useEffect } from 'react';
import { CtaSection } from '../components/home/CtaSection';
import { FeatureSection, FeatureSectionItem } from '../components/home/FeatureSection';
import { HeroSection } from '../components/home/HeroSection';
import { User } from '../context/authContext';
import { useAuth } from '../context/useAuth';

const featureSections: FeatureSectionItem[] = [
  {
    id: 'bot-commands',
    title: 'Bot Commands',
    description: 'Easily interact with our custom Discord bots',
    longDescription: 'Our Discord bots provide powerful tools for moderation, fun interactions, and community management. Learn all the commands to enhance your Discord experience.',
    icon: BotMessageSquare,
    colorClass: 'text-brackeys-yellow'
  },
  {
    id: 'community-events',
    title: 'Community Events',
    description: 'Join regular game nights and coding challenges',
    longDescription: 'Participate in our regularly scheduled community events including game nights, coding challenges, hackathons, and educational workshops led by industry experts.',
    icon: Calendar,
    colorClass: 'text-brackeys-fuscia'
  },
  {
    id: 'announcements',
    title: 'Announcements & Updates',
    description: 'Stay up-to-date with the latest community news',
    longDescription: 'Never miss important announcements about new features, community milestones, partnership opportunities, and special events happening in our growing developer community.',
    icon: Bell,
    colorClass: 'text-brackeys-purple'
  },
];

type HomeProps = {
  user?: User;
};

const HomeContainer = () => {
  const { state: { user } } = useAuth();

  useEffect(() => {
    document.title = 'Home - Brackeys Community';
  }, []);

  return <HomeView user={user} />;
};

const HomeView = ({ user }: HomeProps) => (
  <div
    className="flex flex-col items-center justify-start min-h-screen"
    data-testid="home-page"
  >
    <HeroSection user={user} />

    <div id="features" className="w-full">
      {featureSections.map((feature, index) => (
        <FeatureSection
          key={feature.id}
          feature={feature}
          index={index}
        />
      ))}
    </div>

    <CtaSection />
  </div>
);

export const Home = HomeContainer;
