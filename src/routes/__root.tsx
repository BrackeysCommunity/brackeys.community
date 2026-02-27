import { TanStackDevtools } from '@tanstack/react-devtools'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  redirect,
  Scripts,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import Dither from '@/components/Dither'
import { AppHeader } from '@/components/layout/AppHeader'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { Cursor } from '@/components/ui/cursor'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommandPaletteProvider } from '@/lib/hooks/use-command-palette'
import { PageLayoutProvider, useCurrentSidebar } from '@/lib/hooks/use-page-layout'
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
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang={getLocale()} className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="h-screen flex flex-col overflow-hidden min-w-[1024px]">
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
        <div className="relative z-[1] flex flex-col flex-1 overflow-hidden pointer-events-none">
          <TanStackQueryProvider>
            <TooltipProvider>
              <CommandPaletteProvider>
                <PageLayoutProvider>
                  <CommandPalette />
                  <AppHeader />
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
        <Scripts />
      </body>
    </html>
  )
}

function TwoColumnShell({ children }: { children: React.ReactNode }) {
  const sidebar = useCurrentSidebar()

  return (
    <div className="flex flex-1 overflow-hidden pt-[57px]">
      {/* Left column — main page content */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col pointer-events-auto">
        {children}
      </div>

      {/* Right column — page-specific sidebar */}
      <aside className="flex-1 min-w-0 flex flex-col overflow-hidden pointer-events-auto">
        {sidebar}
      </aside>
    </div>
  )
}
