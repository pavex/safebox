import type { SafeboxProfile } from '../types/SafeboxProfile'


/** Options of Safebox create() and save(). */
export interface SafeboxOptions {
    /** Key derivation strength. create() defaults to Recommended, save() keeps the current one. */
    profile?: SafeboxProfile
}
