import * as Sentry from '@sentry/tanstackstart-react';
import { createMiddleware } from '@tanstack/react-start';

// Note: Clerk doesn't have official TanStack Start middleware yet.
// We use ClerkProvider in __root.tsx (context-based approach)
// For server-side auth checks, use route.beforeLoad hooks

// Sentry middleware for error tracking and instrumentation
export const sentryMiddleware = createMiddleware().server(
  Sentry.sentryGlobalServerMiddlewareHandler()
);
