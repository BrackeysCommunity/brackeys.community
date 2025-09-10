import type { CodegenConfig } from '@graphql-codegen/cli';

const hasuraEndpoint = 'http://localhost:3280/graphql';

const config: CodegenConfig = {
  schema: hasuraEndpoint,
  documents: ['src/**/*.ts', 'src/**/*.tsx'],
  ignoreNoDocuments: true,
  generates: {
    './src/lib/gql/gen/': {
      preset: 'client',
      config: {
        documentMode: 'string',
        schema: hasuraEndpoint,
      },
    },
    './schema.graphql': {
      plugins: ['schema-ast'],
      config: {
        schema: hasuraEndpoint,
        includeDirectives: true,
      },
    },
  },
};

export default config;
