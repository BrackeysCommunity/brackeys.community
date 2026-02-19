import { TanStackDevtools } from '@tanstack/react-devtools'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  redirect,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { AppHeader } from '@/components/layout/AppHeader'
import { Cursor } from '@/components/ui/cursor'
import { TooltipProvider } from '@/components/ui/tooltip'
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
      <body className="min-h-screen flex flex-col">
        <Cursor />
        <TanStackQueryProvider>
          <TooltipProvider>
            <AppHeader />
            <div className="flex flex-col flex-1 pt-16">
              {children}
            </div>
            <TanStackDevtools
              config={{ position: 'bottom-right' }}
              plugins={[
                { name: 'Tanstack Router', render: <TanStackRouterDevtoolsPanel /> },
                TanStackQueryDevtools,
                StoreDevtools,
              ]}
            />
          </TooltipProvider>
        </TanStackQueryProvider>
        <Scripts />
      </body>
    </html>
  )
}
