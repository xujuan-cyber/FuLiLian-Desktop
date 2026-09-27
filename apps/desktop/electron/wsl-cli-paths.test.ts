// Unit tests for the Windows → WSL/POSIX cwd translation (step09 v2 · T4/E5).
// Pure function, no Electron, no wsl.exe.
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { windowsToWslPosix } from './wsl-cli-paths'

test('windowsToWslPosix maps a backslash drive path into /mnt/<drive>', () => {
  assert.equal(windowsToWslPosix('C:\\Users\\me\\project'), '/mnt/c/Users/me/project')
})

test('windowsToWslPosix maps the contract example X:\\foo to /mnt/x/foo', () => {
  assert.equal(windowsToWslPosix('X:\\foo'), '/mnt/x/foo')
})

test('windowsToWslPosix accepts mixed forward/backward separators', () => {
  assert.equal(windowsToWslPosix('D:/Work/FuLilian-Desktop'), '/mnt/d/Work/FuLilian-Desktop')
  assert.equal(windowsToWslPosix('D:\\Work/src\\app'), '/mnt/d/Work/src/app')
})

test('windowsToWslPosix lower-cases the drive letter regardless of input case', () => {
  assert.equal(windowsToWslPosix('c:\\foo'), '/mnt/c/foo')
  assert.equal(windowsToWslPosix('E:\\Foo'), '/mnt/e/Foo')
})

test('windowsToWslPosix handles a drive root and trailing separators', () => {
  assert.equal(windowsToWslPosix('E:\\'), '/mnt/e')
  assert.equal(windowsToWslPosix('E:\\foo\\'), '/mnt/e/foo')
  assert.equal(windowsToWslPosix('E:/'), '/mnt/e')
})

test('windowsToWslPosix passes an already-POSIX absolute path through unchanged', () => {
  assert.equal(windowsToWslPosix('/home/me/project'), '/home/me/project')
  assert.equal(windowsToWslPosix('/mnt/c/Users/me'), '/mnt/c/Users/me')
})

test('windowsToWslPosix passes relative / empty / non-drive values through unchanged', () => {
  assert.equal(windowsToWslPosix(''), '')
  assert.equal(windowsToWslPosix('relative\\path'), 'relative\\path')
  assert.equal(windowsToWslPosix('C:'), 'C:')
  assert.equal(windowsToWslPosix('\\\\server\\share'), '\\\\server\\share')
})
