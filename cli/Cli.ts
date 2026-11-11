import { readFile, stat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { SafeboxError, SafeboxFile } from '../src'
import type { SafeboxProfile } from '../src'
import { CliError } from './CliError'
import { canPrompt, promptHidden, readStdin } from './Prompt'


// Command line front end of the library. Passwords never come as arguments:
// --password-file, the SAFEBOX_PASSWORD variable, or a hidden prompt, in that
// order. Data (values, names, info) goes to stdout, messages to stderr.

const SHORT_PASSWORD = 12
const USAGE_EXIT = 2

const USAGE = `safebox - one encrypted file with named secrets

Usage:
  safebox create <file> [--profile standard|recommended|high] [--force]
  safebox info <file>
  safebox list <file>
  safebox get <file> <NAME>
  safebox set <file> <NAME> [--from-file <path>]
  safebox delete <file> <NAME>
  safebox passwd <file> [--profile standard|recommended|high]

Password (in this order):
  --password-file <path>   first line of the file
  SAFEBOX_PASSWORD         environment variable
  hidden prompt            when running in a terminal
  passwd takes the new one from --new-password-file, SAFEBOX_NEW_PASSWORD or a prompt.

Value for set (in this order):
  --from-file <path>       whole file as is, e.g. a PEM key
  stdin                    when piped, one trailing newline removed
  hidden prompt            when running in a terminal

Secret names: letters, digits and _, not starting with a digit.
get prints the value to stdout: mind terminal history, logs and redirection.
`

const OPTIONS = {
    'profile': { type: 'string' },
    'force': { type: 'boolean' },
    'from-file': { type: 'string' },
    'password-file': { type: 'string' },
    'new-password-file': { type: 'string' },
    'help': { type: 'boolean', short: 'h' },
    'version': { type: 'boolean', short: 'v' }
} as const


type Values = {
    profile?: string
    force?: boolean
    'from-file'?: string
    'password-file'?: string
    'new-password-file'?: string
}


interface Command {
    // Names of the positional arguments after the command.
    args: string[]
    options: (keyof Values)[]
    run(args: string[], values: Values): Promise<void>
}


const COMMANDS: Record<string, Command> = {
    create: { args: ['file'], options: ['profile', 'force', 'password-file'], run: create },
    info: { args: ['file'], options: [], run: info },
    list: { args: ['file'], options: ['password-file'], run: list },
    get: { args: ['file', 'NAME'], options: ['password-file'], run: get },
    set: { args: ['file', 'NAME'], options: ['from-file', 'password-file'], run: set },
    delete: { args: ['file', 'NAME'], options: ['password-file'], run: remove },
    passwd: { args: ['file'], options: ['profile', 'password-file', 'new-password-file'], run: passwd }
}


/** Runs the CLI with the given arguments (without node and script) and returns the exit code. */
export async function runCli(argv: string[], version: string): Promise<number> {
    try {
        const { values, positionals } = parse(argv)
        if (values.version) {
            process.stdout.write(`${version}\n`)
            return 0
        }
        const [name, ...args] = positionals
        if (values.help || name === undefined || name === 'help') {
            process.stdout.write(USAGE)
            return name === undefined && !values.help ? USAGE_EXIT : 0
        }
        if (!Object.hasOwn(COMMANDS, name)) {
            throw new CliError(`Unknown command "${name}". Run safebox --help.`, USAGE_EXIT)
        }
        const command = COMMANDS[name]
        if (args.length !== command.args.length) {
            const expected = command.args.map(arg => `<${arg}>`).join(' ')
            throw new CliError(`Usage: safebox ${name} ${expected}`, USAGE_EXIT)
        }
        for (const option of Object.keys(values)) {
            if (option !== 'help' && option !== 'version' && !command.options.includes(option as keyof Values)) {
                throw new CliError(`${name} does not take --${option}.`, USAGE_EXIT)
            }
        }
        await command.run(args, values)
        return 0
    }
    catch (error) {
        const exitCode = error instanceof CliError ? error.exitCode : 1
        const message = error instanceof CliError || error instanceof SafeboxError ? error.message : String((error as Error)?.message ?? error)
        process.stderr.write(`safebox: ${message}\n`)
        return exitCode
    }
}


function parse(argv: string[]) {
    try {
        return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
    }
    catch (error) {
        throw new CliError(`${(error as Error).message} Run safebox --help.`, USAGE_EXIT)
    }
}


async function create([file]: string[], values: Values): Promise<void> {
    if (!values.force && await exists(file)) {
        throw new CliError(`${file} already exists; use --force to replace it.`)
    }
    const box = new SafeboxFile(file).create({ profile: values.profile as SafeboxProfile | undefined })
    const password = await newPassword(values['password-file'], 'SAFEBOX_PASSWORD', 'Password')
    await box.save(password)
    note(`Created ${file}.`)
}


async function info([file]: string[]): Promise<void> {
    const header = await new SafeboxFile(file).info()
    const { N, r, p } = header.params
    const profile = header.profile === undefined ? 'custom' : header.profile
    process.stdout.write([
        `file: ${file}`,
        `format: ${header.version}`,
        `kdf: scrypt N=${N} r=${r} p=${p} (${profile})`,
        `cipher: AES-256-GCM`,
        `size: ${header.size} bytes`
    ].join('\n') + '\n')
}


async function list([file]: string[], values: Values): Promise<void> {
    const box = await openBox(file, values)
    for (const name of box.keys()) {
        process.stdout.write(`${name}\n`)
    }
}


async function get([file, name]: string[], values: Values): Promise<void> {
    const box = await openBox(file, values)
    const value = box.get(name)
    process.stdout.write(process.stdout.isTTY ? `${value}\n` : value)
}


// The password is checked before the value is asked for, so a typo does not
// waste a long paste.
async function set([file, name]: string[], values: Values): Promise<void> {
    const box = await openBox(file, values)
    const existed = box.has(name)
    box.set(name, await readValue(name, values['from-file']))
    await box.save(await currentPassword(values, true))
    note(`${existed ? 'Updated' : 'Added'} ${name}.`)
}


async function remove([file, name]: string[], values: Values): Promise<void> {
    const box = await openBox(file, values)
    if (!box.delete(name)) {
        throw new CliError(`No secret named ${name}.`)
    }
    await box.save(await currentPassword(values, true))
    note(`Deleted ${name}.`)
}


async function passwd([file]: string[], values: Values): Promise<void> {
    const box = await openBox(file, values)
    const password = await newPassword(values['new-password-file'], 'SAFEBOX_NEW_PASSWORD', 'New password')
    await box.save(password, { profile: values.profile as SafeboxProfile | undefined })
    note(values.profile === undefined ? 'Password changed.' : `Password changed, profile ${values.profile}.`)
}


// The password typed for opening is remembered for the save that follows in the
// same command, so the user types it once.
let rememberedPassword: string | undefined


async function openBox(file: string, values: Values): Promise<SafeboxFile> {
    if (!await exists(file)) {
        throw new CliError(`${file} does not exist; create it with: safebox create ${file}`)
    }
    return new SafeboxFile(file).load(await currentPassword(values, false))
}


async function currentPassword(values: Values, again: boolean): Promise<string> {
    if (again && rememberedPassword !== undefined) {
        return rememberedPassword
    }
    const password = await passwordFromFileOrEnv(values['password-file'], 'SAFEBOX_PASSWORD')
        ?? await promptPassword('Password: ', 'SAFEBOX_PASSWORD')
    rememberedPassword = password
    return password
}


async function newPassword(file: string | undefined, variable: string, label: string): Promise<string> {
    let password = await passwordFromFileOrEnv(file, variable)
    if (password === undefined) {
        password = await promptPassword(`${label}: `, variable)
        if (await promptHidden(`Repeat ${label.toLowerCase()}: `) !== password) {
            throw new CliError('The passwords do not match.')
        }
    }
    if (Array.from(password).length < SHORT_PASSWORD) {
        note(`Warning: the password is shorter than ${SHORT_PASSWORD} characters.`)
    }
    return password
}


async function passwordFromFileOrEnv(file: string | undefined, variable: string): Promise<string | undefined> {
    if (file !== undefined) {
        const password = (await readFile(file, 'utf8')).split(/\r?\n/, 1)[0]
        if (password === '') {
            throw new CliError(`The first line of ${file} is empty.`)
        }
        return password
    }
    const fromEnv = process.env[variable]
    return fromEnv === undefined || fromEnv === '' ? undefined : fromEnv
}


async function promptPassword(question: string, variable: string): Promise<string> {
    if (!canPrompt()) {
        throw new CliError(`No password: run in a terminal, or use --password-file or ${variable}.`)
    }
    const password = await promptHidden(question)
    if (password === '') {
        throw new CliError('The password cannot be empty.')
    }
    return password
}


async function readValue(name: string, file: string | undefined): Promise<string> {
    if (file !== undefined) {
        return readFile(file, 'utf8')
    }
    if (!process.stdin.isTTY) {
        return (await readStdin()).replace(/\r?\n$/, '')
    }
    const value = await promptHidden(`Value of ${name}: `)
    if (value === '') {
        throw new CliError('The value cannot be empty; use --from-file for an empty value.')
    }
    return value
}


async function exists(file: string): Promise<boolean> {
    return stat(file).then(() => true, () => false)
}


function note(message: string): void {
    process.stderr.write(`${message}\n`)
}
