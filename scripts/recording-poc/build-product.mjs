import { build } from 'esbuild'
import { resolve } from 'node:path'
import { writeFile, symlink } from 'node:fs/promises'
await build({
  entryPoints: ['scripts/recording-poc/product-integration.mjs'],
  outfile: process.env.MSD_PACKAGED_CHECK
    ? 'out/main/recording-integration.cjs'
    : '.codex/recording-poc/product.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  alias: { '@shared': resolve('src/shared') },
  define: process.env.MSD_PACKAGED_CHECK ? {} : { __dirname: JSON.stringify(resolve('out/main')) },
  plugins: [
    {
      name: 'electron-asset',
      setup(build) {
        build.onResolve({ filter: /\?asset$/ }, () => ({ path: 'app-icon', namespace: 'icon' }))
        build.onLoad({ filter: /.*/, namespace: 'icon' }, () => ({
          contents: `export default ${JSON.stringify(resolve('resources/icon.png'))}`,
          loader: 'js'
        }))
      }
    }
  ]
})
await writeFile(
  '.codex/recording-poc/package.json',
  JSON.stringify({ name: 'msd-recording-integration', version: '1.0.0', main: 'product.cjs' })
)
await symlink(resolve('resources'), '.codex/recording-poc/resources').catch(() => {})
