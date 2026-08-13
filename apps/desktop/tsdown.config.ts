import { defineConfig } from 'tsdown'

/** Bundle the launcher while leaving BunDesk's runtime and native assets in its package. */
export default defineConfig({
  entry: ['lib/types/bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['bundesk'] },
})
