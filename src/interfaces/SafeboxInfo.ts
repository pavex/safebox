import type { SafeboxProfile } from '../types/SafeboxProfile'
import type { KdfParams } from './KdfParams'


/** What the header of a safebox tells without the password. */
export interface SafeboxInfo {
    /** File format version. */
    version: number
    params: KdfParams
    /** Profile with the same parameters, undefined if none matches. */
    profile: SafeboxProfile | undefined
    /** Size in bytes. */
    size: number
}
