# Auth Store Migration Guide

This document describes the migration from the old reducer/context-based auth system to the new TanStack Store-based system.

## What Changed

### Old System (Removed)
- `src/context/ClerkAuthProvider.tsx` - Reducer-based auth provider
- `src/context/authContext.ts` - Context and types
- `src/context/useAuth.ts` - Old hook to access auth
- `src/context/ContextProviders.tsx` - Wrapper component (unused)

### New System (Added)
- `src/store/userStore.ts` - TanStack Store definition with actions
- `src/store/useActiveUser.ts` - Hooks to access user data
- `src/store/UserStoreProvider.tsx` - Provider that syncs Clerk → Store
- `src/store/authHelpers.ts` - Helper functions for auth actions
- `src/store/index.ts` - Barrel export

## Key Improvements

1. **Modern State Management**: Uses TanStack Store instead of reducers
2. **Better TypeScript**: Comprehensive type definitions for all user data
3. **Granular Hooks**: Multiple hooks for specific data access patterns
4. **Cleaner API**: Simpler, more intuitive API surface
5. **Extended Discord Data**: Stores more Discord information for future use

## Migration Examples

### Before (Old Hook)
```tsx
import { useAuth } from '../context/useAuth';

function MyComponent() {
  const { state: { user, isLoading }, signOut } = useAuth();
  // ...
}
```

### After (New Hooks)
```tsx
import { useActiveUser, useAuthHelpers } from '../store';

function MyComponent() {
  const { user, isLoading } = useActiveUser();
  const { signOut } = useAuthHelpers();
  // ...
}
```

## Available Hooks

### `useActiveUser()`
Returns the complete user store state including:
- `user`: The active user object or null
- `isLoading`: Boolean loading state
- `isSignedIn`: Boolean auth status
- `error`: Error string if any

**Use this when you need multiple pieces of state.**

```tsx
const { user, isLoading, isSignedIn } = useActiveUser();
```

### `useUser()`
Returns only the user object.

**Use this when you only need user data.**

```tsx
const user = useUser();
```

### `useIsSignedIn()`
Returns boolean indicating if user is signed in.

```tsx
const isSignedIn = useIsSignedIn();
```

### `useUserLoading()`
Returns boolean indicating loading state.

```tsx
const isLoading = useUserLoading();
```

### `useDiscordData()`
Returns Discord-specific data including external account and guild member info.

```tsx
const discord = useDiscordData();
// discord.externalAccount - Discord OAuth account
// discord.guildMember - Guild membership data
```

### `useHasuraClaims()`
Returns Hasura role claims for the user.

```tsx
const hasuraClaims = useHasuraClaims();
// hasuraClaims.defaultRole
// hasuraClaims.allowedRoles
```

### `useAuthHelpers()`
Returns authentication helper functions.

```tsx
const { signInWithDiscord, signOut } = useAuthHelpers();
```

## User Data Structure

The new `ActiveUser` type provides structured access to all user data:

```typescript
interface ActiveUser {
  // Core Clerk data
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
```

## Key Property Changes

| Old Property | New Property | Notes |
|--------------|--------------|-------|
| `user.email` | `user.primaryEmailAddress` | More descriptive |
| `user.avatar_url` | `user.imageUrl` | Matches Clerk convention |
| `user.discord_id` | `user.discord.externalAccount.providerUserId` | More structured |
| `state.discordMemberData` | `user.discord.guildMember` | Nested in user object |
| `state.hasuraClaims` | `user.hasura` | Nested in user object |

## Files Updated

The following files were updated to use the new store:

- All page components (`src/pages/*.tsx`)
- All auth components (`src/components/auth/*.tsx`)
- Header component (`src/components/layout/Header.tsx`)
- Discord profile button (`src/components/ui/DiscordProfileButton.tsx`)
- GraphQL hooks (`src/hooks/useGraphQL.tsx`)
- Auth headers hook (`src/hooks/query/useAuthHeaders.ts`)
- Discord sync hook (`src/hooks/useDiscordSync.ts`)
- Clerk integration provider (`src/integrations/clerk/provider.tsx`)

## Best Practices

1. **Use Granular Hooks**: Use `useUser()` or `useIsSignedIn()` when you only need specific data to avoid unnecessary re-renders.

2. **Access Nested Data Safely**: Discord data may be null, always check:
   ```tsx
   const user = useUser();
   const discordId = user?.discord?.externalAccount?.providerUserId;
   ```

3. **Reload After Sync**: The store automatically updates when Clerk user changes. For manual syncs (like Discord roles), call `clerkUser.reload()`:
   ```tsx
   const { user: clerkUser } = useAuth(); // Clerk's hook
   await clerkUser?.reload(); // Triggers store update
   ```

## Testing

After migration, test these scenarios:
1. Sign in with Discord
2. View profile page with Discord data
3. Sync Discord roles
4. Sign out
5. Access protected routes
6. View user avatar and info in header

## Troubleshooting

### "Cannot read property 'discord' of null"
Make sure to check if user exists before accessing nested properties:
```tsx
const user = useUser();
if (!user) return null;
const discordData = user.discord;
```

### Store not updating after auth change
The `UserStoreProvider` automatically syncs with Clerk's `useUser()` hook. If data seems stale, verify:
1. `UserStoreProvider` is in the component tree
2. Clerk's `ClerkProvider` wraps the `UserStoreProvider`
3. Check browser console for sync errors

### Type errors with user properties
Update property access to match new structure (see "Key Property Changes" table above).

## Future Enhancements

The new store system enables:
- Offline auth state caching
- Optimistic updates
- Advanced Discord integration features
- Custom metadata storage
- Multi-tenant support

## Questions?

If you encounter issues or have questions about the migration, check the type definitions in `src/store/userStore.ts` for the complete data structure.

