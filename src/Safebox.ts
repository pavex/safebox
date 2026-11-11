import type { KdfParams } from './interfaces/KdfParams'
import type { SafeboxInfo } from './interfaces/SafeboxInfo'
import type { SafeboxOptions } from './interfaces/SafeboxOptions'
import { SafeboxErrorCode } from './types/SafeboxErrorCode'
import { SafeboxProfile } from './types/SafeboxProfile'
import { matchProfile, profileParams, readInfo, seal, unseal } from './Safebox/Envelope'
import { deserialize, MAX_SECRETS, serialize, validateName, validateValue } from './Safebox/Payload'
import { SafeboxError } from './Safebox/SafeboxError'


// A safebox is a set of named string secrets stored encrypted. It travels with
// the app (repository, deploy package), the password comes from somewhere else
// (environment, prompt, admin), so the secrets never sit in plain text.
//
// This class holds the secrets in memory and does the encryption; where the
// encrypted bytes live is up to a subclass (SafeboxFile, SafeboxBuffer), which
// implements read() and write(). The password is never kept: load() and save()
// each take it, so changing the password is a save() with the new one.
// Crypto and layout: Safebox/Envelope.ts and SPECIFICATION.md.

const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g


/** Named string secrets kept encrypted with a password. Subclasses decide where the bytes are stored. */
export abstract class Safebox {

    private secrets = new Map<string, string>()
    private params: KdfParams | undefined
    private dirty = false


    /** Starts an empty safebox in memory; nothing is stored until save(). Throws if already loaded. */
    create(options: SafeboxOptions = {}): this {
        if (this.params !== undefined) {
            throw new SafeboxError(SafeboxErrorCode.InvalidState, 'The safebox is already loaded.')
        }
        this.params = profileParams(options.profile ?? SafeboxProfile.Recommended)
        this.secrets = new Map()
        this.dirty = true
        return this
    }


    /** Reads and decrypts the stored safebox. On failure the current state stays as it was. */
    async load(password: string): Promise<this> {
        const { plaintext, params } = await unseal(await this.read(), password)
        try {
            this.secrets = deserialize(plaintext)
        }
        finally {
            plaintext.fill(0)
        }
        this.params = params
        this.dirty = false
        return this
    }


    /**
     * Encrypts the secrets and stores them. Fresh salt and IV every time. The
     * profile option changes the key derivation strength, otherwise it is kept.
     */
    async save(password: string, options: SafeboxOptions = {}): Promise<this> {
        const params = options.profile === undefined ? this.loadedParams() : profileParams(options.profile)
        const plaintext = serialize(this.secrets)
        let data: Buffer
        try {
            data = await seal(plaintext, password, params)
        }
        finally {
            plaintext.fill(0)
        }
        await this.write(data)
        this.params = params
        this.dirty = false
        return this
    }


    /** Reads the header of the stored safebox; needs no password and does not load anything. */
    async info(): Promise<SafeboxInfo> {
        return readInfo(await this.read())
    }


    /** True after create() or a successful load(). */
    get loaded(): boolean {
        return this.params !== undefined
    }


    /** True when there are changes since create(), load() or the last save(). */
    get changed(): boolean {
        return this.dirty
    }


    /** Key derivation profile the next save() uses, undefined for custom parameters or when not loaded. */
    get profile(): SafeboxProfile | undefined {
        return this.params === undefined ? undefined : matchProfile(this.params)
    }


    /** Number of secrets. */
    get size(): number {
        this.loadedParams()
        return this.secrets.size
    }


    /** Secret names, sorted. */
    keys(): string[] {
        this.loadedParams()
        return [...this.secrets.keys()].sort()
    }


    /** Whether a secret exists. */
    has(name: string): boolean {
        this.loadedParams()
        validateName(name)
        return this.secrets.has(name)
    }


    /** Returns a secret; throws MissingSecret if there is none of that name. */
    get(name: string): string {
        this.loadedParams()
        validateName(name)
        const value = this.secrets.get(name)
        if (value === undefined) {
            throw new SafeboxError(SafeboxErrorCode.MissingSecret, `No secret named ${name}.`)
        }
        return value
    }


    /** Adds or replaces a secret in memory. */
    set(name: string, value: string): this {
        this.loadedParams()
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
        this.loadedParams()
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
        this.loadedParams()
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


    /** Returns the stored encrypted bytes; throws SafeboxError NotFound when there are none. */
    protected abstract read(): Promise<Uint8Array>


    /** Replaces the stored encrypted bytes. */
    protected abstract write(data: Buffer): Promise<void>


    // Throws unless create() or load() has run; returns the current parameters.
    private loadedParams(): KdfParams {
        if (this.params === undefined) {
            throw new SafeboxError(SafeboxErrorCode.InvalidState, 'The safebox is not loaded: call load() or create() first.')
        }
        return this.params
    }
}
