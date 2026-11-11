# Safebox

One encrypted file with named secrets for a Node.js app, plus a CLI to manage it.

You keep `app.safebox` next to the app (in the repository, in the deploy
package). The app opens it with a password it gets from somewhere else, and
has every API key, database password and private key it needs. Without the
password the file is useless.

- AES-256-GCM, key from scrypt, the whole header authenticated
- TypeScript source with only Node.js built-in modules, no runtime dependencies
- CLI as one bundled file, `dist/safebox.js`
- Status: **beta** (`0.1.0-beta.1`), the file format may still change before 1.0

Requires Node.js 22 or newer.

## CLI

```bash
npm install
npm run build
node dist/safebox.js --help
```

`dist/safebox.js` is self-contained: copy it anywhere and run it with `node`.

```bash
safebox create app.safebox                 # asks for a password twice
safebox set app.safebox IMAP_PASSWORD      # asks for the password, then the value (hidden)
safebox set app.safebox TLS_KEY --from-file key.pem
echo "sk-123" | safebox set app.safebox API_KEY
safebox list app.safebox
safebox get app.safebox API_KEY            # prints the value to stdout
safebox delete app.safebox API_KEY
safebox passwd app.safebox                 # new password, optionally --profile high
safebox info app.safebox                   # header only, no password
```

The password is never a command line argument. The CLI takes it from, in this
order:

1. `--password-file <path>` (the first line),
2. the `SAFEBOX_PASSWORD` environment variable,
3. a hidden prompt when running in a terminal (pasting works).

`passwd` takes the new password from `--new-password-file`,
`SAFEBOX_NEW_PASSWORD` or a prompt. Values, names and info go to stdout,
messages to stderr. Exit codes: 0 success, 1 error, 2 wrong usage, 130 cancelled.

Git Bash on Windows (mintty) is not a real terminal for Node.js, so the hidden
prompt does not work there: use PowerShell, cmd or Windows Terminal, or
`--password-file`.

## Library

Copy `src/` into your app (any folder name), or depend on this package. The
code is TypeScript with extensionless imports and enums, meant for a bundler
or a TypeScript runtime (esbuild, tsx, Vite); Node's built-in type stripping
cannot run it directly.

```ts
import { Safebox } from './safebox'

const box = await Safebox.open('app.safebox', process.env.SAFEBOX_PASSWORD ?? '')
const imapPassword = box.get('IMAP_PASSWORD')
```

The library never reads `process.env` or any configuration by itself: where
the password comes from is the app's decision.

| Member | What it does |
|---|---|
| `Safebox.create({ profile? })` | Empty safebox in memory, profile `recommended` by default |
| `Safebox.open(path, password)` | Reads and decrypts a file |
| `Safebox.decrypt(bytes, password)` | Decrypts bytes (embedded, fetched) |
| `Safebox.info(path)` | Header: format, scrypt parameters, profile, size; no password |
| `get(name)` / `has(name)` / `keys()` / `size` | Read secrets; `get` throws `MissingSecret` |
| `set(name, value)` / `delete(name)` | Change secrets in memory |
| `toObject()` | All secrets as a plain object, e.g. for a child process `env` |
| `replace(template)` | Fills `{{NAME}}` and `${NAME}`; no escaping |
| `save(path, password, { profile? })` | Encrypts and atomically replaces the file |
| `encrypt(password, { profile? })` | Encrypts to bytes without writing |
| `changed` / `profile` | Unsaved changes; current key derivation profile |

Errors are `SafeboxError` with a `code`:

| Code | When |
|---|---|
| `NotFound` | The file does not exist |
| `InvalidFormat` | Not a safebox, unsupported version or parameters, malformed content |
| `DecryptFailed` | Wrong password, or the file was changed or damaged |
| `MissingSecret` | `get` or `replace` of an unknown name |
| `InvalidInput` | Bad name, value, password or profile, or a limit exceeded |

Secret names are letters, digits and `_`, not starting with a digit, at most
128 characters. Values are strings up to 1 MiB, at most 10 000 secrets, the
file at most 16 MiB.

### Profiles

| Profile | scrypt N | Memory | Time per open or save (desktop PC) |
|---|---:|---:|---:|
| `standard` | 2^16 | 64 MiB | ~0.4 s |
| `recommended` | 2^17 | 128 MiB | ~0.7 s |
| `high` | 2^18 | 256 MiB | ~1.4 s |

Every open and save pays this once. Measure on the target server: a small
container may prefer `standard`.

## Deployment

1. Create and edit the safebox on a trusted machine.
2. Ship the file with the app; it may be committed to the repository.
3. Give the app the password separately: a secret store of the platform, an
   environment variable set outside the repository, a file readable only by
   the app's user, or typed in at start.
4. The app only needs read access to the file.

Saving writes a temporary file next to the target and renames it over the
target, so the directory must be writable, and the new file gets mode `0600`
on POSIX (the old owner and mode are not kept).

## What it protects and what not

Safebox protects secrets **at rest**: in the repository, in backups, in a
deploy package, on a disk without the password.

It does not protect against a weak password, a compromised machine or app
(secrets are in memory once opened, JavaScript cannot wipe strings), leaks
through logs or stdout, replacing the file with an older valid copy, or two
writers at once (the last save wins). Details in
[SPECIFICATION.md](SPECIFICATION.md).

## Development

```bash
npm test          # typecheck, build, unit tests (test/unit) and CLI tests (test/cli.test.mjs)
npm run style     # code style, --check only reports
```

## License

MIT, see [LICENSE](LICENSE).
