import { motion } from 'motion/react';
import { Users, MessageSquare, FileWarning, List } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { ComponentType, useEffect } from 'react';

type StatItem = {
  name: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
}

const stats: StatItem[] = [
  { name: 'Total Messages', value: '7,765', icon: MessageSquare },
  { name: 'Active Channels', value: '11', icon: List },
  { name: 'Most Active Channel', value: '#chat', icon: Users },
  { name: 'Total Infractions', value: '3', icon: FileWarning },
];

const recentActivity: RecentActivityItem[] = [
  { id: 1, action: 'Infraction', description: 'Spamming', time: '2 hours ago' },
  { id: 2, action: 'Infraction', description: 'Racist remarks', time: '5 hours ago' },
  { id: 4, action: 'Bot Command', description: '[]collab', channel: '#bot', time: 'Yesterday' },
  { id: 3, action: 'Infraction', description: 'Impersonating a staff member', time: '2 days ago' },
];

export const Dashboard = () => {
  const { state: { user } } = useAuth();

  useEffect(() => {
    document.title = 'Dashboard - Brackeys Community';
  }, []);

  return (
    <div className="pb-6 max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="text-2xl font-semibold text-white">
          Welcome, {user?.full_name ? user.full_name : user?.username}!
        </h1>
        <p className="mt-2 text-gray-300">
          Here's an overview of your server activity.
        </p>
      </motion.div>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className="bg-gray-800 overflow-hidden rounded-lg shadow-sm border border-gray-700"
            >
              <div className="p-5">
                <div className="flex items-center">
                  <div className="shrink-0">
                    <Icon className="h-6 w-6 text-brackeys-purple-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="truncate text-sm font-medium text-gray-400">
                        {stat.name}
                      </dt>
                      <dd>
                        <div className="text-lg font-semibold text-white">
                          {stat.value}
                        </div>
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.4 }}
          className="bg-gray-800 overflow-hidden rounded-lg shadow-sm border border-gray-700"
        >
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg font-medium leading-6 text-white">
              Recent Activity
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              Your latest actions across Discord servers.
            </p>
          </div>
          <div className="border-t border-gray-700">
            <ul className="divide-y divide-gray-700">
              {recentActivity.map((activity) => (
                <li key={activity.id} className="px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm font-medium text-brackeys-purple-400">
                      {activity.action}
                    </p>
                    <div className="ml-2 flex shrink-0">
                      <p className={cn("inline-flex rounded-full bg-green-800/30 px-2 text-xs font-semibold leading-5 text-green-400", activity.action === "Infraction" && "bg-red-800/30 text-red-400")}>
                        {activity.time}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 sm:flex sm:justify-between">
                    <div className="sm:flex">
                      <p className="flex items-baseline text-sm text-gray-300">
                        {activity.description}
                        {activity.channel && (
                          <span className="ml-1 text-xs text-gray-500">
                            • in
                            <a className="ml-1 text-xs text-brackeys-purple-400 hover:underline" href={`https://discord.com/channels/243005537342586880/433649136370450462`} target="_blank" rel="noopener noreferrer">
                              {activity.channel}
                            </a>
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.5 }}
          className="bg-gray-800 overflow-hidden rounded-lg shadow-sm border border-gray-700"
        >
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg font-medium leading-6 text-white">
              Discord Profile
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              Information from your Discord account.
            </p>
          </div>
          <div className="border-t border-gray-700 px-4 py-5 sm:px-6">
            <div className="flex items-center space-x-4">
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.username || 'Avatar'}
                  className="h-16 w-16 rounded-full"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-brackeys-purple-800 flex items-center justify-center">
                  <span className="text-2xl font-semibold text-brackeys-purple-300">
                    {user?.username?.charAt(0) || 'U'}
                  </span>
                </div>
              )}
              <div>
                <h4 className="text-lg font-semibold text-white">
                  {user?.username || 'Discord User'}
                </h4>
                <p className="text-sm text-gray-400">
                  {user?.email || 'No email available'}
                </p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-gray-400">
                  Account ID
                </dt>
                <dd className="mt-1 text-sm text-gray-300">
                  {user?.id.substring(0, 8) || 'Not available'}
                </dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-gray-400">
                  Full Name
                </dt>
                <dd className="mt-1 text-sm text-gray-300">
                  {user?.full_name || 'Not provided'}
                </dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-gray-400">
                  Account Connected
                </dt>
                <dd className="mt-1 text-sm text-gray-300">
                  {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown'}
                </dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-gray-400">
                  Last Login
                </dt>
                <dd className="mt-1 text-sm text-gray-300">
                  {user?.updated_at ? new Date(user.updated_at).toLocaleDateString() : 'Unknown'}
                </dd>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};