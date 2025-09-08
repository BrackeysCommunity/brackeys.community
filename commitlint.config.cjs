module.exports = {
  extends: ['@commitlint/config-conventional', '@commitlint/config-lerna-scopes'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'web',
        'hasura',
        'spacetime',
        'deps',
        'release',
        'config',
        'ci',
        'docs',
        // Multi-scope options
        'web,hasura',
        'web,spacetime',
        'hasura,spacetime',
        'hasura,web',
        'spacetime,web',
        'spacetime,hasura',
        '*', // for changes affecting everything
      ],
    ],
  },
};
