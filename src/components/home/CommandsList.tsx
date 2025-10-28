import { Terminal } from 'lucide-react';
import { memo } from 'react';

interface Command {
  name: string;
  description: string;
  category: string;
}

const commands: Command[] = [
  {
    name: '/help',
    description: 'Display a list of all available bot commands',
    category: 'General',
  },
  {
    name: '/profile',
    description: 'View your community profile and statistics',
    category: 'General',
  },
  {
    name: '/leaderboard',
    description: 'Check the community leaderboard rankings',
    category: 'General',
  },
  {
    name: '/events',
    description: 'View upcoming community events and game nights',
    category: 'Events',
  },
  {
    name: '/challenge',
    description: 'Join or create coding challenges',
    category: 'Events',
  },
  {
    name: '/collab',
    description: 'Find collaboration opportunities or post your own',
    category: 'Collaboration',
  },
  {
    name: '/portfolio',
    description: 'Share your portfolio and projects with the community',
    category: 'Collaboration',
  },
  {
    name: '/poll',
    description: 'Create a poll for community feedback',
    category: 'Moderation',
  },
  {
    name: '/announce',
    description: 'Post an announcement (moderators only)',
    category: 'Moderation',
  },
];

export const CommandsList = memo(() => {
  return (
    <div className="pointer-events-auto">
      <div className="flex items-center gap-2 mb-4">
        <Terminal className="h-5 w-5 text-brackeys-yellow" />
        <h2 className="text-lg font-bold text-white">Bot Commands</h2>
      </div>

      <div className="space-y-3">
        {commands.map((command) => (
          <div
            key={command.name}
            className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 hover:border-brackeys-yellow/50 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <code className="text-brackeys-yellow font-mono text-base font-semibold">
                {command.name}
              </code>
              <span className="text-xs text-gray-500 px-2 py-1 bg-gray-900/50 rounded">
                {command.category}
              </span>
            </div>
            <p className="text-gray-300 text-sm">{command.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
});
