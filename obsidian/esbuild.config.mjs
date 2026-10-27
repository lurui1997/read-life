import esbuild from 'esbuild'

const prod = process.argv[2] === 'production'

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2020',
  outfile: 'main.js',
  sourcemap: prod ? false : 'inline',
  minify: prod,
  legalComments: 'none',
  banner: {
    js: '/* 折角 Obsidian 插件。由 esbuild 打包，请勿手改。 */',
  },
})

if (prod) {
  await context.rebuild()
  await context.dispose()
} else {
  await context.watch()
}
