import { useReducer, useEffect, PropsWithChildren, Dispatch } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AuthState, AuthAction, User, AuthContext, authInitialState, DiscordGuildMemberData } from './authContext';
import axios from 'axios';

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, isLoading: true, error: undefined };
    case 'LOGIN_SUCCESS':
      return { ...state, isLoading: false, user: action.payload, error: undefined };
    case 'LOGIN_FAILURE':
      return { ...state, isLoading: false, error: action.payload };
    case 'LOGOUT':
      return { ...state, user: undefined, isLoading: false };
    case 'CLEAR_ERROR':
      return { ...state, error: undefined };
    default:
      return state;
  }
}

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [state, dispatch] = useReducer(authReducer, authInitialState);

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
          updateDiscordProviderDataAndDispatchSuccess(session, userData, dispatch);
        } else {
          dispatch({ type: 'LOGOUT' });
        }
      } catch (error) {
        console.error('Error fetching session:', error);
        dispatch({ type: 'LOGIN_FAILURE', payload: 'Failed to authenticate' });
      }
    };

    fetchInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          const userData = mapSessionToUser(session);
          updateDiscordProviderDataAndDispatchSuccess(session, userData, dispatch);
        } else if (event === 'SIGNED_OUT') {
          dispatch({ type: 'LOGOUT' });
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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
    } catch (error) {
      console.error('Discord login error:', error);
      dispatch({
        type: 'LOGIN_FAILURE',
        payload: 'Failed to sign in with Discord'
      });
    }
  };

  const signOut = async () => {
    try {
      dispatch({ type: 'LOGIN_START' });
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      dispatch({ type: 'LOGOUT' });
    } catch (error) {
      console.error('Logout error:', error);
      dispatch({
        type: 'LOGIN_FAILURE',
        payload: 'Failed to sign out'
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

const fetchDiscordGuildMemberData = async (accessToken: string) => {
  const guildId = import.meta.env.VITE_BRACKEYS_GUILD_ID;

  if (!guildId) {
    console.error('VITE_BRACKEYS_GUILD_ID is not set in environment variables');
    return null;
  }

  try {
    const response = await axios.get<DiscordGuildMemberData>(
      `https://discord.com/api/users/@me/guilds/${guildId}/member`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
    }

    return response.data;
  } catch (error) {
    console.error('Error fetching Discord guild member data:', error);
    return null;
  }
};

const updateDiscordProviderDataAndDispatchSuccess = async (session: Session, payload: User, dispatch: Dispatch<AuthAction>) => {
  const guildId = import.meta.env.VITE_BRACKEYS_GUILD_ID;

  // Check if we already have guild member data to prevent redundant API calls
  const hasGuildData = session.user.user_metadata?.[guildId];

  if (session.provider_token && guildId && !hasGuildData) {
    const guildMemberData = await fetchDiscordGuildMemberData(session.provider_token);

    if (guildMemberData) {
      payload = {
        ...payload,
        avatar_url: guildMemberData.avatar
          ? `https://cdn.discordapp.com/guilds/${guildId}/users/${payload.discord_id}/avatars/${guildMemberData.avatar}.webp?size=160`
          : payload.avatar_url,
        [guildId]: guildMemberData
      }
      const { error } = await supabase.auth.updateUser({
        data: payload
      });

      if (error) {
        console.error('Error updating user guild data:', error);
        dispatch({ type: 'LOGIN_FAILURE', payload: 'Failed to update user guild data' });
        return;
      }
    }
  }

  dispatch({ type: 'LOGIN_SUCCESS', payload });
}