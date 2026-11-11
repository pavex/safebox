import { readFile } from 'node:fs/promises'
import { CliError } from './CliError'
import { canPrompt, promptHidden } from './Prompt'


// Passwords never come as command line arguments. Each one is looked up in a
// file option, then an environment variable, then asked for at a hidden prompt.
// A new password typed at the prompt is asked twice. The current password is
// remembered for the rest of the command, so load and save ask only once.

const CURRENT_VARIABLE = 'SAFEBOX_PASSWORD'
const NEW_VARIABLE = 'SAFEBOX_NEW_PASSWORD'
const SHORT_PASSWORD = 12


/** Where the CLI gets passwords from, for one command. */
export class Passwords {

    private passwordFile: string | undefined
    private newPasswordFile: string | undefined
    private remembered: string | undefined


    /** Takes the values of --password-file and --new-password-file. */
    constructor(passwordFile?: string, newPasswordFile?: string) {
        this.passwordFile = passwordFile
        this.newPasswordFile = newPasswordFile
    }


    /** The password of an existing safebox: --password-file, SAFEBOX_PASSWORD or a prompt. */
    async current(): Promise<string> {
        this.remembered ??= await fromFileOrEnv(this.passwordFile, CURRENT_VARIABLE) ?? await prompt('Password: ', CURRENT_VARIABLE)
        return this.remembered
    }


    /** The password of a new safebox: same sources as current(), a prompt asks twice. */
    forCreate(): Promise<string> {
        return choose(this.passwordFile, CURRENT_VARIABLE, 'Password')
    }


    /** The new password for passwd: --new-password-file, SAFEBOX_NEW_PASSWORD or a prompt asking twice. */
    forChange(): Promise<string> {
        return choose(this.newPasswordFile, NEW_VARIABLE, 'New password')
    }
}


async function choose(file: string | undefined, variable: string, label: string): Promise<string> {
    let password = await fromFileOrEnv(file, variable)
    if (password === undefined) {
        password = await prompt(`${label}: `, variable)
        if (await promptHidden(`Repeat ${label.toLowerCase()}: `) !== password) {
            throw new CliError('The passwords do not match.')
        }
    }
    if (Array.from(password).length < SHORT_PASSWORD) {
        process.stderr.write(`Warning: the password is shorter than ${SHORT_PASSWORD} characters.\n`)
    }
    return password
}


// The first line of the file, or the variable when it is set and not empty.
async function fromFileOrEnv(file: string | undefined, variable: string): Promise<string | undefined> {
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


async function prompt(question: string, variable: string): Promise<string> {
    if (!canPrompt()) {
        const option = variable === NEW_VARIABLE ? '--new-password-file' : '--password-file'
        throw new CliError(`No password: run in a terminal, or use ${option} or ${variable}.`)
    }
    const password = await promptHidden(question)
    if (password === '') {
        throw new CliError('The password cannot be empty.')
    }
    return password
}
