import { TanStackDevtools } from '@tanstack/react-devtools'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  redirect,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { Cursor } from '@/components/ui/cursor'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getLocale, shouldRedirect } from '@/paraglide/runtime'
import Header from '../components/Header'
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

    // Other redirect strategies are possible; see
    // https://github.com/TanStack/router/tree/main/examples/react/i18n-paraglide#offline-redirect
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', getLocale())
    }
  },

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
        title: 'TanStack Start Starter',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
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
      <body>
        <Cursor />
        <TanStackQueryProvider>
          <TooltipProvider>
            {children}
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
