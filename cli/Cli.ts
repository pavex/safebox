import { readFile, stat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { SafeboxError, SafeboxFile } from '../src'
import type { SafeboxProfile } from '../src'
import { ExitCode } from './types/ExitCode'
import { CliError } from './Cli/CliError'
import { Passwords } from './Cli/Passwords'
import { canPrompt, promptHidden, readStdin } from './Cli/Prompt'
import { USAGE } from './Cli/Usage'


// Command line front end of the library; it uses only the public API in
// ../src/index.ts. One Cli instance runs one command. Data (values, names,
// info) goes to stdout, messages to stderr. Where passwords come from is in
// Cli/Passwords.ts.

const OPTIONS = {
    'profile': { type: 'string' },
    'force': { type: 'boolean' },
    'from-file': { type: 'string' },
    'password-file': { type: 'string' },
    'new-password-file': { type: 'string' },
    'help': { type: 'boolean', short: 'h' },
    'version': { type: 'boolean', short: 'v' }
} as const


// Options a command can take (help and version work everywhere).
type Option = 'profile' | 'force' | 'from-file' | 'password-file' | 'new-password-file'


interface Command {
    // Names of the positional arguments after the command name.
    args: string[]
    options: Option[]
    run(file: string, args: string[]): Promise<void>
}


/** The safebox command line tool. */
export class Cli {

    private version: string
    private values: Partial<Record<Option, string | boolean>> = {}
    private passwords!: Passwords


    constructor(version: string) {
        this.version = version
    }


    /** Runs one command (arguments without node and the script) and returns the exit code. */
    async run(argv: string[]): Promise<ExitCode> {
        try {
            const { values, positionals } = parse(argv)
            if (values.version) {
                process.stdout.write(`${this.version}\n`)
                return ExitCode.Success
            }
            const [file, name, ...args] = positionals
            if (values.help || file === undefined || file === 'help') {
                process.stdout.write(USAGE)
                return file === undefined && !values.help ? ExitCode.Usage : ExitCode.Success
            }
            const command = this.command(file, name, args, Object.keys(values))
            this.values = values
            this.passwords = new Passwords(file, values['password-file'], values['new-password-file'])
            await command.run(file, args)
            return ExitCode.Success
        }
        catch (error) {
            const known = error instanceof CliError || error instanceof SafeboxError
            process.stderr.write(`safebox: ${known ? error.message : String((error as Error)?.message ?? error)}\n`)
            return error instanceof CliError ? error.exitCode : ExitCode.Error
        }
    }


    // Finds the command (safebox <file> <command>) and checks its arguments and options.
    private command(file: string, name: string | undefined, args: string[], options: string[]): Command {
        const commands = this.commands()
        if (name === undefined) {
            throw new CliError(`What to do with ${file}? Run safebox --help.`, ExitCode.Usage)
        }
        if (!Object.hasOwn(commands, name)) {
            throw new CliError(`Unknown command "${name}". Run safebox --help.`, ExitCode.Usage)
        }
        const command = commands[name]
        if (args.length !== command.args.length) {
            const usage = ['safebox', file, name, ...command.args.map(arg => `<${arg}>`)].join(' ')
            throw new CliError(`Usage: ${usage}`, ExitCode.Usage)
        }
        for (const option of options) {
            if (option !== 'help' && option !== 'version' && !command.options.includes(option as Option)) {
                throw new CliError(`${name} does not take --${option}.`, ExitCode.Usage)
            }
        }
        return command
    }


    private commands(): Record<string, Command> {
        return {
            create: { args: [], options: ['profile', 'force', 'password-file'], run: file => this.create(file) },
            set: { args: ['NAME'], options: ['from-file', 'password-file'], run: (file, [name]) => this.set(file, name) },
            get: { args: ['NAME'], options: ['password-file'], run: (file, [name]) => this.get(file, name) },
            list: { args: [], options: ['password-file'], run: file => this.list(file) },
            delete: { args: ['NAME'], options: ['password-file'], run: (file, [name]) => this.delete(file, name) },
            passwd: { args: [], options: ['profile', 'password-file', 'new-password-file'], run: file => this.passwd(file) },
            info: { args: [], options: [], run: file => this.info(file) }
        }
    }


    private async create(file: string): Promise<void> {
        if (!this.values.force && await exists(file)) {
            throw new CliError(`${file} already exists; use --force to replace it.`)
        }
        const box = new SafeboxFile(file).create({ profile: this.profile() })
        await box.save(await this.passwords.forCreate())
        note(`Created ${file}.`)
    }


    private async info(file: string): Promise<void> {
        const header = await new SafeboxFile(file).info()
        const { N, r, p } = header.params
        process.stdout.write([
            `file: ${file}`,
            `format: ${header.version}`,
            `kdf: scrypt N=${N} r=${r} p=${p} (${header.profile ?? 'custom'})`,
            'cipher: AES-256-GCM',
            `size: ${header.size} bytes`
        ].join('\n') + '\n')
    }


    private async list(file: string): Promise<void> {
        const box = await this.load(file)
        for (const name of box.keys()) {
            process.stdout.write(`${name}\n`)
        }
    }


    private async get(file: string, name: string): Promise<void> {
        const value = (await this.load(file)).get(name)
        process.stdout.write(process.stdout.isTTY ? `${value}\n` : value)
    }


    // The password is checked before the value is asked for, so a typo does not
    // waste a long paste.
    private async set(file: string, name: string): Promise<void> {
        const box = await this.load(file)
        const existed = box.has(name)
        box.set(name, await this.readValue(name))
        await box.save(await this.passwords.current())
        note(`${existed ? 'Updated' : 'Added'} ${name}.`)
    }


    private async delete(file: string, name: string): Promise<void> {
        const box = await this.load(file)
        if (!box.delete(name)) {
            throw new CliError(`No secret named ${name}.`)
        }
        await box.save(await this.passwords.current())
        note(`Deleted ${name}.`)
    }


    private async passwd(file: string): Promise<void> {
        const box = await this.load(file)
        const profile = this.profile()
        await box.save(await this.passwords.forChange(), { profile })
        note(profile === undefined ? 'Password changed.' : `Password changed, profile ${profile}.`)
    }


    private async load(file: string): Promise<SafeboxFile> {
        if (!await exists(file)) {
            throw new CliError(`${file} does not exist; create it with: safebox ${file} create`)
        }
        return new SafeboxFile(file).load(await this.passwords.current())
    }


    // Value for set: --from-file as is, piped stdin without one trailing newline, or a prompt.
    private async readValue(name: string): Promise<string> {
        const file = this.values['from-file']
        if (typeof file === 'string') {
            return readFile(file, 'utf8')
        }
        if (!process.stdin.isTTY) {
            return (await readStdin()).replace(/\r?\n$/, '')
        }
        if (!canPrompt()) {
            throw new CliError('No value: pipe it in, use --from-file, or run in a terminal.')
        }
        const value = await promptHidden(`Value of ${name} (hidden): `)
        if (value === '') {
            throw new CliError('The value cannot be empty; use --from-file for an empty value.')
        }
        return value
    }


    // The --profile value; the library checks that it exists.
    private profile(): SafeboxProfile | undefined {
        return this.values.profile as SafeboxProfile | undefined
    }
}


function parse(argv: string[]) {
    try {
        return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
    }
    catch (error) {
        throw new CliError(`${(error as Error).message} Run safebox --help.`, ExitCode.Usage)
    }
}


async function exists(file: string): Promise<boolean> {
    return stat(file).then(() => true, () => false)
}


function note(message: string): void {
    process.stderr.write(`${message}\n`)
}
