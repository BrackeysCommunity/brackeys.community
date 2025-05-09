import { createRouter, createRoute, createRootRoute } from '@tanstack/react-router';
import { MainLayout } from './components/layout/MainLayout';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Games } from './pages/Games';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { NotFound } from './pages/NotFound';
import { Snake } from './components/games/snake/Snake';
import { Api } from './pages/Api';

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

const gamesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/games',
  component: Games,
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  gamesRoute,
  dashboardRoute,
  profileRoute,
  apiRoute,
  snakeRoute,
  notFoundRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
