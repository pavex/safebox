import { ExitCode } from '../types/ExitCode'


/** Error the CLI reports as a plain message, with the process exit code. */
export class CliError extends Error {

    readonly exitCode: ExitCode


    constructor(message: string, exitCode = ExitCode.Error) {
        super(message)
        this.name = 'CliError'
        this.exitCode = exitCode
    }
}
