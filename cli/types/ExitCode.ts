/** Process exit codes of the CLI. */
export enum ExitCode {
    Success = 0,
    /** The command failed: wrong password, missing file, invalid name and so on. */
    Error = 1,
    /** Wrong command, arguments or options. */
    Usage = 2,
    /** Cancelled with Ctrl+C at a prompt. */
    Cancelled = 130
}
