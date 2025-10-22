import { ClerkProvider } from '@clerk/tanstack-react-start';
import { TanStackDevtools } from '@tanstack/react-devtools';
import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Scripts,
} from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import type { PropsWithChildren } from 'react';
import { Toaster } from 'sonner';
import { MainLayout } from '@/components/layout/MainLayout';
import { LayoutProvider } from '@/context/LayoutProvider';
import TanStackQueryDevtools from '@/integrations/tanstack-query/devtools';
import { clerkAppearance } from '@/lib/clerk-theme';
import { UserStoreProvider } from '@/store';
import appCss from '@/styles.css?url';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Add Clerk Publishable Key to the .env.local file');
}

interface MyRouterContext {
  queryClient: QueryClient;
}

const RootDocument = ({ children }: PropsWithChildren) => {
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      appearance={clerkAppearance}
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/profile"
      signUpFallbackRedirectUrl="/auth/entry"
      signInForceRedirectUrl="/auth/entry"
      signUpForceRedirectUrl="/auth/entry"
    >
      <html lang="en">
        <head>
          <HeadContent />
        </head>
        <body>
          <UserStoreProvider>
            <LayoutProvider>
              <MainLayout>
                {children}
                <Toaster
                  position="bottom-left"
                  expand={false}
                  duration={7000}
                  visibleToasts={5}
                  className="!font-sans"
                />
              </MainLayout>
              {import.meta.env.DEV && (
                <TanStackDevtools
                  config={{
                    position: 'bottom-right',
                  }}
                  plugins={[
                    {
                      name: 'Tanstack Router',
                      render: <TanStackRouterDevtoolsPanel />,
                    },
                    TanStackQueryDevtools,
                  ]}
                />
              )}
            </LayoutProvider>
          </UserStoreProvider>
          <Scripts />
        </body>
      </html>
    </ClerkProvider>
  );
};

const NotFound = () => {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-4 text-6xl font-bold">404</h1>
      <h2 className="mb-4 text-2xl font-semibold">Page Not Found</h2>
      <p className="mb-8 text-muted-foreground">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link
        to="/"
        className="rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Go Home
      </Link>
    </div>
  );
};

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Brackeys Community',
      },
      {
        name: 'description',
        content:
          'A community for developers of all skill levels to learn, share, and collaborate.',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        href: '/svg/brackeys-logo.svg',
      },
    ],
  }),

  shellComponent: RootDocument,
  notFoundComponent: NotFound,
});
