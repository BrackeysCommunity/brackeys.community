import { createRouter, createRoute, createRootRoute } from '@tanstack/react-router';
import { MainLayout } from './components/layout/MainLayout';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { NotFound } from './pages/NotFound';
import { Snake } from './components/games/snake/Snake';
import { Api } from './pages/Api';
import { ToolEmbed } from './pages/ToolEmbed';
import { Resources } from './pages/Resources';
import { Sandbox } from './pages/Sandbox';

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

const apiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/api',
  component: Api,
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  dashboardRoute,
  profileRoute,
  apiRoute,
  snakeRoute,
  resourcesRoute,
  sandboxRoute,
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
