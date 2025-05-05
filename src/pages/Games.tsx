import { motion } from 'motion/react';
import { useEffect } from 'react';
import { Gamepad2, Trophy, Brain, Building, Skull, WholeWord, Swords } from 'lucide-react';
import { cn } from '../lib/utils';
import { ComponentType } from 'react';

const games: GameItem[] = [
  {
    id: 'perfect-day',
    title: 'The Perfect Day',
    description: 'Nothing must go wrong!',
    imageUrl: 'https://qntn.be/img/portfolio/NEqBrb.png',
    category: 'simulation',
    releaseDate: '2025-02',
    developer: 'Quinten',
    developerUrl: 'https://qntn.be/',
    gameUrl: 'https://computer-q.itch.io/brackeys-13-nothing-can-go-wrong',
  },
  {
    id: 'amalgablade',
    title: 'Amalgablade',
    description: 'A chill strategic autobattler.',
    imageUrl: 'https://qntn.be/img/portfolio/fJRVUX.png',
    category: 'strategy',
    releaseDate: '2025-01-01',
    developer: 'Quinten',
    developerUrl: 'https://qntn.be/',
    gameUrl: 'https://computer-q.itch.io/pirate16-you-are-the-weapon',
  },
  {
    id: 'guardians-chaos',
    title: 'Guardians of Chaos',
    description: 'Defend the wizards tower from monsters in an exciting retro-style tower-defense bullet-hell!',
    imageUrl: 'https://qntn.be/img/portfolio/ItCBjo.gif',
    category: 'survival',
    releaseDate: '2024-10',
    developer: 'Quinten',
    developerUrl: 'https://qntn.be/',
    gameUrl: 'https://computer-q.itch.io/1-bit-jam-4-tower',
  },
  {
    id: 'lighthouse-shepard',
    title: 'Lighthouse - The Storm Shepard',
    description: 'Lead your armies to victory through strategic planning and tactical battlefield decisions.',
    imageUrl: 'https://qntn.be/img/portfolio/b8F72I.gif',
    category: 'strategy',
    releaseDate: '2024-09',
    developer: 'Quinten',
    developerUrl: 'https://qntn.be/',
    gameUrl: 'https://computer-q.itch.io/brackeys-12-calm-before-the-storm',
  },
  {
    id: 'alchemist-shadowland',
    title: 'Alchemist of Shadowland',
    description: '',
    imageUrl: 'https://qntn.be/img/portfolio/lux7Lg.png',
    category: 'strategy',
    releaseDate: '2024-08',
    developer: 'Quinten',
    developerUrl: 'https://qntn.be/',
    gameUrl: 'https://computer-q.itch.io/shadows-alchemy',
  },
];

type CategoryInfo = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
};

const categories: Record<GameItem['category'], CategoryInfo> = {
  action: {
    label: 'Action',
    icon: Swords,
    color: 'text-red-500'
  },
  puzzle: {
    label: 'Puzzle',
    icon: Brain,
    color: 'text-blue-500'
  },
  adventure: {
    label: 'Adventure',
    icon: WholeWord,
    color: 'text-brackeys-purple-600'
  },
  simulation: {
    label: 'Simulation',
    icon: Building,
    color: 'text-green-500'
  },
  strategy: {
    label: 'Strategy',
    icon: Trophy,
    color: 'text-yellow-500'
  },
  survival: {
    label: 'Survival',
    icon: Skull,
    color: 'text-brackeys-fuscia'
  }
};

export const Games = () => {
  useEffect(() => {
    document.title = 'Games - Brackeys Community';
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-7xl w-full space-y-8"
      >
        <div className="text-center">
          <h1 className="text-4xl font-extrabold text-white sm:text-5xl">
            <span className="block">Community Games</span>
            <span className="block text-brackeys-purple-600 mt-2">Play, Compete, Create</span>
          </h1>
          <p className="mt-6 text-lg text-gray-300 max-w-2xl mx-auto">
            Explore games created by the Brackeys community. From action-packed adventures to brain-teasing puzzles, there's something for everyone.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-4 justify-center">
          {Object.entries(categories).map(([key, category]) => {
            const CategoryIcon = category.icon;
            return (
              <motion.button
                key={key}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "px-4 py-2 rounded-full border flex items-center gap-2",
                  "hover:bg-gray-800 transition-colors",
                  "border-gray-700"
                )}
              >
                <CategoryIcon className={cn("h-4 w-4", category.color)} />
                <span className="text-sm font-medium text-gray-300">{category.label}</span>
              </motion.button>
            );
          })}
        </div>

        <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game, index) => {
            const category = categories[game.category];
            const CategoryIcon = category.icon;

            return (
              <motion.div
                key={game.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 * index }}
                whileHover={{ y: -5 }}
                exit={{ y: 0 }}
                className="bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-700 h-full flex flex-col"
              >
                <div className="relative w-full h-48 bg-gray-700">
                  {game.imageUrl ? (
                    <img
                      src={game.imageUrl}
                      alt={game.title}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                      <Gamepad2 className="h-12 w-12" />
                    </div>
                  )}
                </div>

                <div className="p-6 flex-grow flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <CategoryIcon className={cn("h-4 w-4", category.color)} />
                    <span className="text-xs font-medium text-gray-400">{category.label}</span>
                  </div>

                  <h3 className="text-xl font-bold text-white mb-2">{game.title}</h3>
                  <p className="text-gray-300 text-sm flex-grow">{game.description}</p>

                  <div className="mt-4 flex justify-between items-center text-xs text-gray-400">
                    <span>By {game.developer}</span>
                    <span>Released: {new Date(game.releaseDate).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="p-4 border-t border-gray-700 bg-gray-900">
                  <a
                    href={game.gameUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-xs text-white bg-brackeys-purple-600 hover:bg-brackeys-purple-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-brackeys-purple-500"
                  >
                    Play Now
                  </a>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};
