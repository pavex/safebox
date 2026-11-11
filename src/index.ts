// Public API of pavex-safebox. Copy the whole src/ folder into an app, or
// import the package; only Node.js built-in modules are used.

export { Safebox } from './Safebox'
export { SafeboxError } from './Safebox/SafeboxError'
export { MAX_FILE_SIZE, PROFILES } from './Safebox/Envelope'
export { MAX_NAME_LENGTH, MAX_SECRETS, MAX_VALUE_SIZE } from './Safebox/Payload'
export { SafeboxErrorCode } from './types/SafeboxErrorCode'
export { SafeboxProfile } from './types/SafeboxProfile'
export type { KdfParams } from './interfaces/KdfParams'
export type { SafeboxInfo } from './interfaces/SafeboxInfo'
export type { SafeboxOptions } from './interfaces/SafeboxOptions'
