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
        },
        mutator: {
          path: './src/api/mutator/custom-instance.ts',
          name: 'customInstance',
        },
      },
      mock: true,
      prettier: true,
    }
  }
}
