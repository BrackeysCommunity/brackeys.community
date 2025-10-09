import { createRouter, createRoute, createRootRoute } from '@tanstack/react-router';
import { MainLayout } from './components/layout/MainLayout';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { NotFound } from './pages/NotFound';
import { Snake } from './components/games/snake/Snake';
import { ToolEmbed } from './pages/ToolEmbed';
import { Resources } from './pages/Resources';
import { Sandbox } from './pages/Sandbox';
import { Collaborations } from './pages/Collaborations';
import { CollaborationDetail } from './pages/CollaborationDetail';
import { CollaborationHub } from './pages/CollaborationHub';
import { AuthEntry } from './pages/AuthEntry';

const rootRoute = createRootRoute({
  component: MainLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: Dashboard,
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: Profile,
});

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '*',
  component: NotFound,
});

const snakeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/games/snake',
  component: Snake,
});

const resourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources',
  component: Resources,
});

const sandboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sandbox',
  component: Sandbox,
});

const toolEmbedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tools/$toolId',
  component: ToolEmbed,
});

const collaborationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/collaborations',
  component: Collaborations,
});

const collaborationDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/collaborations/$postId',
  component: CollaborationDetail,
});

const collaborationHubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/collaboration-hub',
  component: CollaborationHub,
});

const authEntryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/entry',
  component: AuthEntry,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  dashboardRoute,
  profileRoute,
  snakeRoute,
  resourcesRoute,
  sandboxRoute,
  collaborationsRoute,
  collaborationDetailRoute,
  collaborationHubRoute,
  authEntryRoute,
  toolEmbedRoute,
  notFoundRoute,
]);

export const router = createRouter({
  routeTree,
  scrollRestorationBehavior: 'instant',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
