module.exports = {
  extends: [
    'stylelint-config-standard',
    'stylelint-config-prettier',
  ],
  rules: {
    // Prefer CSS variables and tokens over hex values
    'color-no-hex': true,
    // Disallow named colors (e.g., red) to encourage tokens
    'color-named': 'never',
    // Limit color usage to var() or hsl()
    'declaration-property-value-allowed-list': {
      '/^color/': [/^var\(/, /^hsl\(/, /^hsla\(/],
      'background-color': [/^var\(/, /^hsl\(/, /^hsla\(/],
      'border-color': [/^var\(/, /^hsl\(/, /^hsla\(/],
    },
  },
  ignoreFiles: [
    '**/*.tsx',
    '**/*.ts',
    '**/*.jsx',
    '**/*.js',
    'node_modules/**',
  ],
};

