/** Strength of the key derivation: higher costs more time and memory on every open and save. */
export enum SafeboxProfile {
    /** scrypt N = 2^16, about 64 MiB. */
    Standard = 'standard',
    /** scrypt N = 2^17, about 128 MiB. The default. */
    Recommended = 'recommended',
    /** scrypt N = 2^18, about 256 MiB. */
    High = 'high'
}
