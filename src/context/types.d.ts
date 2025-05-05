type User = {
  id: string;
  email?: string;
  username?: string;
  avatar_url?: string;
  full_name?: string;
  updated_at?: string;
  created_at?: string;
  discord_id?: string;
};

type AuthState = {
  user: User | null;
  isLoading: boolean;
  error: string | null;
};

type AuthAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; payload: User }
  | { type: 'LOGIN_FAILURE'; payload: string }
  | { type: 'LOGOUT' }
  | { type: 'CLEAR_ERROR' };