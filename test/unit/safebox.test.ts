import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { MAX_VALUE_SIZE, PROFILES, Safebox, SafeboxBuffer, SafeboxError, SafeboxErrorCode, SafeboxFile, SafeboxProfile } from '../../src'


// Standard is the cheapest profile; every load and save runs scrypt for real.
const FAST = { profile: SafeboxProfile.Standard }
const PASSWORD = 'correct horse battery staple'

let directory = ''


before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'safebox-test-'))
})


after(async () => {
    await rm(directory, { recursive: true, force: true })
})


describe('SafeboxFile', () => {

    test('a saved safebox loads with the same password and secrets', async () => {
        const file = join(directory, 'roundtrip.safebox')
        const box = new SafeboxFile(file).create(FAST).set('API_KEY', 'abc').set('MULTI_LINE', 'line 1\nline 2\n')
        assert.equal(box.changed, true)
        await box.save(PASSWORD)
        assert.equal(box.changed, false)

        const loaded = await new SafeboxFile(file).load(PASSWORD)
        assert.deepEqual(loaded.keys(), ['API_KEY', 'MULTI_LINE'])
        assert.equal(loaded.get('API_KEY'), 'abc')
        assert.equal(loaded.get('MULTI_LINE'), 'line 1\nline 2\n')
        assert.equal(loaded.changed, false)
        assert.equal(loaded.profile, SafeboxProfile.Standard)
    })


    test('the path is absolute', () => {
        assert.equal(new SafeboxFile('x.safebox').path, resolve('x.safebox'))
    })


    test('an empty safebox and an empty value survive', async () => {
        const file = join(directory, 'empty.safebox')
        await new SafeboxFile(file).create(FAST).save(PASSWORD)
        const box = await new SafeboxFile(file).load(PASSWORD)
        assert.equal(box.size, 0)
        await box.set('EMPTY', '').save(PASSWORD)
        assert.equal((await new SafeboxFile(file).load(PASSWORD)).get('EMPTY'), '')
    })


    test('saving with another password changes the password', async () => {
        const file = join(directory, 'passwd.safebox')
        const box = new SafeboxFile(file).create(FAST).set('A', '1')
        await box.save(PASSWORD)
        await box.save('new password 123')
        await assertCode(new SafeboxFile(file).load(PASSWORD), SafeboxErrorCode.DecryptFailed)
        assert.equal((await new SafeboxFile(file).load('new password 123')).get('A'), '1')
    })


    test('the profile is kept on save unless a new one is given', async () => {
        const file = join(directory, 'profile.safebox')
        await new SafeboxFile(file).create(FAST).save(PASSWORD)
        const box = await new SafeboxFile(file).load(PASSWORD)
        await box.save(PASSWORD)
        assert.equal((await box.info()).profile, SafeboxProfile.Standard)
        await box.save(PASSWORD, { profile: SafeboxProfile.Recommended })
        assert.equal(box.profile, SafeboxProfile.Recommended)
        const info = await new SafeboxFile(file).info()
        assert.equal(info.profile, SafeboxProfile.Recommended)
        assert.deepEqual(info.params, PROFILES[SafeboxProfile.Recommended])
    })


    test('saving leaves no temporary files and replaces an existing file', async () => {
        const folder = join(directory, 'atomic')
        await mkdir(folder)
        const file = join(folder, 'app.safebox')
        await new SafeboxFile(file).create(FAST).set('A', '1').save(PASSWORD)
        await new SafeboxFile(file).create(FAST).set('B', '2').save(PASSWORD)
        assert.deepEqual(await readdir(folder), ['app.safebox'])
        assert.deepEqual((await new SafeboxFile(file).load(PASSWORD)).keys(), ['B'])
    })


    test('a failed save keeps the changes marked as unsaved', async () => {
        const box = new SafeboxFile(join(directory, 'missing-dir', 'x.safebox')).create(FAST).set('A', '1')
        await assert.rejects(box.save(PASSWORD))
        assert.equal(box.changed, true)
    })


    test('a missing file is NotFound, a directory is refused', async () => {
        const missing = new SafeboxFile(join(directory, 'nope.safebox'))
        await assertCode(missing.load(PASSWORD), SafeboxErrorCode.NotFound)
        await assertCode(missing.info(), SafeboxErrorCode.NotFound)
        const folder = join(directory, 'a-directory')
        await mkdir(folder)
        await assert.rejects(new SafeboxFile(folder).load(PASSWORD))
    })


    test('the file format starts with the SBOX magic and version 1', async () => {
        const file = join(directory, 'format.safebox')
        await new SafeboxFile(file).create(FAST).save(PASSWORD)
        const data = await readFile(file)
        assert.equal(data.subarray(0, 4).toString('ascii'), 'SBOX')
        assert.equal(data[4], 1)
        assert.equal(data[5], 1)
        assert.deepEqual(await new SafeboxFile(file).info(), {
            version: 1,
            params: { N: 65536, r: 8, p: 1 },
            profile: SafeboxProfile.Standard,
            size: data.length
        })
        await writeFile(file, data.subarray(0, 10))
        await assertCode(new SafeboxFile(file).info(), SafeboxErrorCode.InvalidFormat)
    })
})


describe('SafeboxBuffer', () => {

    test('save keeps the bytes, a new buffer loads them', async () => {
        const box = new SafeboxBuffer().create(FAST).set('A', '1')
        assert.equal(box.data, undefined)
        await box.save(PASSWORD)
        assert.ok((box.data as unknown) instanceof Uint8Array)
        assert.equal((await new SafeboxBuffer(box.data).load(PASSWORD)).get('A'), '1')
    })


    test('an empty buffer is NotFound', async () => {
        await assertCode(new SafeboxBuffer().load(PASSWORD), SafeboxErrorCode.NotFound)
    })


    test('a buffer and a file hold the same format', async () => {
        const file = join(directory, 'from-buffer.safebox')
        const buffer = new SafeboxBuffer().create(FAST).set('A', '1')
        await buffer.save(PASSWORD)
        await writeFile(file, buffer.data as Uint8Array)
        assert.equal((await new SafeboxFile(file).load(PASSWORD)).get('A'), '1')
    })


    test('a custom storage only implements read and write', async () => {
        const store = new Map<string, Uint8Array>()
        class SafeboxMap extends Safebox {

            protected async read(): Promise<Uint8Array> {
                return store.get('box') as Uint8Array
            }


            protected async write(data: Buffer): Promise<void> {
                store.set('box', data)
            }
        }
        await new SafeboxMap().create(FAST).set('A', '1').save(PASSWORD)
        assert.equal((await new SafeboxMap().load(PASSWORD)).get('A'), '1')
    })
})


describe('state', () => {

    test('using a safebox before load or create is InvalidState', async () => {
        const box = new SafeboxBuffer()
        assert.equal(box.loaded, false)
        assert.equal(box.profile, undefined)
        assert.throws(() => box.get('A'), hasCode(SafeboxErrorCode.InvalidState))
        assert.throws(() => box.set('A', '1'), hasCode(SafeboxErrorCode.InvalidState))
        assert.throws(() => box.keys(), hasCode(SafeboxErrorCode.InvalidState))
        assert.throws(() => box.replace('x'), hasCode(SafeboxErrorCode.InvalidState))
        await assertCode(box.save(PASSWORD), SafeboxErrorCode.InvalidState)
    })


    test('create on a loaded safebox is InvalidState', () => {
        const box = new SafeboxBuffer().create(FAST)
        assert.equal(box.loaded, true)
        assert.throws(() => box.create(FAST), hasCode(SafeboxErrorCode.InvalidState))
    })


    test('a failed load keeps the previous state', async () => {
        const stored = new SafeboxBuffer().create(FAST).set('STORED', 'x')
        await stored.save(PASSWORD)
        const box = new SafeboxBuffer(stored.data).create(FAST).set('LOCAL', 'kept')
        await assertCode(box.load('wrong'), SafeboxErrorCode.DecryptFailed)
        assert.deepEqual(box.keys(), ['LOCAL'])
        assert.equal(box.changed, true)
        await box.load(PASSWORD)
        assert.deepEqual(box.keys(), ['STORED'])
        assert.equal(box.changed, false)
    })


    test('create defaults to the recommended profile', () => {
        assert.equal(new SafeboxBuffer().create().profile, SafeboxProfile.Recommended)
    })


    test('an unknown profile is rejected', () => {
        assert.throws(() => new SafeboxBuffer().create({ profile: 'weak' as SafeboxProfile }), hasCode(SafeboxErrorCode.InvalidInput))
    })
})


describe('encryption', () => {

    test('unicode values and passwords; composed and decomposed accents are the same password', async () => {
        const composed = 'Příliš žluťoučký kůň \u{1F511}'
        const decomposed = composed.normalize('NFD')
        assert.notEqual(composed, decomposed)
        const data = await encrypt(new SafeboxBuffer().create(FAST).set('GREETING', 'Čau \u{1F44B}'), composed)
        assert.equal((await new SafeboxBuffer(data).load(decomposed)).get('GREETING'), 'Čau \u{1F44B}')
    })


    test('a name like __proto__ is an ordinary secret', async () => {
        const data = await encrypt(new SafeboxBuffer().create(FAST).set('__proto__', 'x').set('constructor', 'y'))
        const box = await new SafeboxBuffer(data).load(PASSWORD)
        assert.equal(box.get('__proto__'), 'x')
        assert.equal(box.get('constructor'), 'y')
        assert.equal(Object.getPrototypeOf(box.toObject()), null)
    })


    test('every save uses a fresh salt and IV', async () => {
        const box = new SafeboxBuffer().create(FAST).set('A', '1')
        const first = await encrypt(box)
        const second = await encrypt(box)
        assert.notDeepEqual(first.subarray(18, 46), second.subarray(18, 46))
        assert.notDeepEqual(first.subarray(62), second.subarray(62))
    })


    test('a wrong password fails with DecryptFailed', async () => {
        const data = await encrypt(new SafeboxBuffer().create(FAST).set('A', '1'))
        await assertCode(new SafeboxBuffer(data).load('wrong'), SafeboxErrorCode.DecryptFailed)
    })


    test('an empty password is invalid input', async () => {
        await assertCode(new SafeboxBuffer().create(FAST).save(''), SafeboxErrorCode.InvalidInput)
        const data = await encrypt(new SafeboxBuffer().create(FAST))
        await assertCode(new SafeboxBuffer(data).load(''), SafeboxErrorCode.InvalidInput)
    })


    test('changing any byte of the header or body is detected', async () => {
        const data = await encrypt(new SafeboxBuffer().create(FAST).set('A', 'value'))
        // Salt, IV, tag and ciphertext fail authentication.
        for (const offset of [18, 33, 34, 45, 46, 61, 62, data.length - 1]) {
            await assertCode(new SafeboxBuffer(flip(data, offset)).load(PASSWORD), SafeboxErrorCode.DecryptFailed, `byte ${offset}`)
        }
        // Magic, version and KDF are refused before decryption.
        for (const offset of [0, 4, 5]) {
            await assertCode(new SafeboxBuffer(flip(data, offset)).load(PASSWORD), SafeboxErrorCode.InvalidFormat, `byte ${offset}`)
        }
    })


    test('a header with other valid scrypt parameters fails authentication', async () => {
        const data = await encrypt(new SafeboxBuffer().create(FAST))
        data.writeUInt32BE(2 ** 15, 6)
        await assertCode(new SafeboxBuffer(data).load(PASSWORD), SafeboxErrorCode.DecryptFailed)
    })


    test('unsafe scrypt parameters are refused before key derivation', async () => {
        for (const [offset, value] of [[6, 2 ** 20], [6, 1000], [6, 2 ** 10], [10, 16], [14, 2]]) {
            const data = await encrypt(new SafeboxBuffer().create(FAST))
            data.writeUInt32BE(value, offset)
            await assertCode(new SafeboxBuffer(data).load(PASSWORD), SafeboxErrorCode.InvalidFormat, `offset ${offset} = ${value}`)
        }
    })


    test('truncated data and other files are not a safebox', async () => {
        const data = await encrypt(new SafeboxBuffer().create(FAST))
        await assertCode(new SafeboxBuffer(data.subarray(0, 61)).load(PASSWORD), SafeboxErrorCode.InvalidFormat)
        await assertCode(new SafeboxBuffer(data.subarray(0, data.length - 1)).load(PASSWORD), SafeboxErrorCode.DecryptFailed)
        await assertCode(new SafeboxBuffer(Buffer.from('{"salt":"00"}')).load(PASSWORD), SafeboxErrorCode.InvalidFormat)
        await assertCode(new SafeboxBuffer(new Uint8Array(0)).load(PASSWORD), SafeboxErrorCode.InvalidFormat)
    })


    test('error messages do not contain secret values', async () => {
        const box = new SafeboxBuffer().create(FAST).set('TOKEN', 'super-secret-value')
        const data = await encrypt(box)
        const error = await new SafeboxBuffer(flip(data, data.length - 1)).load(PASSWORD).catch(caught => caught as Error)
        assert.ok(error instanceof SafeboxError)
        assert.doesNotMatch(String(error.message), /super-secret-value/)
        assert.throws(() => box.replace('{{TOKEN}} {{OTHER}}'), (thrown: Error) => !thrown.message.includes('super-secret-value'))
    })
})


describe('secrets in memory', () => {

    test('set, get, has, delete and the changed flag', async () => {
        const data = await encrypt(new SafeboxBuffer().create(FAST).set('A', '1'))
        const box = await new SafeboxBuffer(data).load(PASSWORD)
        assert.equal(box.changed, false)
        assert.equal(box.has('A'), true)
        assert.equal(box.has('B'), false)
        assert.equal(box.delete('B'), false)
        assert.equal(box.changed, false)
        assert.equal(box.delete('A'), true)
        assert.equal(box.changed, true)
        assert.throws(() => box.get('A'), hasCode(SafeboxErrorCode.MissingSecret))
    })


    test('invalid secret names are refused', () => {
        const box = new SafeboxBuffer().create(FAST)
        for (const name of ['', '1ABC', 'A-B', 'A B', 'A.B', 'ČAU', 'A'.repeat(129)]) {
            assert.throws(() => box.set(name, 'x'), hasCode(SafeboxErrorCode.InvalidInput), name)
        }
        box.set('A'.repeat(128), 'x')
        box.set('_private_9', 'x')
    })


    test('values must be strings of at most 1 MiB', () => {
        const box = new SafeboxBuffer().create(FAST)
        assert.throws(() => box.set('A', 42 as unknown as string), hasCode(SafeboxErrorCode.InvalidInput))
        assert.throws(() => box.set('A', 'x'.repeat(MAX_VALUE_SIZE + 1)), hasCode(SafeboxErrorCode.InvalidInput))
        box.set('A', 'x'.repeat(MAX_VALUE_SIZE))
    })


    test('keys are sorted and toObject copies the secrets', () => {
        const box = new SafeboxBuffer().create(FAST).set('ZED', 'z').set('ALPHA', 'a')
        assert.deepEqual(box.keys(), ['ALPHA', 'ZED'])
        const object = box.toObject()
        assert.deepEqual({ ...object }, { ALPHA: 'a', ZED: 'z' })
        object.ALPHA = 'changed'
        assert.equal(box.get('ALPHA'), 'a')
    })


    test('replace fills both placeholder styles and reports all missing names', () => {
        const box = new SafeboxBuffer().create(FAST).set('USER', 'pavex').set('PASS', 'p$1&')
        assert.equal(box.replace('{{USER}}:${PASS}@host {{USER}}'), 'pavex:p$1&@host pavex')
        assert.equal(box.replace('no placeholders, {single} and $USER stay'), 'no placeholders, {single} and $USER stay')
        assert.throws(() => box.replace('{{USER}} {{HOST}} ${PORT}'), (error: SafeboxError) => {
            return error.code === SafeboxErrorCode.MissingSecret && error.message.includes('HOST, PORT')
        })
    })
})


// Saves the safebox and returns a copy of the encrypted bytes.
async function encrypt(box: SafeboxBuffer, password = PASSWORD): Promise<Buffer> {
    await box.save(password)
    return Buffer.from(box.data as Uint8Array)
}


async function assertCode(promise: Promise<unknown>, code: SafeboxErrorCode, message?: string): Promise<void> {
    await assert.rejects(promise, hasCode(code), message)
}


function hasCode(code: SafeboxErrorCode) {
    return (error: unknown) => error instanceof SafeboxError && error.code === code
}


function flip(data: Buffer, offset: number): Buffer {
    const copy = Buffer.from(data)
    copy[offset] ^= 0x01
    return copy
}
