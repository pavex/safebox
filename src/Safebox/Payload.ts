import { SafeboxErrorCode } from '../types/SafeboxErrorCode'
import { SafeboxError } from './SafeboxError'


// The decrypted content is JSON: { "format": 1, "secrets": { "NAME": "value" } }.
// Unknown top-level fields are ignored, so later versions can add metadata.

const FORMAT = 1
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Longest secret name, in characters. */
export const MAX_NAME_LENGTH = 128

/** Largest secret value, in UTF-8 bytes. */
export const MAX_VALUE_SIZE = 1024 * 1024

/** Most secrets in one safebox. */
export const MAX_SECRETS = 10_000


/** Throws unless the name is a valid secret name (letters, digits, underscore; no leading digit). */
export function validateName(name: unknown): asserts name is string {
    if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
        throw new SafeboxError(
            SafeboxErrorCode.InvalidInput,
            `Invalid secret name "${String(name).slice(0, MAX_NAME_LENGTH)}": use letters, digits and _, not starting with a digit, at most ${MAX_NAME_LENGTH} characters.`
        )
    }
}


/** Throws unless the value is a string within the size limit. */
export function validateValue(value: unknown): asserts value is string {
    if (typeof value !== 'string') {
        throw new SafeboxError(SafeboxErrorCode.InvalidInput, 'A secret value must be a string.')
    }
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_SIZE) {
        throw new SafeboxError(SafeboxErrorCode.InvalidInput, 'A secret value must be at most 1 MiB.')
    }
}


/** Turns the secrets into the plaintext JSON, sorted by name. */
export function serialize(secrets: ReadonlyMap<string, string>): Buffer {
    const sorted = [...secrets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return Buffer.from(JSON.stringify({ format: FORMAT, secrets: Object.fromEntries(sorted) }), 'utf8')
}


/** Parses and validates the plaintext JSON. */
export function deserialize(plaintext: Buffer): Map<string, string> {
    let payload: unknown
    try {
        payload = JSON.parse(plaintext.toString('utf8'))
    }
    catch {
        throw invalid('the content is not JSON')
    }
    if (!isPlainObject(payload) || payload.format !== FORMAT) {
        throw invalid('unsupported content format')
    }
    if (!isPlainObject(payload.secrets)) {
        throw invalid('secrets must be an object')
    }
    const entries = Object.entries(payload.secrets)
    if (entries.length > MAX_SECRETS) {
        throw invalid(`more than ${MAX_SECRETS} secrets`)
    }
    const secrets = new Map<string, string>()
    for (const [name, value] of entries) {
        try {
            validateName(name)
            validateValue(value)
        }
        catch (error) {
            throw invalid((error as Error).message)
        }
        secrets.set(name, value)
    }
    return secrets
}


function invalid(reason: string): SafeboxError {
    return new SafeboxError(SafeboxErrorCode.InvalidFormat, `Invalid safebox content: ${reason}`)
}


function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
