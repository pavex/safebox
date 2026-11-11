import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before } from 'node:test'
import { SafeboxError, SafeboxProfile } from '../../src'
import type { SafeboxBuffer, SafeboxErrorCode } from '../../src'


// Shared by the library tests. Standard is the cheapest profile; every load
// and save still runs scrypt for real.

/** Options for create() that keep the tests fast. */
export const FAST = { profile: SafeboxProfile.Standard }

/** Password the tests use unless they test passwords. */
export const PASSWORD = 'correct horse battery staple'


/** A temporary directory for the tests of one file, removed afterwards; call at the top level. */
export function temporaryDirectory(): () => string {
    let directory = ''
    before(async () => {
        directory = await mkdtemp(join(tmpdir(), 'safebox-test-'))
    })
    after(async () => {
        await rm(directory, { recursive: true, force: true })
    })
    return () => directory
}


/** Saves the safebox and returns a copy of the encrypted bytes. */
export async function encrypt(box: SafeboxBuffer, password = PASSWORD): Promise<Buffer> {
    await box.save(password)
    return Buffer.from(box.data as Uint8Array)
}


/** Asserts that the promise rejects with a SafeboxError of the code. */
export async function assertCode(promise: Promise<unknown>, code: SafeboxErrorCode, message?: string): Promise<void> {
    await assert.rejects(promise, hasCode(code), message)
}


/** Matcher for assert.throws and assert.rejects. */
export function hasCode(code: SafeboxErrorCode) {
    return (error: unknown) => error instanceof SafeboxError && error.code === code
}


/** Copy of the data with one bit flipped. */
export function flip(data: Buffer, offset: number): Buffer {
    const copy = Buffer.from(data)
    copy[offset] ^= 0x01
    return copy
}
