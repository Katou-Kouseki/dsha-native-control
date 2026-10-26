/**
 * Coordinate-layer unit test (project spec §5 / phase 2) — runs on any host,
 * no device needed. Exercises the frame cache, rotation invalidation and
 * range validation through the real AdbEngine methods.
 *
 * Run: node test-coords.mjs
 */
import { validatePoint, screenshotMeta, pngSize } from './lib/backends/types.js'

let failures = 0
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

// --- validatePoint (spec §5.2: out-of-range is an error, never clipping) ---
check('in-range point accepted', validatePoint(100, 200, 1080, 2340) === '')
check('x beyond width rejected', validatePoint(1080, 200, 1080, 2340) !== '')
check('negative y rejected', validatePoint(100, -1, 1080, 2340) !== '')
check('non-finite rejected', validatePoint(Number.NaN, 0, 1080, 2340) !== '')
check('unknown geometry rejected (no silent pass)', validatePoint(100, 200, undefined, undefined) !== '')
check('landscape coords validated against landscape space', validatePoint(2300, 1000, 2340, 1080) === '')
check('portrait coords rejected in landscape space', validatePoint(2300, 2000, 2340, 1080) !== '')

// --- pngSize / screenshotMeta (spec §5.1 metadata shape) ---
const png = Buffer.alloc(33)
png.write('\x89PNG\r\n\x1a\n', 0, 'binary')
png.writeUInt32BE(13, 8)          // IHDR length
png.write('IHDR', 12, 'binary')
png.writeUInt32BE(2340, 16)       // width
png.writeUInt32BE(1080, 20)       // height
const size = pngSize(png)
check('pngSize reads 2340x1080 from IHDR', size !== null && size.width === 2340 && size.height === 1080)
check('pngSize rejects non-PNG buffer', pngSize(Buffer.alloc(40)) === null)
const meta = screenshotMeta({ width: 2340, height: 1080, rotation: 1 })
check('meta carries coordinateSpace screenshot-pixels', meta.coordinateSpace === 'screenshot-pixels')
check('meta carries frameId + capturedAt', typeof meta.frameId === 'string' && meta.frameId !== '' && !Number.isNaN(Date.parse(meta.capturedAt)))

// --- Engine frame cache + rotation invalidation through real methods ---
// (import the engine module but only touch the pure Map-based methods)
const { apply } = await import('./lib/index.js')
const tools = []
const ctx = {
  tools: { register: (t) => { tools.push(t); return () => {} } },
  systemPrompt: { section: () => () => {} },
  webServer: { register: () => () => {}, registerUpgrade: () => () => {} },
  effect: (fn) => { const d = fn(); return d ?? (() => {}) },
  provide: (key, value) => { ctx[key] = value },
}
apply(ctx, {})
const engine = ctx['dsha-native-control'].engine

// Same rotation -> frame stays authoritative
engine.displays.set('test-serial', { width: 2340, height: 1080, rotation: 1, at: Date.now() })
const noted2 = engine.noteFrame('test-serial', png)   // captured WITH rotation=1 known
check('noteFrame returns meta matching the PNG', noted2.imageWidth === 2340 && noted2.imageHeight === 1080)
check('frameInfo returns the cached frame', engine.frameInfo('test-serial')?.frameId === noted2.frameId)
let geo = await engine.inputGeometry('test-serial')
check('inputGeometry prefers the screenshot space', geo.source === 'screenshot' && geo.width === 2340 && geo.height === 1080)

// Rotation change -> frame invalidated, falls back to dumpsys geometry (spec §5.2)
engine.displays.set('test-serial', { width: 1080, height: 2340, rotation: 3, at: Date.now() })
geo = await engine.inputGeometry('test-serial')
check('rotation change invalidates the stale frame', geo.source === 'dumpsys' && geo.width === 1080 && geo.height === 2340)

// A fresh capture after the turn re-establishes the screenshot space
const noted3 = engine.noteFrame('test-serial', png)
let geo2 = await engine.inputGeometry('test-serial')
check('fresh capture after rotation re-establishes the frame', geo2.source === 'screenshot' && geo2.meta.frameId === noted3.frameId)
void noted2

engine.dispose()
console.log(failures === 0 ? 'COORDS TEST PASS' : `COORDS TEST FAIL (${failures} failures)`)
process.exit(failures === 0 ? 0 : 1)
