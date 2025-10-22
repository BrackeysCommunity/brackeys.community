import { motion } from 'motion/react';
import { useActiveUser } from '../store';
import { Alert } from '../components/ui/Alert';
import { useEffect } from 'react';
import { RedirectToSignIn, SignedIn, SignedOut, UserProfile } from '@clerk/tanstack-react-start';
import { useNavigate } from '@tanstack/react-router';
import { clerkAppearance } from '../lib/clerk-theme';
import { DiscordInfo, DiscordIcon } from '../integrations/clerk/discord-info';

const ProfileContent = () => {
  const { user } = useActiveUser();

  useEffect(() => {
    document.title = 'Profile - Brackeys Community';
  }, []);

  if (!user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <h3 className="text-lg font-medium text-white">Not signed in</h3>
          <p className="mt-1 text-sm text-gray-400">
            Please sign in to view your profile.
          </p>
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
        className="max-w-5xl mx-auto"
      >
        <h1 className="text-2xl font-semibold text-white">Your Profile</h1>
        <p className="mt-2 text-gray-300">
          View and manage your Discord-connected account information.
        </p>
      </motion.div>

      <div className="mt-8 max-w-5xl mx-auto">
        <UserProfile appearance={clerkAppearance}>
          {/* Discord Guild Info Page */}
          <UserProfile.Page
            label="Discord"
            labelIcon={<DiscordIcon />}
            url="discord"
          >
            <DiscordInfo variant="full" />
          </UserProfile.Page>
        </UserProfile>

        <Alert
          variant="info"
          description="This information is synchronized from your Discord account. Changes made on Discord will be reflected here after syncing."
          className="mt-6"
        />
      </div>
    </div>
  );
};

export const Profile = () => {
  const navigate = useNavigate();

  return (
    <>
      <SignedIn treatPendingAsSignedOut={false}>
        <ProfileContent />
      </SignedIn>
      <SignedOut treatPendingAsSignedOut={false}>
        <RedirectToSignIn signInForceRedirectUrl="/login" redirectUrl='/login' signUpForceRedirectUrl='/login' signInFallbackRedirectUrl='/login' signUpFallbackRedirectUrl='/login' />
      </SignedOut>
    </>
  );
};
