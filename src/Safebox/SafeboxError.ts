import type { SafeboxErrorCode } from '../types/SafeboxErrorCode'


/** Error thrown by Safebox, with a code to branch on. Messages never contain secret values. */
export class SafeboxError extends Error {

    readonly code: SafeboxErrorCode


    constructor(code: SafeboxErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'SafeboxError'
        this.code = code
    }
}
