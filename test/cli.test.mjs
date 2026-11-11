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
    let result = await run([file, 'create', '--profile', 'standard'])
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /Created/)

    result = await run([file, 'set', 'API_KEY'], { input: 'key-123\n' })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /Added API_KEY/)

    const pem = '-----BEGIN KEY-----\nabc\n-----END KEY-----\n'
    await writeFile(join(directory, 'key.pem'), pem)
    result = await run([file, 'set', 'TLS_KEY', '--from-file', join(directory, 'key.pem')])
    assert.equal(result.code, 0, result.stderr)

    result = await run([file, 'set', 'API_KEY'], { input: 'key-456' })
    assert.match(result.stderr, /Updated API_KEY/)

    result = await run([file, 'list'])
    assert.equal(result.stdout, 'API_KEY\nTLS_KEY\n')

    result = await run([file, 'get', 'API_KEY'])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, 'key-456')

    result = await run([file, 'get', 'TLS_KEY'])
    assert.equal(result.stdout, pem)

    result = await run([file, 'delete', 'TLS_KEY'])
    assert.equal(result.code, 0, result.stderr)
    assert.equal((await run([file, 'list'])).stdout, 'API_KEY\n')

    result = await run([file, 'delete', 'TLS_KEY'])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /No secret named TLS_KEY/)

    result = await run([file, 'info'], { env: {} })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /kdf: scrypt N=65536 r=8 p=1 \(standard\)/)
})


test('the file never contains a value in plain text', async () => {
    const plain = join(directory, 'plain.safebox')
    await run([plain, 'create', '--profile', 'standard'])
    await run([plain, 'set', 'MARKER'], { input: 'very-recognizable-marker' })
    const data = await readFile(plain)
    assert.equal(data.includes('very-recognizable-marker'), false)
    assert.equal(data.includes('MARKER'), false)
})


test('create refuses to replace a file without --force', async () => {
    const existing = join(directory, 'existing.safebox')
    await run([existing, 'create', '--profile', 'standard'])
    let result = await run([existing, 'create', '--profile', 'standard'])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /already exists/)
    result = await run([existing, 'create', '--profile', 'standard', '--force'])
    assert.equal(result.code, 0, result.stderr)
})


test('a wrong password fails without changing the file', async () => {
    const before = await readFile(file)
    const result = await run([file, 'set', 'OTHER'], { input: 'x', env: { SAFEBOX_PASSWORD: 'wrong' } })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /wrong password/)
    assert.deepEqual(await readFile(file), before)
})


test('--password-file takes the first line and wins over the variable', async () => {
    const passwordFile = join(directory, 'password.txt')
    await writeFile(passwordFile, `${PASSWORD}\r\nsecond line\n`)
    const result = await run([file, 'list', '--password-file', passwordFile], { env: { SAFEBOX_PASSWORD: 'wrong' } })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, 'API_KEY\n')
})


test('passwd changes the password and can change the profile', async () => {
    const box = join(directory, 'passwd.safebox')
    await run([box, 'create', '--profile', 'standard'])
    await run([box, 'set', 'A'], { input: '1' })
    let result = await run([box, 'passwd', '--profile', 'recommended'], { env: { SAFEBOX_PASSWORD: PASSWORD, SAFEBOX_NEW_PASSWORD: 'second password 2' } })
    assert.equal(result.code, 0, result.stderr)
    assert.equal((await run([box, 'list'])).code, 1)
    result = await run([box, 'get', 'A'], { env: { SAFEBOX_PASSWORD: 'second password 2' } })
    assert.equal(result.stdout, '1')
    assert.match((await run([box, 'info'])).stdout, /\(recommended\)/)
})


test('without any password source it explains what to do', async () => {
    const result = await run([file, 'list'], { env: { SAFEBOX_PASSWORD: '' } })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /No password: run in a terminal, or use --password-file or SAFEBOX_PASSWORD/)
})


test('a short password gets a warning', async () => {
    const result = await run([join(directory, 'short.safebox'), 'create', '--profile', 'standard'], { env: { SAFEBOX_PASSWORD: 'short' } })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /shorter than 12/)
})


test('usage errors exit with code 2', async () => {
    for (const args of [[], [file], [file, 'frobnicate'], [file, 'get'], [file, 'list', 'extra'], [file, 'list', '--force'], [file, 'list', '--bogus']]) {
        const result = await run(args)
        assert.equal(result.code, 2, `${args.join(' ')}: ${result.stderr}`)
    }
    assert.match((await run([file, 'get'])).stderr, /Usage: safebox .+ get <NAME>/)
    assert.equal((await run(['--help'])).code, 0)
    assert.equal((await run(['help'])).code, 0)
    assert.match((await run(['--version'])).stdout, /^\d+\.\d+\.\d+/)
})


test('the help shows the file first and explains the password', async () => {
    const help = (await run(['--help'])).stdout
    assert.match(help, /safebox <file> create/)
    assert.match(help, /safebox <file> set <NAME>/)
    assert.match(help, /The safebox password:/)
    assert.match(help, /SAFEBOX_PASSWORD/)
})


test('invalid names, unknown profiles and missing files are reported', async () => {
    let result = await run([file, 'set', '1BAD'], { input: 'x' })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /Invalid secret name/)
    result = await run([join(directory, 'p.safebox'), 'create', '--profile', 'weak'])
    assert.match(result.stderr, /Unknown profile "weak"/)
    result = await run([join(directory, 'nope.safebox'), 'list'])
    assert.match(result.stderr, /does not exist/)
    result = await run([file, 'get', 'MISSING'])
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
