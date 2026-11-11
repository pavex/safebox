# Safebox

One encrypted file with named secrets for a Node.js app, plus a CLI to manage it.

You keep `app.safebox` next to the app: in the repository, in the deploy
package. The app opens it with a password it gets from somewhere else and has
every API key, database password and private key it needs. Without the
password the file is useless.

- AES-256-GCM with a key from scrypt, the whole file authenticated
- TypeScript source with only Node.js built-in modules, no runtime dependencies
- CLI as one bundled file, `dist/safebox.js`
- Status: **beta** (`0.1.0-beta.1`), the file format may still change before 1.0

Requires Node.js 22 or newer.

## How it works

A safebox is a list of names and values, like `IMAP_PASSWORD = s3cret`,
encrypted as a whole into one file.

1. You create the file and put secrets in it with the CLI (or from code).
   Every change asks for the password.
2. The file can go anywhere the app goes. Without the password nobody can
   read the values or even the names; only the file size shows.
3. The app gets the password separately (an environment variable, a secret
   store, a prompt) and loads the safebox when it starts. From then on the
   secrets are in memory.

The password is never stored anywhere by Safebox. **If you lose it, the
secrets are gone**: there is no recovery and no back door.

## Getting the CLI

```bash
build.cmd        # Windows; build.sh on Linux and macOS
```

The build script installs the dev dependencies, builds, runs the tests and
removes `node_modules` and `package-lock.json` again, so nothing stays
installed. The result is `dist/safebox.js`, one self-contained file: copy it
anywhere and run it with `node`.

The examples below write `safebox` for `node path/to/safebox.js`. On Windows a
`safebox.cmd` next to it with `@node "%~dp0safebox.js" %*` makes the short
form work.

## Working with a safebox file

### Create one

```bash
safebox create app.safebox
```

Asks for a new password twice. A password shorter than 12 characters gets a
warning; use a long passphrase, it is the only protection. `create` refuses to
overwrite an existing file unless you add `--force`.

`--profile standard|recommended|high` picks how hard the password is to
brute-force (see [Profiles](#profiles)); the default `recommended` is fine for
most uses.

### Add or change a secret

```bash
safebox set app.safebox IMAP_PASSWORD                  # asks for the password, then the value (hidden)
safebox set app.safebox TLS_KEY --from-file key.pem    # the whole file as is
echo "sk-123" | safebox set app.safebox API_KEY        # from a pipe, one trailing newline removed
```

`set` adds a new secret or replaces an existing one and says which. The
password is checked before you are asked for the value, so a typo does not
waste a long paste.

Names are letters, digits and `_`, not starting with a digit (`API_KEY`,
`db_password_2`). Values are any text up to 1 MiB, multi-line included.

### Look inside

```bash
safebox list app.safebox             # names, one per line
safebox get app.safebox API_KEY      # the value, to stdout
safebox info app.safebox             # format and key derivation; no password needed
```

`get` prints the secret in plain text: mind your terminal history, logs and
redirection. In a script it can feed a variable directly:

```bash
export API_KEY="$(safebox get app.safebox API_KEY)"
```

### Delete a secret

```bash
safebox delete app.safebox API_KEY
```

### Change the password

```bash
safebox passwd app.safebox
safebox passwd app.safebox --profile high    # and a stronger key derivation
```

Asks for the current password, then the new one twice. The file is
re-encrypted; the secrets stay. Then update the password wherever the app
gets it.

### Where the CLI takes the password from

The password is never a command line argument (it would end up in shell
history and process lists). The CLI uses the first of:

1. `--password-file <path>`: the first line of that file,
2. the `SAFEBOX_PASSWORD` environment variable,
3. a hidden prompt when running in a terminal (pasting works).

`passwd` takes the new password from `--new-password-file`,
`SAFEBOX_NEW_PASSWORD` or a prompt.

For scripts and CI use `--password-file` or `SAFEBOX_PASSWORD`. Git Bash on
Windows (mintty) is not a real terminal for Node.js, so the hidden prompt does
not work there: use PowerShell, cmd or Windows Terminal, or the two options
above.

### Output and exit codes

Data (`get`, `list`, `info`, `--help`, `--version`) goes to stdout, messages to
stderr. `get` adds a newline only when printing to a terminal. Exit codes: 0
success, 1 error, 2 wrong usage, 130 cancelled with Ctrl+C.

### Taking care of the file

- **Git**: the file is safe to commit. It is binary and two versions cannot be
  merged, so mark it in the app's `.gitattributes` with `*.safebox binary` and
  avoid editing it on two branches at once.
- **One writer at a time**: when two people or processes save the same file,
  the last save wins and the other changes are lost.
- **Saving is atomic**: Safebox writes a temporary file next to the target and
  renames it over the target. A crash or a full disk during a save leaves the
  previous file intact, and a reader sees either the old or the new file. The
  directory must be writable, and the saved file gets mode `0600` on POSIX (the
  old owner and mode are not kept). A power loss right after a save may bring
  back the previous version.
- **Backups**: copy the file like any other; a backup is as safe as the
  original. An old copy opens with the password it had then.
- **Rolling back**: an older valid copy of the file still opens, and Safebox
  cannot tell. If that matters (a revoked key coming back), protect the file
  location, not just the content.

## Using it in an app

Copy `src/` into your app (any folder name), or depend on this package. The
code is TypeScript with extensionless imports and enums, meant for a bundler
or a TypeScript runtime (esbuild, tsx, Vite); Node's built-in type stripping
cannot run it directly.

```ts
import { SafeboxFile } from './safebox'

const box = await new SafeboxFile('app.safebox').load(process.env.SAFEBOX_PASSWORD ?? '')
const imapPassword = box.get('IMAP_PASSWORD')
```

Creating or changing one from code:

```ts
import { SafeboxFile, SafeboxProfile } from './safebox'

const box = new SafeboxFile('app.safebox').create({ profile: SafeboxProfile.Recommended })
box.set('IMAP_PASSWORD', 'secret')
await box.save(password)
```

The library never reads `process.env` or any configuration by itself: where
the password comes from is the app's decision. It keeps no password either:
`load()` and `save()` each take it, so saving with a different password
changes the password.

### Classes

- **`SafeboxFile`**: stored in a file, `new SafeboxFile(path)`. The usual choice.
- **`SafeboxBuffer`**: stored in memory as bytes, `new SafeboxBuffer(bytes?)`;
  `save()` leaves the result in `data`. For a safebox embedded in a bundle or
  kept in a database.
- **`Safebox`**: the abstract base of both. Holds the secrets in memory,
  encrypts and decrypts. A subclass decides where the encrypted bytes live by
  implementing two protected methods, `read(): Promise<Uint8Array>` (throws
  `SafeboxError` `NotFound` when there is nothing) and
  `write(data: Buffer): Promise<void>`.

A storage of your own, e.g. a database row:

```ts
class SafeboxRow extends Safebox {

    protected async read() {
        return db.get('SELECT data FROM secrets WHERE id = 1').data
    }


    protected async write(data: Buffer) {
        db.run('UPDATE secrets SET data = ? WHERE id = 1', data)
    }
}
```

### Members

| Member | What it does |
|---|---|
| `create({ profile? })` | Starts an empty safebox in memory, profile `recommended` by default |
| `load(password)` | Reads and decrypts; on failure the previous state stays |
| `save(password, { profile? })` | Encrypts and stores; keeps the profile unless a new one is given |
| `info()` | Header: format, scrypt parameters, profile, size; no password |
| `get(name)` / `has(name)` / `keys()` / `size` | Read secrets; `keys()` is sorted |
| `set(name, value)` / `delete(name)` | Change secrets in memory; `delete` returns whether it existed |
| `toObject()` | All secrets as a plain object, e.g. for a child process `env` |
| `replace(template)` | Fills `{{NAME}}` and `${NAME}` placeholders |
| `loaded` / `changed` / `profile` | After `create` or `load`; unsaved changes; key derivation profile |

`create`, `load`, `save` and `set` return the safebox, so calls chain. Before
`create()` or `load()` every other member throws `InvalidState`, and so does
`create()` on a loaded safebox. A failed `save()` leaves `changed` set.

`replace()` is plain text substitution: escaping the values for JSON, a shell,
SQL and so on is up to you. It fails with `MissingSecret` listing every
unknown name.

### Errors

Every failure is a `SafeboxError` with a `code`. Messages contain names and
paths, never values.

| Code | When |
|---|---|
| `NotFound` | The file does not exist |
| `InvalidFormat` | Not a safebox, unsupported version or parameters, malformed content |
| `DecryptFailed` | Wrong password, or the file was changed or damaged; the two cannot be told apart |
| `MissingSecret` | `get` or `replace` of an unknown name |
| `InvalidInput` | Bad name, value, password or profile, or a limit exceeded |
| `InvalidState` | Used before `load` or `create`, or `create` on a loaded safebox |

## Deployment

1. Create and edit the safebox on a trusted machine.
2. Ship the file with the app; it may be committed to the repository.
3. Give the app the password separately: a secret store of the platform, an
   environment variable set outside the repository, a file readable only by
   the app's user, or typed in at start.
4. The app only needs read access to the file.

### Profiles

The profile sets how expensive it is to turn the password into a key: more
time and memory on every load and save, and as much more for anyone guessing
passwords.

| Profile | scrypt N | Memory | Time per load or save (desktop PC) |
|---|---:|---:|---:|
| `standard` | 2^16 | 64 MiB | ~0.4 s |
| `recommended` | 2^17 | 128 MiB | ~0.7 s |
| `high` | 2^18 | 256 MiB | ~1.4 s |

Measure on the target server: a small container may prefer `standard`. The
profile is stored in the file, so loading needs no setting.

## What it protects and what not

Safebox protects secrets **at rest**: in the repository, in backups, in a
deploy package, on a disk, as long as the password is not with them.

It does not protect against:

- a weak password,
- a compromised machine, Node.js runtime or app: once loaded, the secrets are
  in memory, and JavaScript cannot wipe strings,
- leaks through logs, stdout or shell history,
- deleting or damaging the file, or replacing it with an older valid copy,
- two writers at once: the last save wins.

## Reference

### Limits

- Secret name: `^[A-Za-z_][A-Za-z0-9_]*$`, at most 128 characters.
- Value: a string, at most 1 MiB in UTF-8; empty strings are allowed.
- At most 10 000 secrets, the file at most 16 MiB.

### Cryptography

- AES-256-GCM, 12-byte IV, 16-byte authentication tag.
- 32-byte key from scrypt with a 16-byte salt, r = 8, p = 1, N by profile.
- The password is normalized to Unicode NFC and encoded as UTF-8, so the same
  text typed with composed or decomposed accents gives the same key.
- Salt and IV are random and new on every save, so saving the same content
  twice gives different files.
- The whole header before the tag is authenticated together with the content:
  changing the version, parameters, salt or IV makes decryption fail.
- There is no separate password check: a wrong password and a damaged file
  fail the same way.
- Reading accepts only N a power of two from 2^14 to 2^18, r = 8, p = 1, checked
  before scrypt runs, so a crafted file cannot make it allocate more than
  256 MiB.
- The derived key and the decrypted buffers are overwritten with zeros after
  use.

### File format

Version 1, integers big-endian.

| Offset | Size | Field |
|---:|---:|---|
| 0 | 4 | Magic `SBOX` (ASCII) |
| 4 | 1 | Format version, `1` |
| 5 | 1 | Key derivation, `1` = scrypt |
| 6 | 4 | scrypt N |
| 10 | 4 | scrypt r |
| 14 | 4 | scrypt p |
| 18 | 16 | Salt |
| 34 | 12 | IV |
| 46 | 16 | Authentication tag |
| 62 | rest | Ciphertext |

Bytes 0-45 are the additional authenticated data. The decrypted content is
UTF-8 JSON, secrets sorted by name:

```json
{ "format": 1, "secrets": { "API_KEY": "value" } }
```

Unknown top-level fields are ignored on reading, so metadata can be added
later without a new version. Anything else that does not match is refused.

## Development

```text
src/                         the library, copied into apps
  index.ts                   public exports
  Safebox.ts                 abstract base: secrets in memory, load, save
  SafeboxFile.ts             Safebox stored in a file
  SafeboxBuffer.ts           Safebox stored in memory as bytes
  Safebox/Envelope.ts        file format, scrypt, AES-GCM
  Safebox/Payload.ts         JSON content, names, values, limits
  Safebox/SafeboxError.ts    error with a code
  SafeboxFile/AtomicFile.ts  limited reading and atomic writing
  interfaces/, types/        KdfParams, SafeboxInfo, SafeboxOptions; enums
cli/                         the CLI, an app on top of the library, bundled to dist/safebox.js
  index.ts                   entry point: new Cli(version).run(argv)
  Cli.ts                     arguments, commands, error reporting
  Cli/Passwords.ts           where passwords come from (file, variable, prompt)
  Cli/Prompt.ts              hidden input and reading stdin
  Cli/CliError.ts            error with an exit code
  Cli/Usage.ts               text of --help
  types/ExitCode.ts          exit codes
test/                        unit tests (test/unit) and CLI tests (test/cli.test.mjs)
```

`src/` stands alone: it imports only Node.js built-ins and its own files, so
copying it gives exactly the library. `cli/` uses the library only through
`src/index.ts`, like any other app. `test/unit/structure.test.ts` checks both.

While working on the code, keep the dev dependencies installed (`npm install`):

```bash
npm test          # typecheck, build, unit tests and CLI tests
npm run style     # code style, --check only reports
```

`build.cmd` / `build.sh` removes them again at the end.

## License

MIT, see [LICENSE](LICENSE).
