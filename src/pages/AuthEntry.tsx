import { useEffect, useState } from 'react';
import {
  AuthenticateWithRedirectCallback,
  useClerk,
  useUser,
} from '@clerk/tanstack-react-start';
import { useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { DiscordLogo } from '../components/icons/DiscordLogo';
import { CheckCircle2, AlertCircle } from 'lucide-react';

type AuthStep = 'loading' | 'complete' | 'error';

export const AuthEntry = () => {
  const { user, isLoaded } = useUser();
  const clerk = useClerk();
  const navigate = useNavigate();
  const [step, setStep] = useState<AuthStep>('loading');
  const [errorMessage, setErrorMessage] = useState<string>();

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!user) {
      // No user found - OAuth may have failed or been cancelled
      console.log('No user found after auth attempt, redirecting to login');
      clerk.handleRedirectCallback({
        redirectUrl: '/auth/entry',
      });
      return;
    }

    console.log('=== Auth Entry - User Data ===');
    console.log('User ID:', user.id);
    console.log(
      'Has Discord:',
      user.externalAccounts.some((acc) => acc.provider === 'discord'),
    );
    console.log('Public Metadata:', user.publicMetadata);

    const hasDiscordAccount = user.externalAccounts.some(
      (acc) => acc.provider === 'discord',
    );

    // Check if user is in the Discord guild
    const publicMetadata = user.publicMetadata as {
      discord?: {
        inGuild?: boolean;
      };
    };

    const inGuild = publicMetadata?.discord?.inGuild;

    if (!hasDiscordAccount) {
      setErrorMessage(
        'Discord account not connected. Please try logging in with Discord.',
      );
      setStep('error');
      return;
    }

    // If user is not in guild, show error
    if (inGuild === false) {
      setErrorMessage(
        'You must be a member of the Brackeys Discord server to access this application.',
      );
      setStep('error');
      return;
    }

    // All checks passed, redirect to profile
    console.log('Auth complete, redirecting to profile');
    setStep('complete');

    setTimeout(() => {
      navigate({ to: '/profile', replace: true });
    }, 800);
  }, [user, isLoaded, navigate, clerk]);

  // Render error state
  if (step === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-md"
        >
          <div className="bg-gray-800 rounded-lg shadow-xl border border-red-900/50 p-8">
            <div className="flex flex-col items-center mb-6">
              <div className="bg-red-900/20 rounded-xl p-4 mb-4">
                <AlertCircle className="h-8 w-8 text-red-500" />
              </div>
              <h2 className="text-2xl font-bold text-white text-center">
                Authentication Error
              </h2>
              <p className="text-gray-400 text-center mt-2">{errorMessage}</p>
            </div>

            <button
              onClick={() => navigate({ to: '/login', replace: true })}
              className="w-full bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              Return to Login
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Render loading/complete state
  const getStepIcon = () => {
    if (step === 'complete')
      return <CheckCircle2 className="h-16 w-16 text-white" />;
    return <DiscordLogo className="h-16 w-16 text-white" />;
  };

  const getStepText = () => {
    if (step === 'complete') {
      return {
        title: 'All set!',
        subtitle: 'Redirecting to your profile',
      };
    }
    return {
      title: 'Processing authentication...',
      subtitle: 'Please wait while we set up your account',
    };
  };

  const stepInfo = getStepText();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center space-y-6 p-8"
      >
        {/* Icon with animated background */}
        <motion.div
          className="relative"
          key={step}
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-brackeys-purple-600 to-indigo-600 rounded-2xl blur-xl opacity-50"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.5, 0.7, 0.5],
            }}
            transition={{
              duration: 2,
              repeat: step === 'loading' ? Infinity : 0,
              ease: 'easeInOut',
            }}
          />
          <div className="relative bg-gradient-to-br from-brackeys-purple-600 to-indigo-600 rounded-2xl p-6">
            {getStepIcon()}
          </div>
        </motion.div>

        {/* Animated checkmark - only show when complete */}
        {step === 'complete' && (
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              delay: 0.2,
              type: 'spring',
              stiffness: 200,
              damping: 15,
            }}
          >
            <CheckCircle2 className="h-12 w-12 text-green-400" />
          </motion.div>
        )}

        {/* Text content */}
        <motion.div
          className="text-center space-y-2"
          key={stepInfo.title}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="text-2xl font-bold text-white">{stepInfo.title}</h1>
          <p className="text-gray-400">{stepInfo.subtitle}</p>
        </motion.div>

        {/* Loading dots - hide when complete */}
        {step === 'loading' && (
          <motion.div
            className="flex space-x-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="h-3 w-3 rounded-full bg-brackeys-purple-500"
                animate={{
                  scale: [1, 1.3, 1],
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  delay: i * 0.15,
                }}
              />
            ))}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};

export const SSOCallback = () => {
  return (
    <>
      <AuthenticateWithRedirectCallback />

      {/* Required for sign-up flows
      Clerk's bot sign-up protection is enabled by default */}
      <div id="clerk-captcha" />
    </>
  );
};
