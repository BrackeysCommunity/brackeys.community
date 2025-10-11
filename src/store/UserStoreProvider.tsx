import { useEffect, type PropsWithChildren } from 'react';
import { useUser as useClerkUser } from '@clerk/tanstack-react-start';
import { userStoreActions } from './userStore';
import type {
  ActiveUser,
  DiscordExternalAccount,
  DiscordGuildMemberData,
  HasuraClaims,
  UserEmail,
} from './userStore';

/**
 * Provider component that syncs Clerk user data with the TanStack Store.
 * This should be placed within the ClerkProvider in your component tree.
 * 
 * It automatically updates the store whenever Clerk's user state changes.
 */
export function UserStoreProvider({ children }: PropsWithChildren) {
  const { user: clerkUser, isLoaded } = useClerkUser();

  useEffect(() => {
    // Start loading
    if (!isLoaded) {
      userStoreActions.setLoading(true);
      return;
    }

    // User signed out
    if (!clerkUser) {
      userStoreActions.signOut();
      return;
    }

    try {
      // Extract Discord external account
      const discordAccount = clerkUser.externalAccounts.find(
        (acc) => acc.provider === 'discord',
      );

      const discordExternalAccount: DiscordExternalAccount | null = discordAccount
        ? {
            id: discordAccount.id,
            provider: 'discord',
            discordId: discordAccount.providerUserId || '',
            emailAddress: discordAccount.emailAddress,
            approvedScopes: discordAccount.approvedScopes,
            firstName: discordAccount.firstName || '',
            lastName: discordAccount.lastName || '',
            imageUrl: discordAccount.imageUrl || '',
            username: discordAccount.username || '',
            verification: {
              status: discordAccount.verification?.status || 'unverified',
              strategy: discordAccount.verification?.strategy || '',
            },
          }
        : null;

      // Extract Discord guild member data from public metadata
      const publicMetadata = clerkUser.publicMetadata as {
        hasura?: {
          defaultRole?: string;
          allowedRoles?: string[];
        };
        discord?: DiscordGuildMemberData;
      };

      const discordGuildMember: DiscordGuildMemberData | null =
        publicMetadata?.discord ?? null;

      // Extract Hasura claims
      const hasuraClaims: HasuraClaims = {
        defaultRole: publicMetadata?.hasura?.defaultRole || 'user',
        allowedRoles: publicMetadata?.hasura?.allowedRoles || ['user'],
      };

      // Map email addresses
      const emailAddresses: UserEmail[] = clerkUser.emailAddresses.map((email) => ({
        id: email.id,
        emailAddress: email.emailAddress,
        isPrimary: email.id === clerkUser.primaryEmailAddressId,
        verification: {
          status: email.verification?.status || 'unverified',
          strategy: email.verification?.strategy || '',
        },
      }));

      // Build the active user object
      const activeUser: ActiveUser = {
        // Core Clerk data
        id: clerkUser.id,
        username: clerkUser.username || discordExternalAccount?.username || null,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
        fullName: clerkUser.fullName,
        imageUrl: clerkUser.imageUrl,
        hasImage: clerkUser.hasImage,

        // Email data
        primaryEmailAddress: clerkUser.primaryEmailAddress?.emailAddress || null,
        emailAddresses,

        // Discord data
        discord: {
          externalAccount: discordExternalAccount,
          guildMember: discordGuildMember,
        },

        // Hasura integration
        hasura: hasuraClaims,

        // Timestamps
        createdAt: clerkUser.createdAt ? new Date(clerkUser.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: clerkUser.updatedAt ? new Date(clerkUser.updatedAt).toISOString() : new Date().toISOString(),
        lastSignInAt: clerkUser.lastSignInAt
          ? new Date(clerkUser.lastSignInAt).toISOString()
          : null,

        // Auth state
        twoFactorEnabled: clerkUser.twoFactorEnabled,
      };

      // Update the store
      userStoreActions.setUser(activeUser);

      // Debug logging in development
      if (import.meta.env.DEV) {
        console.log('=== User Store Updated ===');
        console.log('User ID:', activeUser.id);
        console.log('Username:', activeUser.username);
        console.log('Discord Account:', discordExternalAccount);
        console.log('Discord Guild Member:', discordGuildMember);
        console.log('Hasura Claims:', hasuraClaims);
        console.log('=========================');
      }
    } catch (error) {
      console.error('Error syncing user data to store:', error);
      userStoreActions.setError('Failed to sync user data');
    }
  }, [clerkUser, isLoaded]);

  return <>{children}</>;
}

