import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/ui.tsx'],
  external: ['react', 'react-native', 'react/jsx-runtime'],
  noExternal: [/^@mobile-analytics\//],
  format: ['esm'],
  target: 'es2020',
  clean: true,
  sourcemap: true,
  dts: {
    resolve: true,
    compilerOptions: {
      rootDir: '../..',
      paths: {
        '@mobile-analytics/contracts/types': ['../../packages/contracts/src/types.ts'],
        '@mobile-analytics/sdk-core': ['../../packages/sdk-core/src/index.ts'],
      },
    },
  },
  splitting: false,
  treeshake: true,
});
