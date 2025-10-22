import * as Sentry from '@sentry/tanstackstart-react';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import * as TanstackQuery from './integrations/tanstack-query/root-provider';

// Import the generated route tree
import { routeTree } from './routeTree.gen';

/**
 * Route metadata mapping for display names and navigation visibility.
 *
 * When adding new routes:
 * 1. Add the exact route path as the key
 * 2. Provide a user-friendly displayName
 * 3. Set showInNav to true if it should appear in navigation when visited
 *
 * For dynamic routes (e.g., /tools/:id), add pattern matching in getRouteDisplayName()
 */
export type RouteMetadata = {
  displayName: string;
  showInNav?: boolean;
};

export const routeMetadata: Record<string, RouteMetadata> = {
  '/': { displayName: 'Home', showInNav: true },
  '/resources': { displayName: 'Cool Stuff', showInNav: true },
  '/collaboration-hub': { displayName: 'Collab', showInNav: true },
  '/profile': { displayName: 'Profile', showInNav: true },
  '/sandbox': { displayName: 'Sandbox', showInNav: true },
  '/login': { displayName: 'Login', showInNav: false },
  '/auth/entry': { displayName: 'Authentication', showInNav: false },
  '/collaborations': { displayName: 'Collaborations', showInNav: true },
  '/games/snake': { displayName: 'Snake Game', showInNav: true },
};

/**
 * Get the display name for a route path
 * Handles dynamic routes by matching patterns
 */
export function getRouteDisplayName(pathname: string): string {
  // Exact match first
  if (routeMetadata[pathname]) {
    return routeMetadata[pathname].displayName;
  }

  // Handle dynamic routes with parameters
  // Match /collaborations/:postId
  if (
    pathname.startsWith('/collaborations/') &&
    pathname.split('/').length === 3
  ) {
    return 'Collaboration';
  }

  // Match /tools/:toolId
  if (pathname.startsWith('/tools/') && pathname.split('/').length === 3) {
    return 'Tool';
  }

  // Match /games/* for any game routes
  if (pathname.startsWith('/games/')) {
    const gameName = pathname.split('/')[2];
    return gameName
      ? gameName.charAt(0).toUpperCase() + gameName.slice(1) + ' Game'
      : 'Game';
  }

  // Fallback: format the pathname
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return 'Home';

  return parts[0]
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Create a new router instance
export const getRouter = () => {
  const rqContext = TanstackQuery.getContext();

  Sentry.init({
    dsn: 'https://7caaab496e6d13d17da9ea78af2d53a2@o4510194671353856.ingest.us.sentry.io/4510195032457216',

    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: true,
  });

  const router = createTanStackRouter({
    routeTree,
    context: { ...rqContext },
    defaultPreload: 'intent',
    Wrap: (props: { children: React.ReactNode }) => {
      return (
        <TanstackQuery.Provider {...rqContext}>
          {props.children}
        </TanstackQuery.Provider>
      );
    },
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient: rqContext.queryClient,
  });

  return router;
};

// Export createRouter for TanStack Start compatibility
export function createRouter() {
  return getRouter();
}
