# Clerk Integration with TanStack Start

## Current Approach: Provider-Based (Correct)

Clerk does **not** have official TanStack Start middleware yet, so we use the **provider-based approach**:

### Architecture

```
__root.tsx (shellComponent)
  └─ ClerkProvider (@clerk/clerk-react)
      └─ ClerkAuthProvider (custom - extracts Discord data)
          └─ LayoutProvider
              └─ App content
```

### Implementation

**1. Root Document (`src/routes/__root.tsx`)**
```typescript
<ClerkProvider
  publishableKey={PUBLISHABLE_KEY}
  appearance={{ variables: { colorPrimary: '#10b981' } }}
  afterSignOutUrl="/"
  signInFallbackRedirectUrl="/profile"
  signUpFallbackRedirectUrl="/auth/entry"
  signInForceRedirectUrl="/auth/entry"
  signUpForceRedirectUrl="/auth/entry"
>
  <ClerkAuthProvider>
    {/* Rest of app */}
  </ClerkAuthProvider>
</ClerkProvider>
```

**2. Custom Auth Provider (`src/context/ClerkAuthProvider.tsx`)**
- Wraps Clerk's `useUser`, `useClerk`, `useSignIn` hooks
- Extracts Discord data from Clerk metadata
- Provides `signInWithDiscord()` and `signOut()` methods
- Manages auth state with useReducer

**3. Auth Context (`src/context/useAuth.ts`)**
- Provides `useAuth()` hook for components
- Returns user data, Discord metadata, Hasura claims

### Why Not Middleware?

**Pros of Provider Approach:**
- ✅ Works with Clerk's React hooks (`useUser`, `useClerk`, etc.)
- ✅ Client-side auth state is reactive
- ✅ Easy to access auth in any component via `useAuth()`
- ✅ Clerk's built-in components work (UserProfile, SignIn, etc.)

**Cons of Provider Approach:**
- ⚠️ Not available in server functions/loaders by default
- ⚠️ Requires workarounds for SSR auth checks

### Server-Side Auth Checks

For routes that need server-side auth protection, use `beforeLoad`:

```typescript
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/protected')({
  component: ProtectedPage,
  beforeLoad: async ({ context, location }) => {
    // Note: This runs on both server and client
    // For pure server-side checks, you'd need Clerk server SDK
    
    // Client-side check (works in browser)
    if (typeof window !== 'undefined') {
      // Use Clerk client hooks
    }
    
    // For now, we rely on client-side auth guard components
  },
});
```

### Client-Side Auth Guards

For client-side protection, use the `AuthGuard` component:

```typescript
// src/pages/Profile.tsx
import { AuthGuard } from '@/components/auth/AuthGuard';

export const Profile = () => {
  return (
    <AuthGuard>
      <ProfileContent />
    </AuthGuard>
  );
};
```

The `AuthGuard` component:
- Checks if user is authenticated via `useAuth()`
- Redirects to `/login` if not authenticated
- Shows loading state while checking

### Discord OAuth Flow

**Current Implementation:**

1. User clicks "Sign in with Discord" → `signInWithDiscord()` called
2. Clerk handles OAuth redirect to Discord
3. Discord auth callback → Clerk processes
4. Webhook fires (`/api/webhooks/clerk` POST endpoint)
5. Webhook syncs Discord roles → Updates Clerk metadata
6. User redirected to `/auth/entry`
7. AuthEntry validates guild membership
8. Redirect to dashboard if in guild

**Server Route for Webhook:**

```typescript
// src/routes/api/webhooks/clerk.tsx
export const Route = createFileRoute('/api/webhooks/clerk')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json();
        // Verify Svix signature
        // Handle user.created, session.created events
        // Call Discord API to sync roles
        return json({ received: true });
      },
    },
  },
});
```

### Future: If Clerk Releases TanStack Start Middleware

When/if Clerk releases official middleware, we'd migrate to:

```typescript
// src/app/global-middleware.ts
import { clerkMiddleware } from '@clerk/tanstack-start';
import { createMiddleware } from '@tanstack/react-start';

export const authMiddleware = createMiddleware().server(
  clerkMiddleware({
    // Configuration
  })
);
```

Then use in route context:

```typescript
export const Route = createFileRoute('/profile')({
  beforeLoad: async ({ context }) => {
    if (!context.auth.userId) {
      throw redirect({ to: '/login' });
    }
  },
  loader: async ({ context }) => {
    // context.auth.userId available here
  },
});
```

But for now, **provider-based approach is correct and working**! ✅

## Summary

**Current Setup (Correct):**
- ✅ ClerkProvider in root document
- ✅ ClerkAuthProvider for Discord data extraction
- ✅ useAuth() hook for components
- ✅ AuthGuard component for client-side protection
- ✅ Server routes for webhooks (`/api/webhooks/clerk`)

**Not Using:**
- ❌ Clerk middleware (doesn't exist yet for TanStack Start)
- ❌ Server-side auth context injection (not needed with current approach)

The migration is using the **correct pattern** for Clerk + TanStack Start! 🎯

