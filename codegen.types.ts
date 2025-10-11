import type { CodegenConfig } from '@graphql-codegen/cli';

const hasuraEndpoint = 'http://localhost:3280/graphql';

const config: CodegenConfig = {
  schema: hasuraEndpoint,
  documents: ['src/**/*.ts', 'src/**/*.tsx'],
  ignoreNoDocuments: true,
  generates: {
    './src/lib/gql/generated.ts': {
      plugins: ['typescript', 'typescript-operations', 'typescript-react-query'],
      config: {
        documentMode: 'string',
        skipTypename: true,
        skipTypeNamesForRoot: true,
        reactQueryVersion: 5,
        exposeDocument: true,
        fetcher: {
          endpoint: hasuraEndpoint,
        },
      },
    },
  },
};

export default config;
