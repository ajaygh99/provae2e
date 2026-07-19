import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './tsconfig.eslint.json' }
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any':      'error',
      '@typescript-eslint/no-unused-vars':        'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      'no-console':                              'error',
      'no-debugger':                             'error',
      'prefer-const':                            'error',
      'no-var':                                  'error'
    }
  }
];
