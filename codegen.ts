import type { CodegenConfig } from '@graphql-codegen/cli';

const hasuraToken = 'need the ddn token to run codegen';
const hasuraEndpoint = 'https://fitting-piglet-7078-9b7c143d62.ddn.hasura.app/graphql';

const config: CodegenConfig = {
  schema: [
    {
      [hasuraEndpoint]: {
        headers: {
          'x-hasura-ddn-token': hasuraToken,
        },
      },
    },
  ],
  documents: ['src/**/*.ts', 'src/**/*.tsx'],
  ignoreNoDocuments: true,
  generates: {
    './src/lib/gql/gen/': {
      preset: 'client',
      config: {
        documentMode: 'string',
      },
    },
    './schema.graphql': {
      plugins: ['schema-ast'],
      config: {
        schema: [
          {
            [hasuraEndpoint]: {
              headers: {
                'x-hasura-ddn-token': hasuraToken,
              },
            },
          },
        ],
        includeDirectives: true,
      },
    },
  },
};

export default config;
