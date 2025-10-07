import { useReducer, useEffect, PropsWithChildren } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';
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
  const { authenticateWithBase, signOut: clerkSignOut } = useClerk();

  useEffect(() => {
    if (!clerkLoaded) {
      dispatch({ type: 'LOGIN_START' });
      return;
    }

    if (clerkUser) {
      const userData: User = {
        id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress || '',
        created_at: new Date(clerkUser.createdAt || '').toISOString(),
        updated_at: new Date(clerkUser.updatedAt || '').toISOString(),
        username: clerkUser.username || clerkUser.fullName || '',
        full_name: clerkUser.fullName || '',
        avatar_url: clerkUser.imageUrl,
        discord_id: clerkUser.externalAccounts.find(acc => acc.provider === 'discord')?.id || '',
      };

      // Extract Hasura claims from Clerk metadata

      const publicMetadata = clerkUser.publicMetadata as {
        hasura?: {
          defaultRole?: string;
          allowedRoles?: string[];
        };
        discord?: DiscordGuildMemberData;
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
      // Use SDK to trigger Discord OAuth, not UI components
      await authenticateWithBase({
        redirectUrl: `${window.location.origin}/dashboard`,
        signUpContinueUrl: `${window.location.origin}/dashboard`,
      });
    } catch (error) {
      dispatch({
        type: 'LOGIN_FAILURE',
        payload: 'Failed to sign in with Discord',
        error: error,
      });
    }
  };

  const signOut = async () => {
    try {
      dispatch({ type: 'LOGIN_START' });
      await clerkSignOut();
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
