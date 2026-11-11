import { CliError } from './CliError'


// Hidden input reads the terminal in raw mode and interprets the keys itself.
// A chunk can hold many characters at once (a paste, or Enter typed together
// with the last characters), so applyKeys() walks the whole chunk.

const ENTER = new Set(['\r', '\n'])
const CTRL_C = '\u0003'
const CTRL_D = '\u0004'
const CTRL_U = '\u0015'
const BACKSPACE = new Set(['\u007f', '\b'])
const ESCAPE = '\u001b'


/** Whether hidden input is possible: both stdin and stderr are a terminal. */
export function canPrompt(): boolean {
    return Boolean(process.stdin.isTTY && process.stderr.isTTY)
}


/** Asks on stderr and reads a line without echoing it. Ctrl+C cancels with exit code 130. */
export function promptHidden(question: string): Promise<string> {
    if (!canPrompt()) {
        return Promise.reject(new CliError('Hidden input needs an interactive terminal.'))
    }
    const input = process.stdin
    const output = process.stderr
    return new Promise((resolve, reject) => {
        let value = ''
        const finish = () => {
            input.off('data', onData)
            input.setRawMode(false)
            input.pause()
            output.write('\n')
        }
        const onData = (chunk: Buffer | string) => {
            const result = applyKeys(value, chunk.toString())
            value = result.value
            if (result.cancelled) {
                finish()
                reject(new CliError('Cancelled.', 130))
            }
            else if (result.done) {
                finish()
                resolve(value)
            }
        }
        output.write(question)
        input.setRawMode(true)
        input.setEncoding('utf8')
        input.on('data', onData)
        input.resume()
    })
}


/** Reads all of stdin as UTF-8. */
export async function readStdin(): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
}


/**
 * Applies a chunk of raw terminal input to the value typed so far. Enter or
 * Ctrl+D finishes, Ctrl+C cancels, Backspace deletes a character, Ctrl+U
 * clears, escape sequences (arrows, bracketed paste markers) are ignored.
 */
export function applyKeys(value: string, chunk: string): { value: string, done: boolean, cancelled: boolean } {
    const chars = Array.from(chunk)
    let result = value
    for (let index = 0; index < chars.length; index++) {
        const char = chars[index]
        if (ENTER.has(char) || char === CTRL_D) {
            return { value: result, done: true, cancelled: false }
        }
        if (char === CTRL_C) {
            return { value: '', done: false, cancelled: true }
        }
        if (BACKSPACE.has(char)) {
            result = Array.from(result).slice(0, -1).join('')
        }
        else if (char === CTRL_U) {
            result = ''
        }
        else if (char === ESCAPE) {
            index = skipEscapeSequence(chars, index)
        }
        else if (char >= ' ') {
            result += char
        }
    }
    return { value: result, done: false, cancelled: false }
}


// Returns the index of the last character of the escape sequence starting at
// `start`: ESC [ params final (CSI, e.g. arrows, ESC[200~), ESC O x, or ESC x.
function skipEscapeSequence(chars: string[], start: number): number {
    const next = chars[start + 1]
    if (next === '[') {
        let index = start + 2
        while (index < chars.length && !(chars[index] >= '@' && chars[index] <= '~')) {
            index++
        }
        return Math.min(index, chars.length - 1)
    }
    if (next === 'O') {
        return Math.min(start + 2, chars.length - 1)
    }
    return next === undefined ? start : start + 1
}
