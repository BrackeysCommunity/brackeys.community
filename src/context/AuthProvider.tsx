import { useReducer, useEffect, PropsWithChildren, Dispatch } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AuthState, AuthAction, User, AuthContext, authInitialState, DiscordGuildMemberData, HasuraClaims } from './authContext';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';

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
        error: undefined
      };
    case 'LOGIN_FAILURE':
      console.error(action.payload, action.error);
      return { ...state, isLoading: false, error: action.payload };
    case 'LOGOUT':
      return { ...state, user: undefined, discordMemberData: undefined, hasuraClaims: undefined, isLoading: false };
    case 'CLEAR_ERROR':
      return { ...state, error: undefined };
    case 'UPDATE_DISCORD_DATA':
      return {
        ...state,
        discordMemberData: action.payload.discordMemberData,
        hasuraClaims: action.payload.hasuraClaims
      };
    default:
      return state;
  }
}

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [state, dispatch] = useReducer(authReducer, authInitialState);
  const { data: discordMemberData } = useDiscordGuildMemberData(state.isLoading);

  useEffect(() => {
    const fetchInitialSession = async () => {
      try {
        dispatch({ type: 'LOGIN_START' });

        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }
        if (session) {
          const userData = mapSessionToUser(session);
          updateDiscordProviderDataAndDispatchSuccess(session, userData, dispatch, discordMemberData);
        } else {
          dispatch({ type: 'LOGOUT' });
        }
      } catch (error) { dispatch({ type: 'LOGIN_FAILURE', payload: 'Failed to authenticate', error: error }) }
    };

    fetchInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          const userData = mapSessionToUser(session);
          updateDiscordProviderDataAndDispatchSuccess(session, userData, dispatch, discordMemberData);
        } else if (event === 'SIGNED_OUT') {
          dispatch({ type: 'LOGOUT' });
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [discordMemberData]);

  const mapSessionToUser = (session: Session): User => {
    const { user } = session;
    const userData: User = {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };

    if (user.user_metadata) {
      userData.username = user.user_metadata.full_name || user.user_metadata.name;
      userData.full_name = user.user_metadata['custom_claims']['global_name'];
      userData.avatar_url = user.user_metadata.avatar_url;
      userData.discord_id = user.user_metadata.provider_id;
    }

    return userData;
  };

  const signInWithDiscord = async () => {
    try {
      dispatch({ type: 'LOGIN_START' });
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: {
          scopes: 'identify guilds guilds.members.read',
          redirectTo: `${import.meta.env.VITE_APP_URL}/dashboard`,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) { dispatch({ type: 'LOGIN_FAILURE', payload: 'Failed to sign in with Discord', error: error }) }
  };

  const signOut = async () => {
    try {
      dispatch({ type: 'LOGIN_START' });
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      dispatch({ type: 'LOGOUT' });
    } catch (error) { dispatch({ type: 'LOGIN_FAILURE', payload: 'Failed to sign out', error: error }) }
  };

  return (
    <AuthContext.Provider
      value={{
        state: { ...state, discordMemberData },
        dispatch,
        signInWithDiscord,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

const useDiscordGuildMemberData = (loading?: boolean) => useQuery({
  queryKey: ['discord-guild-member-data'],
  queryFn: async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    const guildId = import.meta.env.VITE_BRACKEYS_GUILD_ID;

    if (error) throw error;
    if (!guildId) throw new Error('VITE_BRACKEYS_GUILD_ID is not set in environment variables');
    if (!session?.provider_token) throw new Error('Access token is required');

    const response = await axios.get<DiscordGuildMemberData>(
      `https://discord.com/api/users/@me/guilds/${guildId}/member`,
      {
        headers: {
          Authorization: `Bearer ${session?.provider_token}`,
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
    }

    return response.data;
  },
  enabled: !loading,
  retry: false,
  staleTime: 1 * 60 * 60000, // 1 hour
});

const discordRoleMap: Record<string, string> = {
  'brackeys': '491536338525356042',
  'admin': '451380371284557824',
  'staff': '756285704061059213',
  'moderator': '756178968901582859',
}

const generateHasuraClaims = (discordRoles: string[] = []): HasuraClaims => {
  const allowedRoles = Object.keys(discordRoleMap).filter(roleName =>
    discordRoles.includes(discordRoleMap[roleName])
  );

  // Start with 'user' as default role, elevate if they have special roles
  const defaultRole = allowedRoles.length > 0 ? allowedRoles[0] : 'user';

  return {
    defaultRole: defaultRole,
    allowedRoles: ['user', ...allowedRoles],
  };
};

const updateDiscordProviderDataAndDispatchSuccess = async (session: Session, user: User, dispatch: Dispatch<AuthAction>, discordMemberData?: DiscordGuildMemberData) => {
  const guildId = import.meta.env.VITE_BRACKEYS_GUILD_ID;
  let hasuraClaims: HasuraClaims | undefined;

  if (session.provider_token && guildId) {
    try {
      if (discordMemberData) {
        hasuraClaims = generateHasuraClaims(discordMemberData.roles);

        // Update avatar URL if guild-specific avatar exists
        if (discordMemberData.avatar) {
          user = {
            ...user,
            avatar_url: `https://cdn.discordapp.com/guilds/${guildId}/users/${user.discord_id}/avatars/${discordMemberData.avatar}.webp?size=160`
          };
        }
      }
    } catch (error) {
      console.error('Failed to fetch Discord guild member data:', error);
      // Continue with login even if Discord data fetch fails
    }
  }

  // If we don't have Discord data, generate default Hasura claims
  if (!hasuraClaims && user.id) {
    hasuraClaims = generateHasuraClaims([]);
  }

  dispatch({
    type: 'LOGIN_SUCCESS',
    payload: {
      user,
      discordMemberData,
      hasuraClaims
    }
  });
}