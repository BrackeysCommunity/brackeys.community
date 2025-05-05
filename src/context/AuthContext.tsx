import { createContext, useReducer, useContext, useEffect, PropsWithChildren } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const initialState: AuthState = {
  user: null,
  isLoading: true,
  error: null,
};

const AuthContext = createContext<{
  state: AuthState;
  dispatch: React.Dispatch<AuthAction>;
  signInWithDiscord: () => Promise<void>;
  signOut: () => Promise<void>;
}>({
  state: initialState,
  dispatch: () => null,
  signInWithDiscord: async () => { },
  signOut: async () => { },
});

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, isLoading: true, error: null };
    case 'LOGIN_SUCCESS':
      return { ...state, isLoading: false, user: action.payload, error: null };
    case 'LOGIN_FAILURE':
      return { ...state, isLoading: false, error: action.payload };
    case 'LOGOUT':
      return { ...state, user: null, isLoading: false };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

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
          dispatch({ type: 'LOGIN_SUCCESS', payload: userData });
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
          dispatch({ type: 'LOGIN_SUCCESS', payload: userData });
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

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};