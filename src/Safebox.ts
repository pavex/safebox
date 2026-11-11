import type { KdfParams } from './interfaces/KdfParams'
import type { SafeboxInfo } from './interfaces/SafeboxInfo'
import type { SafeboxOptions } from './interfaces/SafeboxOptions'
import { SafeboxErrorCode } from './types/SafeboxErrorCode'
import { SafeboxProfile } from './types/SafeboxProfile'
import { matchProfile, profileParams, readInfo, seal, unseal } from './Safebox/Envelope'
import { deserialize, MAX_SECRETS, serialize, validateName, validateValue } from './Safebox/Payload'
import { SafeboxError } from './Safebox/SafeboxError'
import { readSafeboxFile, writeSafeboxFile } from './Safebox/SafeboxFile'


// A safebox is one encrypted file with named string secrets. It travels with the
// app (repository, deploy package), the password comes from somewhere else
// (environment, prompt, admin), so the secrets never sit in plain text on disk.
//
// After open() everything is in memory. The password is not kept: save() asks
// for it again, which also makes changing the password a plain save(). Crypto
// and file layout are in Safebox/Envelope.ts and SPECIFICATION.md.

const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g


/** Named string secrets kept in one password-encrypted file. */
export class Safebox {

    private secrets: Map<string, string>
    private params: KdfParams
    private dirty: boolean


    private constructor(secrets: Map<string, string>, params: KdfParams, dirty: boolean) {
        this.secrets = secrets
        this.params = params
        this.dirty = dirty
    }


    /** Creates an empty safebox in memory; nothing is written until save(). */
    static create(options: SafeboxOptions = {}): Safebox {
        return new Safebox(new Map(), profileParams(options.profile ?? SafeboxProfile.Recommended), true)
    }


    /** Reads and decrypts a safebox file. */
    static async open(path: string, password: string): Promise<Safebox> {
        return Safebox.decrypt(await readSafeboxFile(path), password)
    }


    /** Decrypts a safebox from bytes, e.g. one embedded in a bundle or fetched from storage. */
    static async decrypt(data: Uint8Array, password: string): Promise<Safebox> {
        const { plaintext, params } = await unseal(data, password)
        try {
            return new Safebox(deserialize(plaintext), params, false)
        }
        finally {
            plaintext.fill(0)
        }
    }


    /** Reads the header of a safebox file; needs no password. */
    static async info(path: string): Promise<SafeboxInfo> {
        return readInfo(await readSafeboxFile(path))
    }


    /** True when there are changes since create(), open() or the last save(). */
    get changed(): boolean {
        return this.dirty
    }


    /** Key derivation profile the next save() uses by default, undefined for custom parameters. */
    get profile(): SafeboxProfile | undefined {
        return matchProfile(this.params)
    }


    /** Number of secrets. */
    get size(): number {
        return this.secrets.size
    }


    /** Secret names, sorted. */
    keys(): string[] {
        return [...this.secrets.keys()].sort()
    }


    /** Whether a secret exists. */
    has(name: string): boolean {
        validateName(name)
        return this.secrets.has(name)
    }


    /** Returns a secret; throws MissingSecret if there is none of that name. */
    get(name: string): string {
        validateName(name)
        const value = this.secrets.get(name)
        if (value === undefined) {
            throw new SafeboxError(SafeboxErrorCode.MissingSecret, `No secret named ${name}.`)
        }
        return value
    }


    /** Adds or replaces a secret in memory. */
    set(name: string, value: string): this {
        validateName(name)
        validateValue(value)
        if (!this.secrets.has(name) && this.secrets.size >= MAX_SECRETS) {
            throw new SafeboxError(SafeboxErrorCode.InvalidInput, `A safebox holds at most ${MAX_SECRETS} secrets.`)
        }
        this.secrets.set(name, value)
        this.dirty = true
        return this
    }


    /** Removes a secret; returns whether it existed. */
    delete(name: string): boolean {
        validateName(name)
        const existed = this.secrets.delete(name)
        this.dirty ||= existed
        return existed
    }


    /** All secrets as a plain object (no prototype), e.g. to pass as a child process environment. */
    toObject(): Record<string, string> {
        const result: Record<string, string> = Object.create(null)
        for (const name of this.keys()) {
            result[name] = this.secrets.get(name) as string
        }
        return result
    }


    /**
     * Replaces {{NAME}} and ${NAME} placeholders with secret values. Plain text
     * substitution: escaping for JSON, shell, SQL and so on is up to the caller.
     * Throws MissingSecret listing every unknown name.
     */
    replace(template: string): string {
        if (typeof template !== 'string') {
            throw new SafeboxError(SafeboxErrorCode.InvalidInput, 'The template must be a string.')
        }
        const missing = new Set<string>()
        const result = template.replace(PLACEHOLDER, (placeholder, braced?: string, dollar?: string) => {
            const name = (braced ?? dollar) as string
            const value = this.secrets.get(name)
            if (value === undefined) {
                missing.add(name)
                return placeholder
            }
            return value
        })
        if (missing.size > 0) {
            throw new SafeboxError(SafeboxErrorCode.MissingSecret, `No secret named ${[...missing].join(', ')}.`)
        }
        return result
    }


    /** Encrypts to bytes without writing anything. Fresh salt and IV every call. */
    async encrypt(password: string, options: SafeboxOptions = {}): Promise<Buffer> {
        const params = options.profile === undefined ? this.params : profileParams(options.profile)
        const plaintext = serialize(this.secrets)
        try {
            return await seal(plaintext, password, params)
        }
        finally {
            plaintext.fill(0)
        }
    }


    /**
     * Encrypts and atomically replaces the file. Saving with a different password
     * changes the password; a profile option changes the key derivation strength.
     */
    async save(path: string, password: string, options: SafeboxOptions = {}): Promise<void> {
        const params = options.profile === undefined ? this.params : profileParams(options.profile)
        await writeSafeboxFile(path, await this.encrypt(password, options))
        this.params = params
        this.dirty = false
    }
}
