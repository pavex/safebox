import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { Safebox, SafeboxBuffer, SafeboxErrorCode, SafeboxFile } from '../../src'
import { assertCode, FAST, PASSWORD, temporaryDirectory } from '../support/helpers'


// SafeboxBuffer and storages of one's own: the abstract Safebox needs only read() and write().

const directory = temporaryDirectory()


test('SafeboxBuffer keeps the saved bytes, a new buffer loads them', async () => {
    const box = new SafeboxBuffer().create(FAST).set('A', '1')
    assert.equal(box.data, undefined)
    await box.save(PASSWORD)
    assert.ok((box.data as unknown) instanceof Uint8Array)
    assert.equal((await new SafeboxBuffer(box.data).load(PASSWORD)).get('A'), '1')
})


test('an empty SafeboxBuffer is NotFound', async () => {
    await assertCode(new SafeboxBuffer().load(PASSWORD), SafeboxErrorCode.NotFound)
})


test('a buffer and a file hold the same format', async () => {
    const file = join(directory(), 'from-buffer.safebox')
    const buffer = new SafeboxBuffer().create(FAST).set('A', '1')
    await buffer.save(PASSWORD)
    await writeFile(file, buffer.data as Uint8Array)
    assert.equal((await new SafeboxFile(file).load(PASSWORD)).get('A'), '1')
})


test('a storage of one\'s own only implements read and write', async () => {
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
