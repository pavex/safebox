// Runs the bundled dist/safebox.js as a separate process, the way people use it.
// Passwords come from SAFEBOX_PASSWORD or --password-file: a piped process has
// no terminal for the hidden prompt.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'


const CLI = resolve(import.meta.dirname, '..', 'dist', 'safebox.js')
const PASSWORD = 'cli test password 1'

let directory = ''
let file = ''


before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'safebox-cli-'))
    file = join(directory, 'app.safebox')
})


after(async () => {
    await rm(directory, { recursive: true, force: true })
})


test('create, set, list, get, delete and info', async () => {
    let result = await run(['create', file, '--profile', 'standard'])
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /Created/)

    result = await run(['set', file, 'API_KEY'], { input: 'key-123\n' })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /Added API_KEY/)

    const pem = '-----BEGIN KEY-----\nabc\n-----END KEY-----\n'
    await writeFile(join(directory, 'key.pem'), pem)
    result = await run(['set', file, 'TLS_KEY', '--from-file', join(directory, 'key.pem')])
    assert.equal(result.code, 0, result.stderr)

    result = await run(['set', file, 'API_KEY'], { input: 'key-456' })
    assert.match(result.stderr, /Updated API_KEY/)

    result = await run(['list', file])
    assert.equal(result.stdout, 'API_KEY\nTLS_KEY\n')

    result = await run(['get', file, 'API_KEY'])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, 'key-456')

    result = await run(['get', file, 'TLS_KEY'])
    assert.equal(result.stdout, pem)

    result = await run(['delete', file, 'TLS_KEY'])
    assert.equal(result.code, 0, result.stderr)
    assert.equal((await run(['list', file])).stdout, 'API_KEY\n')

    result = await run(['delete', file, 'TLS_KEY'])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /No secret named TLS_KEY/)

    result = await run(['info', file], { env: {} })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /kdf: scrypt N=65536 r=8 p=1 \(standard\)/)
})


test('the file never contains a value in plain text', async () => {
    const plain = join(directory, 'plain.safebox')
    await run(['create', plain, '--profile', 'standard'])
    await run(['set', plain, 'MARKER'], { input: 'very-recognizable-marker' })
    const data = await readFile(plain)
    assert.equal(data.includes('very-recognizable-marker'), false)
    assert.equal(data.includes('MARKER'), false)
})


test('create refuses to replace a file without --force', async () => {
    const existing = join(directory, 'existing.safebox')
    await run(['create', existing, '--profile', 'standard'])
    let result = await run(['create', existing, '--profile', 'standard'])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /already exists/)
    result = await run(['create', existing, '--profile', 'standard', '--force'])
    assert.equal(result.code, 0, result.stderr)
})


test('a wrong password fails without changing the file', async () => {
    const before = await readFile(file)
    const result = await run(['set', file, 'OTHER'], { input: 'x', env: { SAFEBOX_PASSWORD: 'wrong' } })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /wrong password/)
    assert.deepEqual(await readFile(file), before)
})


test('--password-file takes the first line and wins over the variable', async () => {
    const passwordFile = join(directory, 'password.txt')
    await writeFile(passwordFile, `${PASSWORD}\r\nsecond line\n`)
    const result = await run(['list', file, '--password-file', passwordFile], { env: { SAFEBOX_PASSWORD: 'wrong' } })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, 'API_KEY\n')
})


test('passwd changes the password and can change the profile', async () => {
    const box = join(directory, 'passwd.safebox')
    await run(['create', box, '--profile', 'standard'])
    await run(['set', box, 'A'], { input: '1' })
    let result = await run(['passwd', box, '--profile', 'recommended'], { env: { SAFEBOX_PASSWORD: PASSWORD, SAFEBOX_NEW_PASSWORD: 'second password 2' } })
    assert.equal(result.code, 0, result.stderr)
    assert.equal((await run(['list', box])).code, 1)
    result = await run(['get', box, 'A'], { env: { SAFEBOX_PASSWORD: 'second password 2' } })
    assert.equal(result.stdout, '1')
    assert.match((await run(['info', box])).stdout, /\(recommended\)/)
})


test('without any password source it explains what to do', async () => {
    const result = await run(['list', file], { env: { SAFEBOX_PASSWORD: '' } })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /No password: run in a terminal, or use --password-file or SAFEBOX_PASSWORD/)
})


test('a short password gets a warning', async () => {
    const result = await run(['create', join(directory, 'short.safebox'), '--profile', 'standard'], { env: { SAFEBOX_PASSWORD: 'short' } })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /shorter than 12/)
})


test('usage errors exit with code 2', async () => {
    for (const args of [[], ['frobnicate', file], ['get', file], ['list', file, '--force'], ['list', file, '--bogus']]) {
        const result = await run(args)
        assert.equal(result.code, 2, `${args.join(' ')}: ${result.stderr}`)
    }
    assert.equal((await run(['--help'])).code, 0)
    assert.match((await run(['--version'])).stdout, /^\d+\.\d+\.\d+/)
})


test('invalid names, unknown profiles and missing files are reported', async () => {
    let result = await run(['set', file, '1BAD'], { input: 'x' })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /Invalid secret name/)
    result = await run(['create', join(directory, 'p.safebox'), '--profile', 'weak'])
    assert.match(result.stderr, /Unknown profile "weak"/)
    result = await run(['list', join(directory, 'nope.safebox')])
    assert.match(result.stderr, /does not exist/)
    result = await run(['get', file, 'MISSING'])
    assert.match(result.stderr, /No secret named MISSING/)
})


function run(args, { input = '', env = { SAFEBOX_PASSWORD: PASSWORD } } = {}) {
    return new Promise((done, fail) => {
        const child = spawn(process.execPath, [CLI, ...args], {
            env: { ...process.env, SAFEBOX_PASSWORD: undefined, SAFEBOX_NEW_PASSWORD: undefined, ...env },
            stdio: ['pipe', 'pipe', 'pipe']
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', chunk => {
            stdout += chunk
        })
        child.stderr.on('data', chunk => {
            stderr += chunk
        })
        child.on('error', fail)
        child.on('close', code => done({ code, stdout, stderr }))
        child.stdin.end(input)
    })
}
