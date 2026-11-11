import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyKeys } from '../../cli/Cli/Prompt'


test('a pasted password arrives in one chunk', () => {
    assert.deepEqual(applyKeys('', 'pasted-Secret#1'), { value: 'pasted-Secret#1', done: false, cancelled: false })
})


test('Enter in the same chunk finishes and ignores the rest', () => {
    assert.deepEqual(applyKeys('ab', 'cd\rgarbage'), { value: 'abcd', done: true, cancelled: false })
    assert.deepEqual(applyKeys('ab', '\n'), { value: 'ab', done: true, cancelled: false })
    assert.equal(applyKeys('ab', '\u0004').done, true)
})


test('Ctrl+C cancels and drops the value', () => {
    assert.deepEqual(applyKeys('secret', 'x\u0003'), { value: '', done: false, cancelled: true })
})


test('Backspace removes one character, including emoji, and Ctrl+U clears', () => {
    assert.equal(applyKeys('abc', '\u007f').value, 'ab')
    assert.equal(applyKeys('abc', '\b\b').value, 'a')
    assert.equal(applyKeys('', '\u007f').value, '')
    assert.equal(applyKeys('a\u{1F511}', '\u007f').value, 'a')
    assert.equal(applyKeys('abc', '\u0015x').value, 'x')
})


test('escape sequences and control characters are ignored', () => {
    assert.equal(applyKeys('', 'a\u001b[Db\u001b[1;5Cc').value, 'abc')
    assert.equal(applyKeys('', '\u001b[200~pasted\u001b[201~').value, 'pasted')
    assert.equal(applyKeys('', '\u001bOAx').value, 'x')
    assert.equal(applyKeys('', 'a\tb\u0000c').value, 'abc')
    assert.equal(applyKeys('', '\u001b').value, '')
})


test('accented and non-Latin characters are kept', () => {
    assert.equal(applyKeys('', 'žluťoučký пароль').value, 'žluťoučký пароль')
})
