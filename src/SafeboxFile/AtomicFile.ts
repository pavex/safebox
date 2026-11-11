import { randomBytes } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { SafeboxErrorCode } from '../types/SafeboxErrorCode'
import { MAX_FILE_SIZE } from '../Safebox/Envelope'
import { SafeboxError } from '../Safebox/SafeboxError'


// Writes go to a temporary file in the same directory, which is flushed and then
// renamed over the target. A crash or a full disk mid-write leaves the old safebox
// intact (a half-written one would not decrypt at all), and readers see either
// the old or the new file, never half of one.


/** Reads a safebox file, refusing anything that is not a regular file or is too large. */
export async function readFileLimited(path: string): Promise<Buffer> {
    const handle = await open(path, 'r').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            throw new SafeboxError(SafeboxErrorCode.NotFound, `The safebox file does not exist: ${resolve(path)}`, { cause: error })
        }
        throw error
    })
    try {
        const stat = await handle.stat()
        if (!stat.isFile()) {
            throw new SafeboxError(SafeboxErrorCode.InvalidFormat, `Not a regular file: ${resolve(path)}`)
        }
        if (stat.size > MAX_FILE_SIZE) {
            throw new SafeboxError(SafeboxErrorCode.InvalidFormat, 'The safebox is larger than 16 MiB.')
        }
        return await handle.readFile()
    }
    finally {
        await handle.close()
    }
}


/** Replaces the file atomically. A new file gets mode 0600 on POSIX. */
export async function writeFileAtomic(path: string, data: Buffer): Promise<void> {
    const target = resolve(path)
    const temporary = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
    try {
        const handle = await open(temporary, 'wx', 0o600)
        try {
            await handle.writeFile(data)
            await handle.sync()
        }
        finally {
            await handle.close()
        }
        await rename(temporary, target)
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined)
        throw error
    }
}
