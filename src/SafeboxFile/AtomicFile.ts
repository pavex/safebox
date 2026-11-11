import { randomBytes } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { SafeboxErrorCode } from '../types/SafeboxErrorCode'
import { MAX_FILE_SIZE } from '../Safebox/Envelope'
import { SafeboxError } from '../Safebox/SafeboxError'


// Writes go to a temporary file in the same directory, which is flushed and then
// renamed over the target, so readers see either the old or the new safebox,
// never half of one. On Windows a rename can fail for a moment while another
// process (antivirus, indexer) holds the target open, hence the retries.

const RENAME_RETRIES = 5
const RENAME_RETRY_MS = 50
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY'])


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
    const directory = dirname(target)
    const temporary = join(directory, `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
    let renamed = false
    try {
        const handle = await open(temporary, 'wx', 0o600)
        try {
            await handle.writeFile(data)
            await handle.sync()
        }
        finally {
            await handle.close()
        }
        await renameWithRetry(temporary, target)
        renamed = true
        await syncDirectory(directory)
    }
    finally {
        if (!renamed) {
            await unlink(temporary).catch(() => undefined)
        }
    }
}


async function renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            await rename(from, to)
            return
        }
        catch (error) {
            const code = (error as NodeJS.ErrnoException).code ?? ''
            if (process.platform !== 'win32' || !RETRYABLE.has(code) || attempt >= RENAME_RETRIES) {
                throw error
            }
            await new Promise(done => setTimeout(done, RENAME_RETRY_MS * attempt))
        }
    }
}


// Makes the rename itself durable where the platform allows it; Windows does not.
async function syncDirectory(directory: string): Promise<void> {
    try {
        const handle = await open(directory, 'r')
        try {
            await handle.sync()
        }
        finally {
            await handle.close()
        }
    }
    catch {
        // Not supported on every platform.
    }
}
