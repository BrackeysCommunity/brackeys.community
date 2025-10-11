import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { TanStackDevtools } from '@tanstack/react-devtools';
import { Toaster } from 'sonner';

import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

import { ClerkProvider } from '@clerk/tanstack-react-start';
import { UserStoreProvider } from '@/store';
import TanStackQueryDevtools from '@/integrations/tanstack-query/devtools';

import { LayoutProvider, useLayout } from '@/context/LayoutProvider';

import appCss from '@/styles.css?url';

import type { QueryClient } from '@tanstack/react-query';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env.local file');
}

interface MyRouterContext {
  queryClient: QueryClient;
}

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
        href: '/favicon.ico',
      },
    ],
  }),

  shellComponent: RootDocument,
});

function LayoutContent({ children }: { children: React.ReactNode }) {
  const { layoutProps } = useLayout();
  const {
    showHeader,
    showFooter,
    containerized,
    mainClassName,
    fullHeight,
  } = layoutProps;

  return (
    <>
      {showHeader && <Header />}
      <main
        className={
          fullHeight
            ? `flex flex-col ${mainClassName}`
            : containerized
              ? `container mx-auto ${mainClassName}`
              : mainClassName
        }
        style={fullHeight ? { minHeight: 'calc(100vh - 64px)' } : undefined}
      >
        {children}
      </main>
      {showFooter && <Footer />}
    </>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      appearance={{
        variables: { colorPrimary: '#10b981' },
      }}
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
              <LayoutContent>
                {children}
                <Toaster
                  position="bottom-left"
                  expand={false}
                  duration={7000}
                  visibleToasts={5}
                  className="!font-sans"
                />
            </LayoutContent>
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
}
