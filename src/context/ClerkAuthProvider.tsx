import { useReducer, useEffect, PropsWithChildren } from 'react';
import { useUser, useClerk, useSignIn } from '@clerk/clerk-react';
import {
  AuthState,
  AuthAction,
  User,
  AuthContext,
  authInitialState,
  HasuraClaims,
  DiscordGuildMemberData,
} from './authContext';

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, isLoading: true, error: undefined };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        isLoading: false,
        user: action.payload.user,
        discordMemberData: action.payload.discordMemberData,
        hasuraClaims: action.payload.hasuraClaims,
        error: undefined,
      };
    case 'LOGIN_FAILURE':
      console.error(action.payload, action.error);
      return { ...state, isLoading: false, error: action.payload };
    case 'LOGOUT':
      return {
        ...state,
        user: undefined,
        discordMemberData: undefined,
        hasuraClaims: undefined,
        isLoading: false,
      };
    case 'CLEAR_ERROR':
      return { ...state, error: undefined };
    case 'UPDATE_DISCORD_DATA':
      return {
        ...state,
        discordMemberData: action.payload.discordMemberData,
        hasuraClaims: action.payload.hasuraClaims,
      };
    default:
      return state;
  }
};

export const ClerkAuthProvider = ({ children }: PropsWithChildren) => {
  const [state, dispatch] = useReducer(authReducer, authInitialState);
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser();
  const clerk = useClerk();
  const { signIn } = useSignIn();

  useEffect(() => {
    if (!clerkLoaded) {
      dispatch({ type: 'LOGIN_START' });
      return;
    }

    if (clerkUser) {
      // Debug: Log external accounts to see what Discord data we're getting
      console.log('Clerk User Data:', clerkUser);

      const discordAccount = clerkUser.externalAccounts.find(acc => acc.provider === 'discord');

      // Extract Hasura claims from Clerk metadata
      const publicMetadata = clerkUser.publicMetadata as {
        hasura?: {
          defaultRole?: string;
          allowedRoles?: string[];
        };
        discord?: DiscordGuildMemberData;
      };

      console.log('=== Discord Data ===');
      console.log('Discord Account:', discordAccount);
      console.log('Discord Metadata:', publicMetadata?.discord);
      console.log('Hasura Claims:', publicMetadata?.hasura);
      console.log('==================');

      const userData: User = {
        id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress || '',
        created_at: new Date(clerkUser.createdAt || '').toISOString(),
        updated_at: new Date(clerkUser.updatedAt || '').toISOString(),
        username: discordAccount?.username || clerkUser.username || clerkUser.fullName || '',
        full_name:
          discordAccount?.firstName && discordAccount?.lastName
            ? `${discordAccount.firstName} ${discordAccount.lastName}`
            : clerkUser.fullName || '',
        avatar_url: discordAccount?.imageUrl || clerkUser.imageUrl,
        discord_id: discordAccount?.id || '',
      };
      const hasuraClaims: HasuraClaims = {
        defaultRole: publicMetadata?.hasura?.defaultRole || 'user',
        allowedRoles: publicMetadata?.hasura?.allowedRoles || ['user'],
      };

      dispatch({
        type: 'LOGIN_SUCCESS',
        payload: {
          user: userData,
          hasuraClaims,
          discordMemberData: publicMetadata?.discord,
        },
      });
    } else {
      dispatch({ type: 'LOGOUT' });
    }
  }, [clerkUser, clerkLoaded]);

  const signInWithDiscord = async () => {
    try {
      dispatch({ type: 'LOGIN_START' });

      console.log('Initiating Discord OAuth flow...');
      console.log('Clerk available:', !!clerk);

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
      dispatch({
        type: 'LOGIN_FAILURE',
        payload: 'Failed to authenticate with Discord',
        error: error,
      });
    }
  };

  const signOut = async () => {
    try {
      dispatch({ type: 'LOGIN_START' });
      await clerk.signOut();
      dispatch({ type: 'LOGOUT' });
    } catch (error) {
      dispatch({
        type: 'LOGIN_FAILURE',
        payload: 'Failed to sign out',
        error: error,
      });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        state,
        dispatch,
        signInWithDiscord,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
