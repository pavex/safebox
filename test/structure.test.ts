import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { test } from 'node:test'


// Guards the layout: src/ is the library people copy into their apps, so it
// must stand alone; cli/ is an app on top of it and may use only its public
// API. Neither may depend on npm packages.

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')
const CLI = join(ROOT, 'cli')
const SRC_INDEX = join(SRC, 'index')
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g


test('src/ imports only Node.js built-ins and its own files', () => {
    for (const { file, specifier, target } of imports(SRC)) {
        if (target === undefined) {
            assert.match(specifier, /^node:/, `${file} imports the package ${specifier}`)
        }
        else {
            assert.ok(isInside(target, SRC), `${file} imports ${specifier} outside src/`)
        }
    }
})


test('cli/ imports from src/ only its public index', () => {
    for (const { file, specifier, target } of imports(CLI)) {
        if (target === undefined) {
            assert.match(specifier, /^node:/, `${file} imports the package ${specifier}`)
        }
        else if (!isInside(target, CLI)) {
            assert.ok(target === SRC || target === SRC_INDEX, `${file} imports ${specifier}; import from src/index instead`)
        }
    }
})


test('tests run from test/ directly, the build makes only dist/', () => {
    const build = readFileSync(join(ROOT, 'esbuild.config.mjs'), 'utf8')
    assert.doesNotMatch(build, /dist-test|\.test\.ts/)
})


test('the CLI entry point is cli/index.ts and the library entry is src/index.ts', () => {
    const build = readFileSync(join(ROOT, 'esbuild.config.mjs'), 'utf8')
    assert.match(build, /entryPoints: \['cli\/index\.ts'\]/)
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    assert.equal(pkg.exports['.'], './src/index.ts')
})


// Every import in the .ts files under the folder; target is the resolved path
// without extension, undefined for packages and built-ins.
function imports(folder: string): { file: string, specifier: string, target: string | undefined }[] {
    return listFiles(folder).flatMap(file => {
        const source = readFileSync(file, 'utf8')
        return [...source.matchAll(IMPORT)].map(match => {
            const specifier = match[1] ?? match[2]
            const target = specifier.startsWith('.') ? resolve(dirname(file), specifier) : undefined
            return { file: relative(ROOT, file), specifier, target }
        })
    })
}


function listFiles(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        const path = join(folder, entry.name)
        if (entry.isDirectory()) {
            return listFiles(path)
        }
        return path.endsWith('.ts') ? [path] : []
    })
}


function isInside(path: string, folder: string): boolean {
    return path === folder || path.startsWith(folder + sep)
}
