/** Why a Safebox operation failed. */
export enum SafeboxErrorCode {
    /** The safebox file does not exist. */
    NotFound = 'not_found',
    /** The data is not a safebox, or uses a version or parameters this code does not accept. */
    InvalidFormat = 'invalid_format',
    /** Wrong password, or the file was changed or damaged. The two cannot be told apart. */
    DecryptFailed = 'decrypt_failed',
    /** No secret of the given name. */
    MissingSecret = 'missing_secret',
    /** Invalid password, secret name, value or option, or a size limit was exceeded. */
    InvalidInput = 'invalid_input',
    /** Used before load() or create(), or create() on a loaded safebox. */
    InvalidState = 'invalid_state'
}
