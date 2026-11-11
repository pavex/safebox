import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SafeboxBuffer, SafeboxErrorCode, SafeboxProfile } from '../../src'
import { assertCode, FAST, hasCode, PASSWORD } from '../support/helpers'


// The life of an instance: create() or load() first, a failed load() changes nothing.

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
