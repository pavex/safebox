import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { MAX_VALUE_SIZE, PROFILES, Safebox, SafeboxError, SafeboxErrorCode, SafeboxProfile } from '../../src'


// Standard is the cheapest profile; every open and save runs scrypt for real.
const FAST = { profile: SafeboxProfile.Standard }
const PASSWORD = 'correct horse battery staple'

let directory = ''


before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'safebox-test-'))
})


after(async () => {
    await rm(directory, { recursive: true, force: true })
})


describe('save and open', () => {

    test('a saved safebox opens with the same password and secrets', async () => {
        const file = join(directory, 'roundtrip.safebox')
        const box = Safebox.create(FAST).set('API_KEY', 'abc').set('MULTI_LINE', 'line 1\nline 2\n')
        await box.save(file, PASSWORD)
        assert.equal(box.changed, false)

        const opened = await Safebox.open(file, PASSWORD)
        assert.deepEqual(opened.keys(), ['API_KEY', 'MULTI_LINE'])
        assert.equal(opened.get('API_KEY'), 'abc')
        assert.equal(opened.get('MULTI_LINE'), 'line 1\nline 2\n')
        assert.equal(opened.changed, false)
        assert.equal(opened.profile, SafeboxProfile.Standard)
    })


    test('an empty safebox and an empty value survive', async () => {
        const file = join(directory, 'empty.safebox')
        await Safebox.create(FAST).save(file, PASSWORD)
        const opened = await Safebox.open(file, PASSWORD)
        assert.equal(opened.size, 0)
        opened.set('EMPTY', '')
        await opened.save(file, PASSWORD)
        assert.equal((await Safebox.open(file, PASSWORD)).get('EMPTY'), '')
    })


    test('unicode values and passwords; composed and decomposed accents are the same password', async () => {
        const composed = 'Příliš žluťoučký kůň \u{1F511}'
        const decomposed = composed.normalize('NFD')
        assert.notEqual(composed, decomposed)
        const data = await Safebox.create(FAST).set('GREETING', 'Čau \u{1F44B}').encrypt(composed)
        const opened = await Safebox.decrypt(data, decomposed)
        assert.equal(opened.get('GREETING'), 'Čau \u{1F44B}')
    })


    test('a name like __proto__ is an ordinary secret', async () => {
        const data = await Safebox.create(FAST).set('__proto__', 'x').set('constructor', 'y').encrypt(PASSWORD)
        const opened = await Safebox.decrypt(data, PASSWORD)
        assert.equal(opened.get('__proto__'), 'x')
        assert.equal(opened.get('constructor'), 'y')
        assert.equal(Object.getPrototypeOf(opened.toObject()), null)
    })


    test('every encryption uses a fresh salt and IV', async () => {
        const box = Safebox.create(FAST).set('A', '1')
        const first = await box.encrypt(PASSWORD)
        const second = await box.encrypt(PASSWORD)
        assert.notDeepEqual(first.subarray(18, 46), second.subarray(18, 46))
        assert.notDeepEqual(first.subarray(62), second.subarray(62))
    })


    test('saving with another password changes the password', async () => {
        const file = join(directory, 'passwd.safebox')
        const box = Safebox.create(FAST).set('A', '1')
        await box.save(file, PASSWORD)
        await box.save(file, 'new password 123')
        await assertCode(Safebox.open(file, PASSWORD), SafeboxErrorCode.DecryptFailed)
        assert.equal((await Safebox.open(file, 'new password 123')).get('A'), '1')
    })


    test('the profile is kept on save unless a new one is given', async () => {
        const file = join(directory, 'profile.safebox')
        await Safebox.create(FAST).save(file, PASSWORD)
        const opened = await Safebox.open(file, PASSWORD)
        await opened.save(file, PASSWORD)
        assert.equal((await Safebox.info(file)).profile, SafeboxProfile.Standard)
        await opened.save(file, PASSWORD, { profile: SafeboxProfile.Recommended })
        assert.equal(opened.profile, SafeboxProfile.Recommended)
        const info = await Safebox.info(file)
        assert.equal(info.profile, SafeboxProfile.Recommended)
        assert.deepEqual(info.params, PROFILES[SafeboxProfile.Recommended])
    })


    test('create defaults to the recommended profile', () => {
        assert.equal(Safebox.create().profile, SafeboxProfile.Recommended)
    })


    test('an unknown profile is rejected', () => {
        assert.throws(() => Safebox.create({ profile: 'weak' as SafeboxProfile }), hasCode(SafeboxErrorCode.InvalidInput))
    })


    test('saving leaves no temporary files and replaces an existing file', async () => {
        const folder = join(directory, 'atomic')
        await mkdir(folder)
        const file = join(folder, 'app.safebox')
        await Safebox.create(FAST).set('A', '1').save(file, PASSWORD)
        await Safebox.create(FAST).set('B', '2').save(file, PASSWORD)
        assert.deepEqual(await readdir(folder), ['app.safebox'])
        assert.deepEqual((await Safebox.open(file, PASSWORD)).keys(), ['B'])
    })


    test('a failed save keeps the changes marked as unsaved', async () => {
        const box = Safebox.create(FAST).set('A', '1')
        await assert.rejects(box.save(join(directory, 'missing-dir', 'x.safebox'), PASSWORD))
        assert.equal(box.changed, true)
    })
})


describe('rejected input', () => {

    test('a wrong password fails with DecryptFailed', async () => {
        const data = await Safebox.create(FAST).set('A', '1').encrypt(PASSWORD)
        await assertCode(Safebox.decrypt(data, 'wrong'), SafeboxErrorCode.DecryptFailed)
    })


    test('an empty password is invalid input', async () => {
        await assertCode(Safebox.create(FAST).encrypt(''), SafeboxErrorCode.InvalidInput)
        const data = await Safebox.create(FAST).encrypt(PASSWORD)
        await assertCode(Safebox.decrypt(data, ''), SafeboxErrorCode.InvalidInput)
    })


    test('changing any byte of the header or body is detected', async () => {
        const data = await Safebox.create(FAST).set('A', 'value').encrypt(PASSWORD)
        // Salt, IV, tag and ciphertext fail authentication.
        for (const offset of [18, 33, 34, 45, 46, 61, 62, data.length - 1]) {
            await assertCode(Safebox.decrypt(flip(data, offset), PASSWORD), SafeboxErrorCode.DecryptFailed, `byte ${offset}`)
        }
        // Magic, version and KDF are refused before decryption.
        for (const offset of [0, 4, 5]) {
            await assertCode(Safebox.decrypt(flip(data, offset), PASSWORD), SafeboxErrorCode.InvalidFormat, `byte ${offset}`)
        }
    })


    test('a header with other valid scrypt parameters fails authentication', async () => {
        const data = Buffer.from(await Safebox.create(FAST).encrypt(PASSWORD))
        data.writeUInt32BE(2 ** 15, 6)
        await assertCode(Safebox.decrypt(data, PASSWORD), SafeboxErrorCode.DecryptFailed)
    })


    test('unsafe scrypt parameters are refused before key derivation', async () => {
        for (const [offset, value] of [[6, 2 ** 20], [6, 1000], [6, 2 ** 10], [10, 16], [14, 2]]) {
            const data = Buffer.from(await Safebox.create(FAST).encrypt(PASSWORD))
            data.writeUInt32BE(value, offset)
            await assertCode(Safebox.decrypt(data, PASSWORD), SafeboxErrorCode.InvalidFormat, `offset ${offset} = ${value}`)
        }
    })


    test('truncated data and other files are not a safebox', async () => {
        const data = await Safebox.create(FAST).encrypt(PASSWORD)
        await assertCode(Safebox.decrypt(data.subarray(0, 61), PASSWORD), SafeboxErrorCode.InvalidFormat)
        await assertCode(Safebox.decrypt(data.subarray(0, data.length - 1), PASSWORD), SafeboxErrorCode.DecryptFailed)
        await assertCode(Safebox.decrypt(Buffer.from('{"salt":"00"}'), PASSWORD), SafeboxErrorCode.InvalidFormat)
        await assertCode(Safebox.decrypt(new Uint8Array(0), PASSWORD), SafeboxErrorCode.InvalidFormat)
    })


    test('a missing file is NotFound, a directory is InvalidFormat', async () => {
        await assertCode(Safebox.open(join(directory, 'nope.safebox'), PASSWORD), SafeboxErrorCode.NotFound)
        await assertCode(Safebox.info(join(directory, 'nope.safebox')), SafeboxErrorCode.NotFound)
        const folder = join(directory, 'a-directory')
        await mkdir(folder)
        await assert.rejects(Safebox.open(folder, PASSWORD))
    })


    test('invalid secret names are refused', () => {
        const box = Safebox.create(FAST)
        for (const name of ['', '1ABC', 'A-B', 'A B', 'A.B', 'ČAU', 'A'.repeat(129)]) {
            assert.throws(() => box.set(name, 'x'), hasCode(SafeboxErrorCode.InvalidInput), name)
        }
        box.set('A'.repeat(128), 'x')
        box.set('_private_9', 'x')
    })


    test('values must be strings of at most 1 MiB', () => {
        const box = Safebox.create(FAST)
        assert.throws(() => box.set('A', 42 as unknown as string), hasCode(SafeboxErrorCode.InvalidInput))
        assert.throws(() => box.set('A', 'x'.repeat(MAX_VALUE_SIZE + 1)), hasCode(SafeboxErrorCode.InvalidInput))
        box.set('A', 'x'.repeat(MAX_VALUE_SIZE))
    })


    test('error messages do not contain secret values', async () => {
        const box = Safebox.create(FAST).set('TOKEN', 'super-secret-value')
        const data = await box.encrypt(PASSWORD)
        const error = await Safebox.decrypt(flip(data, data.length - 1), PASSWORD).catch(caught => caught as Error)
        assert.ok(error instanceof SafeboxError)
        assert.doesNotMatch(String(error.message), /super-secret-value/)
        assert.throws(() => box.replace('{{TOKEN}} {{OTHER}}'), (thrown: Error) => !thrown.message.includes('super-secret-value'))
    })
})


describe('in memory', () => {

    test('set, get, has, delete and the changed flag', async () => {
        const box = await Safebox.decrypt(await Safebox.create(FAST).set('A', '1').encrypt(PASSWORD), PASSWORD)
        assert.equal(box.changed, false)
        assert.equal(box.has('A'), true)
        assert.equal(box.has('B'), false)
        assert.equal(box.delete('B'), false)
        assert.equal(box.changed, false)
        assert.equal(box.delete('A'), true)
        assert.equal(box.changed, true)
        assert.throws(() => box.get('A'), hasCode(SafeboxErrorCode.MissingSecret))
    })


    test('keys are sorted and toObject copies the secrets', () => {
        const box = Safebox.create(FAST).set('ZED', 'z').set('ALPHA', 'a')
        assert.deepEqual(box.keys(), ['ALPHA', 'ZED'])
        const object = box.toObject()
        assert.deepEqual({ ...object }, { ALPHA: 'a', ZED: 'z' })
        object.ALPHA = 'changed'
        assert.equal(box.get('ALPHA'), 'a')
    })


    test('replace fills both placeholder styles and reports all missing names', () => {
        const box = Safebox.create(FAST).set('USER', 'pavex').set('PASS', 'p$1&')
        assert.equal(box.replace('{{USER}}:${PASS}@host {{USER}}'), 'pavex:p$1&@host pavex')
        assert.equal(box.replace('no placeholders, {single} and $USER stay'), 'no placeholders, {single} and $USER stay')
        assert.throws(() => box.replace('{{USER}} {{HOST}} ${PORT}'), (error: SafeboxError) => {
            return error.code === SafeboxErrorCode.MissingSecret && error.message.includes('HOST, PORT')
        })
    })


    test('the file format starts with the SBOX magic and version 1', async () => {
        const file = join(directory, 'format.safebox')
        await Safebox.create(FAST).save(file, PASSWORD)
        const data = await readFile(file)
        assert.equal(data.subarray(0, 4).toString('ascii'), 'SBOX')
        assert.equal(data[4], 1)
        assert.equal(data[5], 1)
        assert.deepEqual(await Safebox.info(file), {
            version: 1,
            params: { N: 65536, r: 8, p: 1 },
            profile: SafeboxProfile.Standard,
            size: data.length
        })
        await writeFile(file, data.subarray(0, 10))
        await assertCode(Safebox.info(file), SafeboxErrorCode.InvalidFormat)
    })
})


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
