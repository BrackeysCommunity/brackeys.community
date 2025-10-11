import { useStore } from '@tanstack/react-store';
import { userStore, type UserStoreState, type ActiveUser } from './userStore';

/**
 * Hook to access the active user from the store.
 * This is the primary way to access user data throughout the application.
 * 
 * @returns The user store state including user data, loading state, and auth status
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { user, isLoading, isSignedIn } = useActiveUser();
 *   
 *   if (isLoading) return <div>Loading...</div>;
 *   if (!isSignedIn) return <div>Please sign in</div>;
 *   
 *   return <div>Hello {user.username}!</div>;
 * }
 * ```
 */
export function useActiveUser(): UserStoreState {
  return useStore(userStore);
}

/**
 * Hook to access only the user object from the store.
 * Use this when you only need the user data and not the loading/error states.
 * 
 * @returns The active user object or null if not signed in
 */
export function useUser(): ActiveUser | null {
  return useStore(userStore, (state) => state.user);
}

/**
 * Hook to check if a user is signed in.
 * 
 * @returns Boolean indicating if a user is currently signed in
 */
export function useIsSignedIn(): boolean {
  return useStore(userStore, (state) => state.isSignedIn);
}

/**
 * Hook to check if user data is currently loading.
 * 
 * @returns Boolean indicating if user data is loading
 */
export function useUserLoading(): boolean {
  return useStore(userStore, (state) => state.isLoading);
}

/**
 * Hook to access Discord-specific user data.
 * 
 * @returns Discord data or null if not available
 */
export function useDiscordData() {
  return useStore(userStore, (state) => state.user?.discord ?? null);
}

/**
 * Hook to access Hasura claims for the current user.
 * 
 * @returns Hasura claims or null if not available
 */
export function useHasuraClaims() {
  return useStore(userStore, (state) => state.user?.hasura ?? null);
}

