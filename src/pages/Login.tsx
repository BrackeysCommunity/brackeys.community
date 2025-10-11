import { useEffect } from 'react';
import { motion } from 'motion/react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useActiveUser } from '../store';
import { LoginButton } from '../components/auth/LoginButton';
import { DiscordLogo } from '../components/icons/DiscordLogo';
import { Alert } from '../components/ui/Alert';

export const Login = () => {
  const { user, isLoading, error } = useActiveUser();
  const navigate = useNavigate();
  const {
    location: { search },
  } = useRouterState();

  // Get redirect param from search params if available
  const searchParams = new URLSearchParams(search);
  const from = searchParams.get('redirect') || '/profile';

  useEffect(() => {
    document.title = 'Login - Brackeys Community';
  }, []);

  useEffect(() => {
    if (user && !isLoading) {
      navigate({ to: from, replace: true, resetScroll: true });
    }
  }, [user, isLoading, navigate, from]);

  if (user) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex min-h-[80vh] flex-col justify-center py-12 sm:px-6 lg:px-8"
    >
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15 }}
          className="mx-auto h-16 w-16 bg-linear-to-br from-brackeys-purple-600 to-indigo-600 rounded-xl flex items-center justify-center"
        >
          <DiscordLogo className="h-8 w-8 text-white" />
        </motion.div>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-white">
          Sign in to your account
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-gray-800 py-8 px-4 shadow-sm sm:rounded-lg sm:px-10 border border-gray-700">
          <div className="flex flex-col items-center justify-center space-y-6">
            <LoginButton />

            {error && (
              <Alert
                variant="error"
                title="Authentication Error"
                description={error}
                className="w-full"
              />
            )}
          </div>

          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-600" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-gray-800 px-2 text-gray-400">
                  Why Discord?
                </span>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-center text-sm text-gray-400">
                Sign in with Discord to access the Brackeys Community platform.
                Discord authentication provides secure access and automatically
                syncs your server roles and membership status.
                <br />
                <br />
                <strong className="text-gray-300">Note:</strong> You must be a
                member of the Brackeys Discord server to access this
                application.
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
