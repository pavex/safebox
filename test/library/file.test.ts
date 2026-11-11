import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { PROFILES, SafeboxErrorCode, SafeboxFile, SafeboxProfile } from '../../src'
import { assertCode, FAST, PASSWORD, temporaryDirectory } from '../support/helpers'


// SafeboxFile: storing in a file, atomic replacement, the file format on disk.

const directory = temporaryDirectory()


test('a saved safebox loads with the same password and secrets', async () => {
    const file = join(directory(), 'roundtrip.safebox')
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
    const file = join(directory(), 'empty.safebox')
    await new SafeboxFile(file).create(FAST).save(PASSWORD)
    const box = await new SafeboxFile(file).load(PASSWORD)
    assert.equal(box.size, 0)
    await box.set('EMPTY', '').save(PASSWORD)
    assert.equal((await new SafeboxFile(file).load(PASSWORD)).get('EMPTY'), '')
})


test('saving with another password changes the password', async () => {
    const file = join(directory(), 'passwd.safebox')
    const box = new SafeboxFile(file).create(FAST).set('A', '1')
    await box.save(PASSWORD)
    await box.save('new password 123')
    await assertCode(new SafeboxFile(file).load(PASSWORD), SafeboxErrorCode.DecryptFailed)
    assert.equal((await new SafeboxFile(file).load('new password 123')).get('A'), '1')
})


test('the profile is kept on save unless a new one is given', async () => {
    const file = join(directory(), 'profile.safebox')
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
    const folder = join(directory(), 'atomic')
    await mkdir(folder)
    const file = join(folder, 'app.safebox')
    await new SafeboxFile(file).create(FAST).set('A', '1').save(PASSWORD)
    await new SafeboxFile(file).create(FAST).set('B', '2').save(PASSWORD)
    assert.deepEqual(await readdir(folder), ['app.safebox'])
    assert.deepEqual((await new SafeboxFile(file).load(PASSWORD)).keys(), ['B'])
})


test('a failed save keeps the changes marked as unsaved', async () => {
    const box = new SafeboxFile(join(directory(), 'missing-dir', 'x.safebox')).create(FAST).set('A', '1')
    await assert.rejects(box.save(PASSWORD))
    assert.equal(box.changed, true)
})


test('a missing file is NotFound, a directory is refused', async () => {
    const missing = new SafeboxFile(join(directory(), 'nope.safebox'))
    await assertCode(missing.load(PASSWORD), SafeboxErrorCode.NotFound)
    await assertCode(missing.info(), SafeboxErrorCode.NotFound)
    const folder = join(directory(), 'a-directory')
    await mkdir(folder)
    await assert.rejects(new SafeboxFile(folder).load(PASSWORD))
})


test('the file starts with the SBOX magic and version 1', async () => {
    const file = join(directory(), 'format.safebox')
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
