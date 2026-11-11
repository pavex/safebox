/** Text of safebox --help. */
export const USAGE = `safebox - one encrypted file with named secrets

Usage:
  safebox <file> create [--profile standard|recommended|high] [--force]
  safebox <file> set <NAME> [--from-file <path>]
  safebox <file> get <NAME>
  safebox <file> list
  safebox <file> delete <NAME>
  safebox <file> passwd [--profile standard|recommended|high]
  safebox <file> info

Examples:
  safebox app.safebox create
  safebox app.safebox set API_KEY
  safebox app.safebox get API_KEY

The safebox password:
  You are asked for it whenever it is needed. Where nobody can type (scripts,
  CI), give it with --password-file <path> (its first line is the password)
  or in the SAFEBOX_PASSWORD environment variable. passwd also asks for the
  new password; in scripts give it with --new-password-file <path> or
  SAFEBOX_NEW_PASSWORD.

The value for set:
  You are asked for it, hidden. Or take it from a file, as is (e.g. a PEM key):
    safebox app.safebox set TLS_KEY --from-file key.pem
  or pipe it in (one trailing newline is removed):
    echo secret | safebox app.safebox set API_KEY

Secret names: letters, digits and _, not starting with a digit.
get prints the value: mind terminal history, logs and redirection.
`
