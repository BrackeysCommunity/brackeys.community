import { useSignIn, useClerk } from '@clerk/tanstack-react-start';

/**
 * Hook that provides authentication helper functions
 * This is a thin wrapper around Clerk's auth methods for backwards compatibility
 */
export function useAuthHelpers() {
  const { signIn } = useSignIn();
  const clerk = useClerk();

  const signInWithDiscord = async () => {
    try {
      console.log('Initiating Discord OAuth flow...');
      
      // Use Clerk's authenticateWithRedirect method which handles BOTH
      // sign-in (returning users) and sign-up (new users) automatically
      await signIn?.authenticateWithRedirect({
        strategy: 'oauth_discord',
        redirectUrl: '/auth/entry',
        redirectUrlComplete: '/auth/entry',
        continueSignUp: true,
      });
    } catch (error) {
      console.error('Discord authentication error:', error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await clerk.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  };

  return {
    signInWithDiscord,
    signOut,
  };
}

