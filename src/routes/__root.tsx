import { TanStackDevtools } from '@tanstack/react-devtools'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  redirect,
  Scripts,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { lazy, Suspense } from 'react'
import Dither from '@/components/Dither'
import { CommandPalette } from '@/components/layout/CommandPalette'

const AppHeader = lazy(() => import('@/components/layout/AppHeader').then(m => ({ default: m.AppHeader })))

import { Cursor } from '@/components/ui/cursor'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommandPaletteProvider } from '@/lib/hooks/use-command-palette'
import { PageLayoutProvider, useCurrentSidebar, useMobileMode } from '@/lib/hooks/use-page-layout'
import { getLocale, shouldRedirect } from '@/paraglide/runtime'
import fontsCss from '../fonts.css?url'
import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'
import TanStackQueryProvider from '../integrations/tanstack-query/root-provider'
import StoreDevtools from '../lib/demo-store-devtools'
import appCss from '../styles.css?url'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: async ({ location }) => {
    const decision = await shouldRedirect({ url: location.href })
    if (decision.shouldRedirect) {
      throw redirect({ href: decision.redirectUrl?.href })
    }

    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', getLocale())
    }
  },

  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Brackeys Community' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/brackeys-logo.svg', media: '(prefers-color-scheme: light)' },
      { rel: 'icon', type: 'image/svg+xml', href: '/brackeys-logo-inverted.svg', media: '(prefers-color-scheme: dark)' },
      { rel: 'stylesheet', href: fontsCss },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  shellComponent: RootDocument,
  errorComponent: RouteErrorBoundary,
  pendingComponent: RoutePendingFallback,
})

function RouteErrorBoundary({ error }: { error: Error }) {
  return (
    <div className="flex flex-1 items-center justify-center p-12 pointer-events-auto">
      <div className="text-center space-y-4 max-w-md">
        <p className="font-mono text-sm tracking-[0.2em] text-destructive uppercase">{'// SYSTEM ERROR'}</p>
        <p className="font-mono text-xs text-muted-foreground">{error.message || 'An unexpected error occurred.'}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="font-mono text-xs text-primary border border-primary/40 px-4 py-2 hover:bg-primary/10 transition-colors uppercase tracking-widest"
        >
          Reload
        </button>
      </div>
    </div>
  )
}

function RoutePendingFallback() {
  return (
    <div className="flex flex-1 items-center justify-center p-12">
      <span className="font-mono text-xs text-muted-foreground animate-pulse tracking-widest uppercase">
        Loading...
      </span>
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang={getLocale()} className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="h-screen flex flex-col overflow-hidden">
        <Cursor />
        {/* <GridBackground /> */}
        <Dither
          waveColor={[0.2, 0.22, 0.55]}
          disableAnimation={false}
          enableMouseInteraction
          mouseRadius={0.3}
          colorNum={4}
          waveAmplitude={0.3}
          waveFrequency={3}
          waveSpeed={0.04}
        />
        {/* CRT scanline overlay */}
        <div
          className="fixed inset-0 z-55 pointer-events-none opacity-10 animate-scanlines"
          style={{
            background:
              'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.2))',
            backgroundSize: '100% 4px',
          }}
        />
        <div className="relative z-1 flex flex-col flex-1 min-h-0 overflow-hidden pointer-events-none">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-9999 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:font-mono focus:text-xs focus:tracking-widest focus:uppercase focus:pointer-events-auto"
          >
            Skip to content
          </a>
          <TanStackQueryProvider>
            <TooltipProvider>
              <CommandPaletteProvider>
                <PageLayoutProvider>
                  <CommandPalette />
                  <Suspense>
                    <AppHeader />
                  </Suspense>
                  <TwoColumnShell>{children}</TwoColumnShell>
                  <TanStackDevtools
                    config={{ position: 'bottom-right' }}
                    plugins={[
                      { name: 'Tanstack Router', render: <TanStackRouterDevtoolsPanel /> },
                      TanStackQueryDevtools,
                      StoreDevtools,
                    ]}
                  />
                </PageLayoutProvider>
              </CommandPaletteProvider>
            </TooltipProvider>
          </TanStackQueryProvider>
        </div>
        <Toaster position="bottom-right" style={{ zIndex: 9999 }} />
        <Scripts />
      </body>
    </html>
  )
}

function TwoColumnShell({ children }: { children: React.ReactNode }) {
  const sidebar = useCurrentSidebar()
  const mobileMode = useMobileMode()
  const showContentOnMobile = mobileMode === 'content'

  return (
    <div id="main-content" className="flex flex-1 overflow-hidden pt-[57px] pointer-events-none max-w-[1920px] w-full mx-auto">
      {/* Left column — main page content */}
      <div className={`flex-1 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${showContentOnMobile ? '' : 'hidden lg:flex'}`}>
        <div className="flex w-full min-h-full flex-col justify-center p-4 sm:p-6 lg:p-12 xl:p-16 selection:bg-primary selection:text-white">
          {children}
        </div>
      </div>

      {/* Right column — page-specific sidebar */}
      <aside className={`w-full flex-1 flex shrink-0 overflow-hidden justify-center ${showContentOnMobile ? 'hidden lg:flex' : ''}`}>
        <div className="max-w-2xl min-w-0 xl:min-w-xl w-full h-full flex flex-col">
          {sidebar}
        </div>
      </aside>
    </div>
  )
}
