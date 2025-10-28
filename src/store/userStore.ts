import { Store } from '@tanstack/react-store';

// Core user data types
export interface UserEmail {
  id: string;
  emailAddress: string;
  isPrimary: boolean;
  verification: {
    status: string;
    strategy: string;
  };
}

export interface DiscordExternalAccount {
  id: string;
  provider: 'discord';
  discordId: string;
  emailAddress: string;
  approvedScopes: string;
  firstName: string;
  lastName: string;
  imageUrl: string;
  username: string;
  verification: {
    status: string;
    strategy: string;
  };
}

export interface DiscordGuildMemberData {
  inGuild: boolean;
  roles?: string[];
  joined_at?: string;
  premium_since?: string | null;
  nick?: string | null;
  avatar?: string;
  banner?: string | null;
  communication_disabled_until?: string | null;
  flags?: number;
  pending?: boolean;
  unusual_dm_activity_until?: string | null;
  mute?: boolean;
  deaf?: boolean;
  bio?: string;
}

export interface HasuraClaims {
  defaultRole: string;
  allowedRoles: string[];
}

export interface ActiveUser {
  // Core Clerk user data
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  imageUrl: string;
  hasImage: boolean;

  // Email data
  primaryEmailAddress: string | null;
  emailAddresses: UserEmail[];

  // Discord data
  discord: {
    externalAccount: DiscordExternalAccount | null;
    guildMember: DiscordGuildMemberData | null;
  };

  // Hasura integration
  hasura: HasuraClaims;

  // Timestamps
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;

  // Auth state
  twoFactorEnabled: boolean;
}

export interface UserStoreState {
  user: ActiveUser | null;
  isLoading: boolean;
  isSignedIn: boolean;
  error: string | null;
}

// Initial state
export const initialUserState: UserStoreState = {
  user: null,
  isLoading: true,
  isSignedIn: false,
  error: null,
};

// Create the store
export const userStore = new Store<UserStoreState>(initialUserState);

// Store actions
export const userStoreActions = {
  setLoading: (isLoading: boolean) => {
    userStore.setState((state) => ({
      ...state,
      isLoading,
    }));
  },

  setUser: (user: ActiveUser | null) => {
    userStore.setState((state) => ({
      ...state,
      user,
      isSignedIn: user !== null,
      isLoading: false,
      error: null,
    }));
  },

  setError: (error: string | null) => {
    userStore.setState((state) => ({
      ...state,
      error,
      isLoading: false,
    }));
  },

  clearError: () => {
    userStore.setState((state) => ({
      ...state,
      error: null,
    }));
  },

  reset: () => {
    userStore.setState(initialUserState);
  },

  signOut: () => {
    userStore.setState({
      user: null,
      isLoading: false,
      isSignedIn: false,
      error: null,
    });
  },
};
