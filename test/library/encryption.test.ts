import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SafeboxBuffer, SafeboxError, SafeboxErrorCode } from '../../src'
import { assertCode, encrypt, FAST, flip, PASSWORD } from '../support/helpers'


// Encryption and its defences: passwords, authentication of every byte,
// limits on the scrypt parameters a file may ask for.

test('unicode values and passwords; composed and decomposed accents are the same password', async () => {
    const composed = 'Příliš žluťoučký kůň \u{1F511}'
    const decomposed = composed.normalize('NFD')
    assert.notEqual(composed, decomposed)
    const data = await encrypt(new SafeboxBuffer().create(FAST).set('GREETING', 'Čau \u{1F44B}'), composed)
    assert.equal((await new SafeboxBuffer(data).load(decomposed)).get('GREETING'), 'Čau \u{1F44B}')
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
