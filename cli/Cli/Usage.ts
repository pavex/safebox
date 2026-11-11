/** Text of safebox --help. */
export const USAGE = `safebox - one encrypted file with named secrets

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
