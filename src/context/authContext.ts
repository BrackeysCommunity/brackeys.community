import { createContext } from "react";

export type User = {
  id: string;
  email?: string;
  username?: string;
  avatar_url?: string;
  full_name?: string;
  updated_at?: string;
  created_at?: string;
  discord_id?: string;
};

export interface DiscordGuildMemberData {
  avatar: string;
  banner: null;
  communication_disabled_until: null;
  flags: number;
  joined_at: Date;
  nick: null;
  pending: boolean;
  premium_since: null;
  roles: string[];
  unusual_dm_activity_until: null;
  user: User;
  mute: boolean;
  deaf: boolean;
  bio: string;
}

export type AuthState = {
  user?: User;
  isLoading: boolean;
  error?: string;
};

export type AuthAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; payload: User }
  | { type: 'LOGIN_FAILURE'; payload: string }
  | { type: 'LOGOUT' }
  | { type: 'CLEAR_ERROR' };

export const authInitialState: AuthState = {
  isLoading: true,
};

export const AuthContext = createContext<{
  state: AuthState;
  dispatch: React.Dispatch<AuthAction>;
  signInWithDiscord: () => Promise<void>;
  signOut: () => Promise<void>;
}>({
  state: authInitialState,
  dispatch: () => null,
  signInWithDiscord: async () => { },
  signOut: async () => { },
});