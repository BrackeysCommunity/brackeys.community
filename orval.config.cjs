module.exports = {
  'brackeys-api': {
    input: {
      target: './public/swagger.yml',
    },
    output: {
      mode: 'split',
      target: './src/api/generated',
      schemas: './src/api/models',
      client: 'react-query',
      override: {
        query: {
          useQuery: true,
          useSuspenseQuery: true,
          useSuspenseInfiniteQuery: true,
          useInfinite: true,
          useInfiniteQueryParam: 'limit',
        }
      },
      mock: true,
      prettier: true,
    }
  }
}
