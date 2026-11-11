/** Error the CLI reports as a plain message, with the process exit code. */
export class CliError extends Error {

    readonly exitCode: number


    constructor(message: string, exitCode = 1) {
        super(message)
        this.name = 'CliError'
        this.exitCode = exitCode
    }
}
