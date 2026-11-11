import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'


const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const COPYRIGHT = `(c) 2026 ${pkg.author}, ${pkg.license} license`

// The CLI is one self-contained file: copy dist/safebox.js anywhere and run it.
// Tests run from the TypeScript sources directly (test/support/register.mjs).
await build({
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    logLevel: 'warning',
    entryPoints: ['cli/index.ts'],
    outfile: 'dist/safebox.js',
    banner: { js: `#!/usr/bin/env node\n// safebox ${pkg.version} - ${COPYRIGHT}` },
    define: { SAFEBOX_VERSION: JSON.stringify(pkg.version), SAFEBOX_COPYRIGHT: JSON.stringify(COPYRIGHT) }
})

console.log('Built dist/safebox.js')
