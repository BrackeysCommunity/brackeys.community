import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LoginButton } from '../components/auth/LoginButton';
import { Calendar, Bell, BotMessageSquare } from 'lucide-react';
import { cn } from '../lib/utils';
import { ComponentType, useEffect } from 'react';
import { DiscordLogo } from '../components/icons/DiscordLogo';

type FeatureItem = {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

const features: FeatureItem[] = [
  {
    title: 'Bot Commands',
    description: 'Easily interact with our custom Discord bots using intuitive commands for moderation and fun.',
    icon: BotMessageSquare,
  },
  {
    title: 'Events',
    description: 'Join regular community events, game nights, and coding challenges organized by our team.',
    icon: Calendar,
  },
  {
    title: 'Announcements',
    description: 'Stay up-to-date with the latest community news, updates, and important information.',
    icon: Bell,
  },
];

export const Home = () => {
  const { state: { user } } = useAuth();

  useEffect(() => {
    document.title = 'Home - Brackeys Community';
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-4xl w-full space-y-8 text-center"
      >
        <div>
          <motion.div
            className="mx-auto h-20 w-20 bg-linear-to-br from-brackeys-purple-600 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg"
            whileHover={{ rotate: 5, scale: 1.05 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <DiscordLogo className="h-10 w-10 text-white" />
          </motion.div>
          <h1 className="mt-6 text-4xl font-extrabold text-white sm:text-5xl">
            <span className="block">Learn, Code, and Play &mdash;</span>
            <span className="block text-brackeys-purple-600 mt-2">Level Up in Brackeys Community</span>
          </h1>
          <p className="mt-6 text-lg text-gray-300 max-w-2xl mx-auto">
            A community for developers of all skill levels to learn, share, and collaborate.
            Join us today and let's make coding fun!
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
          {user ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg shadow-xs text-white bg-brackeys-purple-600 hover:bg-brackeys-purple-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-brackeys-purple-500 transition-colors"
            >
              Go to Dashboard
            </Link>
          ) : (
            <LoginButton className="self-center" />
          )}

          <a
            href="https://github.com/josh-complex/brackeys-web"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-6 py-3 border border-gray-700 text-base font-medium rounded-lg shadow-xs text-gray-300 bg-gray-800 hover:bg-gray-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-indigo-500 transition-colors"
          >
            View on GitHub
          </a>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ title, description, icon: Icon }, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 + index * 0.1 }}
              className="bg-gray-800 rounded-lg shadow-md px-6 py-8 border border-gray-700"
            >
              <div className="flex flex-col items-center">
                <Icon
                  className={cn(
                    'h-8 w-8 mb-4',
                    index === 0 ? 'text-brackeys-yellow' :
                      index === 1 ? 'text-brackeys-fuscia' :
                        'text-brackeys-purple'
                  )}
                />
                <h3 className="text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-gray-300">{description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};