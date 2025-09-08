module.exports = {
  extends: ['@commitlint/config-conventional', '@commitlint/config-lerna-scopes'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'web',
        'api',
        'spacetime',
        'deps',
        'release',
        'config',
        'ci',
        'docs',
        // Multi-scope options
        'web,api',
        'api,web',
        'web,spacetime',
        'spacetime,web',
        'api,spacetime',
        'spacetime,api',
        '*', // for changes affecting everything
      ],
    ],
  },
};
