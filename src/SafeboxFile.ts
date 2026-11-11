import { resolve } from 'node:path'
import { Safebox } from './Safebox'
import { readFileLimited, writeFileAtomic } from './SafeboxFile/AtomicFile'


// The usual storage: one file on disk. Reading refuses anything that is not a
// regular file or is too large; writing replaces the file atomically
// (SafeboxFile/AtomicFile.ts).

/** Safebox stored in a file. */
export class SafeboxFile extends Safebox {

    /** Absolute path of the file. */
    readonly path: string


    constructor(path: string) {
        super()
        this.path = resolve(path)
    }


    /** Reads the file. */
    protected read(): Promise<Uint8Array> {
        return readFileLimited(this.path)
    }


    /** Replaces the file atomically; a new file gets mode 0600 on POSIX. */
    protected write(data: Buffer): Promise<void> {
        return writeFileAtomic(this.path, data)
    }
}
