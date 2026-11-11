import { Safebox } from './Safebox'
import { SafeboxErrorCode } from './types/SafeboxErrorCode'
import { SafeboxError } from './Safebox/SafeboxError'


// For encrypted bytes that do not live in a file of their own: embedded in a
// bundle, fetched from a database or object storage, sent over the network.
// save() keeps the result in `data` for the caller to store.

/** Safebox stored in memory as encrypted bytes. */
export class SafeboxBuffer extends Safebox {

    private bytes: Uint8Array | undefined


    /** Takes the encrypted bytes to load(), or nothing for a new safebox. */
    constructor(data?: Uint8Array) {
        super()
        this.bytes = data
    }


    /** The encrypted bytes: those given to the constructor, or the result of the last save(). */
    get data(): Uint8Array | undefined {
        return this.bytes
    }


    /** Returns the bytes; NotFound when there are none. */
    protected async read(): Promise<Uint8Array> {
        if (this.bytes === undefined) {
            throw new SafeboxError(SafeboxErrorCode.NotFound, 'The safebox buffer is empty.')
        }
        return this.bytes
    }


    /** Keeps the bytes. */
    protected async write(data: Buffer): Promise<void> {
        this.bytes = data
    }
}
