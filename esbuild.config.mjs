import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'


const pkg = JSON.parse(await readFile('package.json', 'utf8'))

const shared = {
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    logLevel: 'warning'
}

// The CLI is one self-contained file: copy dist/safebox.js anywhere and run it.
await build({
    ...shared,
    entryPoints: ['cli/index.ts'],
    outfile: 'dist/safebox.js',
    banner: { js: '#!/usr/bin/env node' },
    define: { SAFEBOX_VERSION: JSON.stringify(pkg.version) }
})

// Unit tests: test/unit/*.test.ts -> dist-test/*.test.mjs.
await build({
    ...shared,
    entryPoints: ['test/unit/*.test.ts'],
    outdir: 'dist-test',
    outExtension: { '.js': '.mjs' },
    sourcemap: true
})

console.log('Built dist/safebox.js and dist-test/')
