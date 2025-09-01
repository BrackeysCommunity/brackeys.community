import { motion } from 'motion/react';
import { FileWarning, Activity, User as UserIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { useEffect } from 'react';
import { AuthGuard } from '../components/auth/AuthGuard';
import { useAuth } from '../context/useAuth';

type RecentActivityItem = {
  id: number;
  action: string;
  description: string;
  channel?: string;
  time: string;
}

const recentActivity: RecentActivityItem[] = [
  { id: 1, action: 'Infraction', description: 'Spamming', time: '2 hours ago' },
  { id: 2, action: 'Infraction', description: 'Racist remarks', time: '5 hours ago' },
  { id: 4, action: 'Bot Command', description: '[]collab', channel: '#bot', time: 'Yesterday' },
  { id: 3, action: 'Infraction', description: 'Impersonating a staff member', time: '2 days ago' },
];

const infractionCount = recentActivity.filter(activity => activity.action === 'Infraction').length;

const DashboardContent = () => {
  const { state: { user } } = useAuth();

  useEffect(() => {
    document.title = 'Dashboard - Brackeys Community';
  }, []);

  return (
    <div className="pb-6 max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold text-white mb-2">
          Welcome back, {user?.full_name || user?.username}!
        </h1>
        <p className="text-gray-400">
          Here's your Brackeys Community dashboard
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Overview Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Overview</h2>
              <Activity className="h-5 w-5 text-brackeys-purple-400" />
            </div>

            <div className="space-y-4">
              <div className="bg-gray-900/50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileWarning className="h-8 w-8 text-red-400" />
                    <div>
                      <p className="text-sm text-gray-400">Total Infractions</p>
                      <p className="text-2xl font-bold text-white">{infractionCount}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-sm text-gray-400">
                <p className="mb-2">Community Status</p>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span className="text-gray-300">Active Member</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Recent Activity Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Recent Activity</h2>
              <Activity className="h-5 w-5 text-brackeys-purple-400" />
            </div>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="bg-gray-900/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn(
                      "text-sm font-medium",
                      activity.action === "Infraction" ? "text-red-400" : "text-brackeys-purple-400"
                    )}>
                      {activity.action}
                    </span>
                    <span className="text-xs text-gray-500">{activity.time}</span>
                  </div>
                  <p className="text-sm text-gray-300">{activity.description}</p>
                  {activity.channel && (
                    <p className="text-xs text-gray-500 mt-1">
                      in <a href={`https://discord.com/channels/243005537342586880/433649136370450462`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brackeys-purple-400 hover:underline">
                        {activity.channel}
                      </a>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Discord Profile Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Discord Profile</h2>
              <UserIcon className="h-5 w-5 text-brackeys-purple-400" />
            </div>

            <div className="flex items-center gap-4 mb-6">
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.username || 'Avatar'}
                  className="h-20 w-20 rounded-full ring-2 ring-brackeys-purple-400/20"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-gradient-to-br from-brackeys-purple-800 to-brackeys-purple-600 flex items-center justify-center">
                  <span className="text-3xl font-bold text-white">
                    {user?.username?.charAt(0).toUpperCase() || 'U'}
                  </span>
                </div>
              )}
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white">
                  {user?.username || 'Discord User'}
                </h3>
                <p className="text-sm text-gray-400">
                  {user?.full_name || 'Global name not set'}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-1">Email</p>
                <p className="text-sm text-gray-300">{user?.email || 'Not available'}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-900/50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">User ID</p>
                  <p className="text-sm text-gray-300 font-mono">
                    {user?.id.substring(0, 8)}...
                  </p>
                </div>

                <div className="bg-gray-900/50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">Member Since</p>
                  <p className="text-sm text-gray-300">
                    {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export const Dashboard = () => {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
};