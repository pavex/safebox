import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_VALUE_SIZE, SafeboxBuffer, SafeboxError, SafeboxErrorCode } from '../../src'
import { encrypt, FAST, hasCode, PASSWORD } from '../support/helpers'


// Working with secrets in memory: names, values, the changed flag, replace().

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


test('a name like __proto__ is an ordinary secret', async () => {
    const data = await encrypt(new SafeboxBuffer().create(FAST).set('__proto__', 'x').set('constructor', 'y'))
    const box = await new SafeboxBuffer(data).load(PASSWORD)
    assert.equal(box.get('__proto__'), 'x')
    assert.equal(box.get('constructor'), 'y')
    assert.equal(Object.getPrototypeOf(box.toObject()), null)
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
