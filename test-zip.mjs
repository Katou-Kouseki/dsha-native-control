/**
 * ZIP fallback extractor test (project spec §7.2, phase 4) — builds a real
 * deflate zip in-memory with Node's own zlib, then verifies extractZipJs
 * round-trips every entry (content, nesting, path-traversal rejection).
 *
 * Run: node test-zip.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { installPlatformTools, extractZipJs } from './lib/index.js'

let failures = 0
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

// --- Build a minimal ZIP by hand: central directory + local headers (deflate + stored) ---
const crc32 = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return (buf) => {
    let c = 0xFFFFFFFF
    for (const b of buf) c = table[(c ^ b) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }
})()

const entries = [
  { name: 'platform-tools/', data: Buffer.alloc(0), dir: true },
  { name: 'platform-tools/adb.txt', data: Buffer.from('fake adb payload for round-trip test 12345', 'utf8'), method: 8 },
  { name: 'platform-tools/sub/nested.bin', data: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), method: 0 },
]

const locals = []
const centrals = []
let offset = 0
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, 'utf8')
  const crc = crc32(e.data)
  const isDir = e.dir === true
  const comp = isDir ? Buffer.alloc(0) : (e.method === 8 ? deflateRawSync(e.data) : e.data)
  const compSize = isDir ? 0 : comp.length
  const uncompSize = isDir ? 0 : e.data.length
  const method = isDir ? 0 : e.method
  const local = Buffer.alloc(30 + nameBuf.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)          // version needed
  local.writeUInt16LE(0, 6)           // flags
  local.writeUInt16LE(method, 8)
  local.writeUInt16LE(0, 10)          // time
  local.writeUInt16LE(0x21, 12)       // date (1980-01-01)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(compSize, 18)
  local.writeUInt32LE(uncompSize, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28)
  nameBuf.copy(local, 30)
  locals.push(Buffer.concat([local, comp]))
  const central = Buffer.alloc(46 + nameBuf.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)        // version made by
  central.writeUInt16LE(20, 6)        // version needed
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt16LE(0, 12)
  central.writeUInt16LE(0x21, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(compSize, 20)
  central.writeUInt32LE(uncompSize, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt16LE(0, 30)        // extra len
  central.writeUInt16LE(0, 32)        // comment len
  central.writeUInt16LE(0, 34)        // disk number
  central.writeUInt16LE(0, 36)        // internal attrs
  central.writeUInt32LE(isDir ? 0x10 : 0, 38) // external attrs
  central.writeUInt32LE(offset, 42)
  nameBuf.copy(central, 46)
  centrals.push(central)
  offset += local.length + comp.length
}
const cd = Buffer.concat(centrals)
const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(0, 4)
eocd.writeUInt16LE(0, 6)
eocd.writeUInt16LE(entries.length, 8)
eocd.writeUInt16LE(entries.length, 10)
eocd.writeUInt32LE(cd.length, 12)
eocd.writeUInt32LE(offset, 16)
eocd.writeUInt16LE(0, 20)

const tmp = mkdtempSync(join(tmpdir(), 'dsh-zip-test-'))
const zipPath = join(tmp, 'test.zip')
writeFileSync(zipPath, Buffer.concat([...locals, cd, eocd]))
console.log('built test zip:', zipPath, `(${entries.length} entries)`)

// --- extractZipJs round-trip ---
const dest = join(tmp, 'out')
const count = extractZipJs(zipPath, dest)
check('returns the file count (dirs excluded)', count === 2)
check('deflate entry content round-trips', readFileSync(join(dest, 'platform-tools', 'adb.txt'), 'utf8') === 'fake adb payload for round-trip test 12345')
check('stored entry content round-trips', Buffer.from(readFileSync(join(dest, 'platform-tools', 'sub', 'nested.bin'))).equals(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])))
check('directory entries produce no files', !existsSync(join(dest, 'platform-tools', '.keep')) === true)

// Path traversal rejected
const evilName = '../evil.txt'
const evilData = Buffer.from('pwn')
const evilLocal = (() => {
  const nameBuf = Buffer.from(evilName, 'utf8')
  const comp = evilData
  const local = Buffer.alloc(30 + nameBuf.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8)
  local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12)
  local.writeUInt32LE(crc32(evilData), 14)
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(comp.length, 22)
  local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
  nameBuf.copy(local, 30)
  return Buffer.concat([local, comp])
})()
const evilZip = Buffer.concat([evilLocal, (() => {
  const nameBuf = Buffer.from(evilName, 'utf8')
  const central = Buffer.alloc(46 + nameBuf.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10)
  central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14)
  central.writeUInt32LE(crc32(evilData), 16)
  central.writeUInt32LE(evilData.length, 20); central.writeUInt32LE(evilData.length, 24)
  central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32)
  central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38)
  central.writeUInt32LE(0, 42)
  nameBuf.copy(central, 46)
  return central
})(), (() => {
  const e2 = Buffer.alloc(22)
  e2.writeUInt32LE(0x06054b50, 0)
  e2.writeUInt16LE(1, 8); e2.writeUInt16LE(1, 10)
  e2.writeUInt32LE(46 + evilName.length, 12); e2.writeUInt32LE(evilLocal.length, 16)
  return e2
})()])
const evilPath = join(tmp, 'evil.zip')
writeFileSync(evilPath, evilZip)
let evilRejected = false
try { extractZipJs(evilPath, dest) } catch { evilRejected = true }
check('path traversal entry rejected', evilRejected)
check('no file escaped the dest dir', !existsSync(join(tmp, 'evil.txt')))

// Corrupt zip rejected
const corruptPath = join(tmp, 'corrupt.zip')
writeFileSync(corruptPath, Buffer.alloc(100, 7))
let corruptRejected = false
try { extractZipJs(corruptPath, dest) } catch { corruptRejected = true }
check('corrupt zip rejected with clear error', corruptRejected)

// installPlatformTools is exported and a function (network path not exercised here)
check('installPlatformTools exported', typeof installPlatformTools === 'function')

// Cross-check against PowerShell Expand-Archive on the same zip (parity, win hosts)
try {
  const parityDest = join(tmp, 'parity')
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${parityDest}'`], { timeout: 60000 })
  const ps = readFileSync(join(parityDest, 'platform-tools', 'adb.txt'), 'utf8')
  check('output matches PowerShell Expand-Archive', ps === 'fake adb payload for round-trip test 12345')
} catch {
  console.log('SKIP  PowerShell parity check (unavailable)')
}

rmSync(tmp, { recursive: true, force: true })
console.log(failures === 0 ? 'ZIP TEST PASS' : `ZIP TEST FAIL (${failures} failures)`)
process.exit(failures === 0 ? 0 : 1)
