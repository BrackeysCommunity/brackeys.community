import { motion } from 'motion/react';
import { User, Mail, Calendar, Clock } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { formatDate } from '../lib/utils';
import { DiscordProfileButton } from '../components/ui/DiscordProfileButton';
import { Alert } from '../components/ui/Alert';
import { useEffect } from 'react';
import { AuthGuard } from '../components/auth/AuthGuard';

const ProfileContent = () => {
  const {
    state: { user },
  } = useAuth();

  useEffect(() => {
    document.title = 'Profile - Brackeys Community';
  }, []);

  if (!user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <h3 className="text-lg font-medium text-white">Not signed in</h3>
          <p className="mt-1 text-sm text-gray-400">Please sign in to view your profile.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="max-w-3xl mx-auto"
      >
        <h1 className="text-2xl font-semibold text-white">Your Profile</h1>
        <p className="mt-2 text-gray-300">
          View and manage your Discord-connected account information.
        </p>
      </motion.div>

      <div className="mt-8 max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="bg-gray-800 shadow-sm overflow-hidden rounded-lg border border-gray-700"
        >
          <div className="px-4 py-5 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between space-y-4 sm:space-y-0">
            <div>
              <h3 className="text-lg leading-6 font-medium text-white">Discord Account</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-400">
                Your Discord identity connected to this application.
              </p>
            </div>
            <DiscordProfileButton />
          </div>

          <div className="border-t border-gray-700 px-4 py-5 sm:p-0">
            <div className="sm:divide-y sm:divide-gray-700">
              <div className="py-5 sm:px-6 flex flex-col sm:flex-row sm:gap-6 items-center">
                {user?.avatar_url ? (
                  <motion.img
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: 'spring', stiffness: 300 }}
                    src={user.avatar_url}
                    alt={user.username || 'Avatar'}
                    className="h-25 w-25 p-1 rounded-full bg-gradient-to-br from-brackeys-yellow via-brackeys-fuscia to-brackeys-purple"
                  />
                ) : (
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: 'spring', stiffness: 300 }}
                    className="h-24 w-24 rounded-full bg-brackeys-purple-800 flex items-center justify-center ring-4 ring-brackeys-purple-900"
                  >
                    <span className="text-3xl font-bold text-brackeys-purple-300">
                      {user?.username?.charAt(0) || 'U'}
                    </span>
                  </motion.div>
                )}
                <div className="mt-4 sm:mt-0 text-center sm:text-left">
                  <h2 className="text-xl font-bold text-white">
                    {user?.full_name || 'Discord User'}
                  </h2>
                  <p className="text-sm text-brackeys-purple-400 mt-1">
                    Brackeys Community Member{' '}
                    <span className="text-gray-500 text-xs">• for 6 years</span>
                  </p>
                </div>
              </div>

              <dl className="divide-y divide-gray-700">
                <div className="py-4 sm:py-5 sm:px-6 grid grid-cols-3 gap-4">
                  <dt className="text-sm font-medium text-gray-400 flex items-center">
                    <User className="h-5 w-5 mr-2" />
                    Username
                  </dt>
                  <dd className="text-sm text-gray-300 col-span-2">
                    {user?.username || 'Not available'}
                  </dd>
                </div>
                <div className="py-4 sm:py-5 sm:px-6 grid grid-cols-3 gap-4">
                  <dt className="text-sm font-medium text-gray-400 flex items-center">
                    <Mail className="h-5 w-5 mr-2" />
                    Email address
                  </dt>
                  <dd className="text-sm text-gray-300 col-span-2">
                    {user?.email || 'Not available'}
                  </dd>
                </div>
                <div className="py-4 sm:py-5 sm:px-6 grid grid-cols-3 gap-4">
                  <dt className="text-sm font-medium text-gray-400 flex items-center">
                    <Calendar className="h-5 w-5 mr-2" />
                    Account connected
                  </dt>
                  <dd className="text-sm text-gray-300 col-span-2">
                    {user?.created_at ? formatDate(user.created_at) : 'Unknown'}
                  </dd>
                </div>
                <div className="py-4 sm:py-5 sm:px-6 grid grid-cols-3 gap-4">
                  <dt className="text-sm font-medium text-gray-400 flex items-center">
                    <Clock className="h-5 w-5 mr-2" />
                    Last login
                  </dt>
                  <dd className="text-sm text-gray-300 col-span-2">
                    {user?.updated_at ? formatDate(user.updated_at) : 'Unknown'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </motion.div>

        <Alert
          variant="info"
          description="This information is synchronized from your Discord account. Changes made on Discord will be reflected here."
          className="mt-6"
        />
      </div>
    </div>
  );
};

export const Profile = () => {
  return (
    <AuthGuard>
      <ProfileContent />
    </AuthGuard>
  );
};
