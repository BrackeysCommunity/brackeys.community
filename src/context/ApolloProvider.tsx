import { ApolloProvider as BaseApolloProvider } from '@apollo/client/react'
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client'
import { SetContextLink } from "@apollo/client/link/context"
import { HttpLink } from '@apollo/client/link/http'
import { ErrorLink } from '@apollo/client/link/error'
import {
  CombinedGraphQLErrors,
  CombinedProtocolErrors,
} from "@apollo/client/errors"
import { PropsWithChildren, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const preferredRoles: Record<string, string> = {
  // Map of operation name to preferred role
  // e.g. TestHasuraConnection: 'user',
}

export const ApolloProvider = ({ children }: PropsWithChildren) => {
  const { state: authState } = useAuth()

  const hasuraClaims = useMemo(() => authState.hasuraClaims, [authState.hasuraClaims])

  const apolloClient = useMemo(() => {
    const httpLink = new HttpLink({
      uri: import.meta.env.VITE_HASURA_GRAPHQL_URL || 'http://localhost:8080/v1/graphql',
    })

    const authLink = new SetContextLink(async ({ headers }, { operationName }) => {
      const { data: { session } } = await supabase.auth.getSession()
      const preferredRole = preferredRoles[operationName || ''];

      return {
        headers: {
          ...headers,
          ...(hasuraClaims && hasuraClaims.allowedRoles.includes(preferredRole) && { 'x-hasura-role': preferredRole }),
          ...(session?.access_token && { 'Authorization': `Bearer ${session.access_token}` })
        }
      };
    })

    // TODO: telemetry
    const errorLink = new ErrorLink(({ error, operation, forward }) => {
      if (CombinedGraphQLErrors.is(error)) {
        error.errors.forEach(({ message, locations, path, extensions }) => {
          console.log(
            `[GraphQL error]: Message: ${message}, Location: ${locations}, Path: ${path}`
          )

          if (extensions?.code === 'invalid-jwt' || extensions?.code === 'jwt-invalid-claims') {
            supabase.auth.refreshSession().then(({ data: { session }, error: refreshError }) => {
              if (!refreshError && session) {
                const oldHeaders = operation.getContext().headers
                operation.setContext({
                  headers: {
                    ...oldHeaders,
                    authorization: `Bearer ${session.access_token}`,
                  },
                })
                return forward(operation)
              }
            })
          }
        })
      } else if (CombinedProtocolErrors.is(error)) {
        error.errors.forEach(({ message, extensions }) =>
          console.log(
            `[Protocol error]: Message: ${message}, Extensions: ${JSON.stringify(
              extensions
            )}`
          )
        )
      } else {
        console.error(`[Network error]: ${error}`, operation)
      }
    })

    return new ApolloClient({
      link: ApolloLink.from([authLink, errorLink, httpLink]),
      cache: new InMemoryCache(),
      defaultOptions: {
        watchQuery: {
          fetchPolicy: 'cache-and-network',
        },
      },
    })
  }, [hasuraClaims])

  return (
    <BaseApolloProvider client={apolloClient}>
      {children}
    </BaseApolloProvider>
  )
}
