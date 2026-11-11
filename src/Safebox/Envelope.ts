import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import type { KdfParams } from '../interfaces/KdfParams'
import type { SafeboxInfo } from '../interfaces/SafeboxInfo'
import { SafeboxErrorCode } from '../types/SafeboxErrorCode'
import { SafeboxProfile } from '../types/SafeboxProfile'
import { SafeboxError } from './SafeboxError'


// Binary layout, integers big-endian (README.md, section File format):
//
//   0  magic "SBOX"   4      18  salt  16
//   4  version = 1    1      34  IV    12
//   5  KDF = scrypt   1      46  tag   16
//   6  N              4      62  ciphertext
//  10  r              4
//  14  p              4
//
// Bytes 0-45 (everything before the tag) are the AES-GCM additional
// authenticated data, so changing any header field makes decryption fail.

const MAGIC = Buffer.from('SBOX', 'ascii')
const VERSION = 1
const KDF_SCRYPT = 1
const SALT_LENGTH = 16
const IV_LENGTH = 12
const TAG_LENGTH = 16
const KEY_LENGTH = 32
const AAD_LENGTH = 4 + 1 + 1 + 4 + 4 + 4 + SALT_LENGTH + IV_LENGTH
const HEADER_LENGTH = AAD_LENGTH + TAG_LENGTH
const MIN_N = 2 ** 14
const MAX_N = 2 ** 18
const SCRYPT_MAXMEM = 512 * 1024 * 1024
const CIPHER = 'aes-256-gcm'

/** Largest safebox accepted, in bytes. */
export const MAX_FILE_SIZE = 16 * 1024 * 1024

/** scrypt parameters of each profile. */
export const PROFILES: Readonly<Record<SafeboxProfile, Readonly<KdfParams>>> = Object.freeze({
    [SafeboxProfile.Standard]: Object.freeze({ N: 2 ** 16, r: 8, p: 1 }),
    [SafeboxProfile.Recommended]: Object.freeze({ N: 2 ** 17, r: 8, p: 1 }),
    [SafeboxProfile.High]: Object.freeze({ N: 2 ** 18, r: 8, p: 1 })
})


/** Returns the parameters of a profile; accepts the enum or its string value. */
export function profileParams(profile: SafeboxProfile | string): KdfParams {
    if (!Object.hasOwn(PROFILES, profile)) {
        const names = Object.values(SafeboxProfile).join(', ')
        throw new SafeboxError(SafeboxErrorCode.InvalidInput, `Unknown profile "${profile}", use one of: ${names}.`)
    }
    return { ...PROFILES[profile as SafeboxProfile] }
}


/** Returns the profile with exactly these parameters, undefined if none. */
export function matchProfile(params: KdfParams): SafeboxProfile | undefined {
    return Object.values(SafeboxProfile).find(profile => {
        const candidate = PROFILES[profile]
        return candidate.N === params.N && candidate.r === params.r && candidate.p === params.p
    })
}


/** Encrypts the plaintext with a key derived from the password. Fresh salt and IV every call. */
export async function seal(plaintext: Buffer, password: string, params: KdfParams): Promise<Buffer> {
    validatePassword(password)
    validateParams(params, SafeboxErrorCode.InvalidInput)
    const salt = randomBytes(SALT_LENGTH)
    const iv = randomBytes(IV_LENGTH)
    const aad = writeAad(params, salt, iv)
    const key = await deriveKey(password, salt, params)
    try {
        const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_LENGTH })
        cipher.setAAD(aad)
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
        const data = Buffer.concat([aad, cipher.getAuthTag(), ciphertext])
        if (data.length > MAX_FILE_SIZE) {
            throw new SafeboxError(SafeboxErrorCode.InvalidInput, 'The safebox would exceed the maximum size of 16 MiB.')
        }
        return data
    }
    finally {
        key.fill(0)
    }
}


/** Checks the header, then decrypts and authenticates. Returns the plaintext and the stored parameters. */
export async function unseal(data: Uint8Array, password: string): Promise<{ plaintext: Buffer, params: KdfParams }> {
    validatePassword(password)
    const header = parseHeader(data)
    const key = await deriveKey(password, header.salt, header.params)
    try {
        const decipher = createDecipheriv(CIPHER, key, header.iv, { authTagLength: TAG_LENGTH })
        decipher.setAAD(header.aad)
        decipher.setAuthTag(header.tag)
        const plaintext = Buffer.concat([decipher.update(header.ciphertext), decipher.final()])
        return { plaintext, params: header.params }
    }
    catch (error) {
        throw new SafeboxError(
            SafeboxErrorCode.DecryptFailed,
            'Cannot open the safebox: wrong password, or the file was changed or damaged.',
            { cause: error }
        )
    }
    finally {
        key.fill(0)
    }
}


/** Reads the header without decrypting anything. */
export function readInfo(data: Uint8Array): SafeboxInfo {
    const header = parseHeader(data)
    return { version: header.version, params: header.params, profile: matchProfile(header.params), size: data.byteLength }
}


// Splits the data into header fields and validates them before any key derivation,
// so a crafted file cannot make scrypt allocate more than the limits allow.
function parseHeader(data: Uint8Array) {
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    if (buffer.length < HEADER_LENGTH || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new SafeboxError(SafeboxErrorCode.InvalidFormat, 'Not a safebox file.')
    }
    if (buffer.length > MAX_FILE_SIZE) {
        throw new SafeboxError(SafeboxErrorCode.InvalidFormat, 'The safebox is larger than 16 MiB.')
    }
    const version = buffer.readUInt8(4)
    if (version !== VERSION) {
        throw new SafeboxError(SafeboxErrorCode.InvalidFormat, `Unsupported safebox version ${version}.`)
    }
    const kdf = buffer.readUInt8(5)
    if (kdf !== KDF_SCRYPT) {
        throw new SafeboxError(SafeboxErrorCode.InvalidFormat, `Unsupported key derivation ${kdf}.`)
    }
    const params = { N: buffer.readUInt32BE(6), r: buffer.readUInt32BE(10), p: buffer.readUInt32BE(14) }
    validateParams(params, SafeboxErrorCode.InvalidFormat)
    return {
        version,
        params,
        salt: buffer.subarray(18, 18 + SALT_LENGTH),
        iv: buffer.subarray(34, 34 + IV_LENGTH),
        aad: buffer.subarray(0, AAD_LENGTH),
        tag: buffer.subarray(AAD_LENGTH, HEADER_LENGTH),
        ciphertext: buffer.subarray(HEADER_LENGTH)
    }
}


function writeAad(params: KdfParams, salt: Buffer, iv: Buffer): Buffer {
    const aad = Buffer.alloc(AAD_LENGTH)
    MAGIC.copy(aad, 0)
    aad.writeUInt8(VERSION, 4)
    aad.writeUInt8(KDF_SCRYPT, 5)
    aad.writeUInt32BE(params.N, 6)
    aad.writeUInt32BE(params.r, 10)
    aad.writeUInt32BE(params.p, 14)
    salt.copy(aad, 18)
    iv.copy(aad, 34)
    return aad
}


// The password is normalized to NFC, so the same text typed on different systems
// (composed or decomposed accents) gives the same key.
function deriveKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
    const secret = Buffer.from(password.normalize('NFC'), 'utf8')
    return new Promise<Buffer>((resolve, reject) => {
        scrypt(secret, salt, KEY_LENGTH, { ...params, maxmem: SCRYPT_MAXMEM }, (error, key) => {
            secret.fill(0)
            if (error) {
                reject(error)
            }
            else {
                resolve(key)
            }
        })
    })
}


function validatePassword(password: unknown): void {
    if (typeof password !== 'string' || password.length === 0) {
        throw new SafeboxError(SafeboxErrorCode.InvalidInput, 'The password must be a non-empty string.')
    }
}


// Only the values the profiles produce, plus N = 2^14 and 2^15 for small devices.
function validateParams(params: KdfParams, code: SafeboxErrorCode): void {
    const { N, r, p } = params
    const valid = Number.isSafeInteger(N) && N >= MIN_N && N <= MAX_N && (N & (N - 1)) === 0 && r === 8 && p === 1
    if (!valid) {
        throw new SafeboxError(code, `Unsupported scrypt parameters N=${N}, r=${r}, p=${p}.`)
    }
}
