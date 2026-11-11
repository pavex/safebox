# Safebox specification

Version 1 of the file format, library `0.1.0-beta.1`.

## 1. Purpose

A safebox is one file holding named string secrets, encrypted with a key
derived from a password. It is made to travel with an application while the
password travels separately.

## 2. Layout of the code

```text
src/                      the library, copied into apps
  index.ts                public exports
  Safebox.ts              abstract base: secrets in memory, load, save
  SafeboxFile.ts          Safebox stored in a file (the default)
  SafeboxBuffer.ts        Safebox stored in memory as bytes
  Safebox/Envelope.ts     binary format, scrypt, AES-GCM
  Safebox/Payload.ts      JSON content, names, values, limits
  Safebox/SafeboxError.ts error with a code
  SafeboxFile/AtomicFile.ts  limited reading and atomic writing of files
  interfaces/, types/     KdfParams, SafeboxInfo, SafeboxOptions; enums
cli/                      the CLI, bundled to dist/safebox.js
test/                     unit tests (test/unit) and CLI tests
```

The library uses only Node.js built-in modules and never reads environment
variables or configuration.

## 3. Cryptography

- Cipher: AES-256-GCM, 12-byte IV, 16-byte authentication tag.
- Key: 32 bytes from scrypt with a 16-byte salt.
- Password: normalized to Unicode NFC, then UTF-8. The same text typed with
  composed or decomposed accents gives the same key.
- Salt and IV are random and new on every encryption, so saving the same
  content twice gives different files.
- Additional authenticated data: the whole header before the tag (bytes 0-45).
  Changing the version, parameters, salt or IV makes decryption fail.
- There is no separate password check. A wrong password and a damaged file
  both fail authentication and cannot be told apart (`DecryptFailed`).
- The derived key and the plaintext buffers are overwritten with zeros after
  use. Strings (the password, the values) cannot be wiped in JavaScript.

### Key derivation profiles

| Profile | N | r | p |
|---|---:|---:|---:|
| standard | 65536 | 8 | 1 |
| recommended (default) | 131072 | 8 | 1 |
| high | 262144 | 8 | 1 |

When reading, only these values are accepted: N a power of two from 2^14 to
2^18, r = 8, p = 1. They are checked before scrypt runs, so a crafted header
cannot make it allocate more than 256 MiB.

## 4. File format

Integers are big-endian.

| Offset | Size | Field |
|---:|---:|---|
| 0 | 4 | Magic `SBOX` (ASCII) |
| 4 | 1 | Format version, `1` |
| 5 | 1 | KDF, `1` = scrypt |
| 6 | 4 | scrypt N |
| 10 | 4 | scrypt r |
| 14 | 4 | scrypt p |
| 18 | 16 | Salt |
| 34 | 12 | IV |
| 46 | 16 | Authentication tag |
| 62 | rest | Ciphertext |

The plaintext is UTF-8 JSON:

```json
{ "format": 1, "secrets": { "API_KEY": "value" } }
```

Secrets are written sorted by name. Unknown top-level fields are ignored on
reading, so metadata can be added without a new version.

## 5. Limits and validation

- Secret name: `^[A-Za-z_][A-Za-z0-9_]*$`, at most 128 characters.
- Value: a string, at most 1 MiB in UTF-8. Empty strings are allowed.
- At most 10 000 secrets, the file at most 16 MiB.
- Reading refuses: a file that is not a regular file, a wrong magic, an
  unknown version or KDF, parameters outside the limits, content that is not
  the JSON above or breaks a limit.

## 6. Behavior

- `Safebox` is abstract. A subclass provides the storage through two protected
  methods: `read()` returns the encrypted bytes (or throws `NotFound`),
  `write(data)` replaces them. `SafeboxFile` and `SafeboxBuffer` are the
  included ones.
- An instance is usable after `create()` or `load()`; before that every
  operation throws `InvalidState`, and so does `create()` on a loaded instance.
- `load()` replaces the state only after reading, decryption and validation all
  succeed; on failure the previous state stays.
- The password is never stored in the instance. `save()` takes it again, so
  changing the password is a `save()` with the new one.
- `save()` keeps the current profile unless a new one is given. On success it
  clears `changed`; on failure `changed` stays.
- `replace()` substitutes `{{NAME}}` and `${NAME}` as plain text and fails
  with `MissingSecret` listing every unknown name. It does not escape values.
- Error messages contain names and paths, never values.

## 7. Files

Writing:

1. A temporary file `.<name>.<random>.tmp` is created in the target directory
   with mode `0600` (POSIX) and exclusive create.
2. It is written and flushed (`fsync`).
3. It is renamed over the target. On Windows the rename is retried a few times
   when another process holds the target for a moment.
4. The directory is flushed where the platform supports it.
5. On failure the temporary file is removed.

The directory must be writable. The replaced file does not keep its old owner
or mode. Atomic rename does not protect against every power loss.

## 8. CLI

- Commands: `create`, `info`, `list`, `get`, `set`, `delete`, `passwd`.
- Password sources in order: `--password-file` (first line), `SAFEBOX_PASSWORD`,
  hidden prompt on a terminal. Never a command line argument. `passwd` reads the
  new password from `--new-password-file`, `SAFEBOX_NEW_PASSWORD` or a prompt.
- New passwords typed at the prompt are asked twice. A password shorter than 12
  characters gets a warning.
- Value for `set`: `--from-file` (the whole file as is), piped stdin (one
  trailing newline removed), or a hidden prompt.
- The hidden prompt handles pasting, Backspace, Ctrl+U, Ctrl+C (exit 130) and
  ignores escape sequences.
- `create` refuses to replace an existing file without `--force`.
- `set` and `delete` check the password before asking for the value.
- stdout carries only data (`get`, `list`, `info`, `--help`, `--version`);
  messages go to stderr. `get` adds a newline only when stdout is a terminal.
- Exit codes: 0 success, 1 error, 2 wrong usage, 130 cancelled.

## 9. Not covered

- A weak password.
- A compromised machine, Node.js runtime or application; memory inspection
  while the safebox is open.
- Leaks through logs, stdout or shell history.
- Deleting or damaging the file; rolling it back to an older valid copy
  (authentication does not prove freshness).
- Concurrent writers: the last save wins.
