/**
 * input_batch desktop validation test (project spec §6.2/§11.3, phase 3) —
 * runs on any host, no device needed. Exercises the parameter guards and the
 * serial execution loop with a stubbed gesture runner, so per-action
 * validation, stopOnError, skipped indices and the never-replay rule are
 * checked without touching a real screen.
 *
 * Run: node test-batch.mjs
 */
import { apply } from './lib/index.js'

let failures = 0
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

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
const batch = tools.find((t) => t.name === 'input_batch')
check('input_batch tool registered', batch !== undefined)

// Desktop host: adb backend without adb -> early guards must fire first.
const noHost = await batch.execute({ actions: [{ type: 'tap', x: 1, y: 1 }] })
check('no adb host returns clear error', noHost.ok === false && noHost.error === 'adb not found on this host')

// Simulate a ready engine with one attached device + a known screenshot space.
engine.adb = 'C:\\adb.exe'   // makes engine.ready true on the adb path
engine.devices.set('test-serial', { serial: 'test-serial', state: 'device', model: 'Test' })
engine.displays.set('test-serial', { width: 1080, height: 2340, rotation: 0, at: Date.now() })

// Empty actions rejected
const empty = await batch.execute({ actions: [] })
check('empty actions rejected', empty.ok === false && empty.error === 'actions[] is required')

// Pre-seed a frame so inputGeometry uses the screenshot space without shell calls.
const png = Buffer.alloc(33)
png.write('\x89PNG\r\n\x1a\n', 0, 'binary')
png.writeUInt32BE(13, 8)
png.write('IHDR', 12, 'binary')
png.writeUInt32BE(1080, 16)
png.writeUInt32BE(2340, 20)
engine.noteFrame('test-serial', png)

// Stub the gesture runner: record commands, fail on demand.
const ran = []
let failOn = null
engine.runGesture = async (_serial, command) => {
  ran.push(command)
  if (failOn !== null && command.includes(failOn)) return { ok: false, code: 1, stderr: 'injected but rejected', ms: 5, backend: 'injector' }
  return { ok: true, ms: 3, backend: 'injector' }
}

// >20 actions rejected before anything runs
const tooMany = await batch.execute({ actions: Array.from({ length: 21 }, () => ({ type: 'wait', ms: 1 })) })
check('over-20 actions rejected', tooMany.ok === false && tooMany.error.includes('too many actions'))

// Happy path: tap -> wait -> tap, all reported with index/timing/backend
const okRun = await batch.execute({
  actions: [{ type: 'tap', x: 500, y: 1200 }, { type: 'wait', ms: 50 }, { type: 'tap', x: 100, y: 200 }],
})
check('happy path reports ok', okRun.ok === true && okRun.executed.length === 3)
check('per-action index/type recorded', okRun.executed[0].index === 0 && okRun.executed[2].index === 2 && okRun.executed[1].type === 'wait')
check('per-action timing+backend recorded', okRun.executed[0].ms !== undefined && okRun.executed[0].backend === 'injector')
check('commands executed in order', ran.join(' | ').includes('input tap 500 1200') && ran.join(' | ').includes('input tap 100 200'))

// Out-of-range tap: batch stops, nothing executed past the bad action (§5.2 no silent clipping)
ran.length = 0
const oob = await batch.execute({
  actions: [{ type: 'tap', x: 500, y: 1200 }, { type: 'tap', x: 2000, y: 9999 }, { type: 'tap', x: 100, y: 100 }],
})
check('out-of-range tap fails the action', oob.ok === false && oob.executed[1].ok === false && oob.executed[1].error !== '')
check('stopOnError skips later indices exactly', JSON.stringify(oob.skipped) === '[2]')
check('only the first tap ran', ran.length === 1)

// stopOnError=false: failure recorded, later actions still run
ran.length = 0
failOn = 'input tap 500 1200'
const cont = await batch.execute({
  stopOnError: false,
  actions: [{ type: 'tap', x: 500, y: 1200 }, { type: 'tap', x: 100, y: 200 }],
})
check('stopOnError=false continues past failure', cont.ok === false && cont.executed.length === 2 && cont.executed[1].ok === true)
check('failure carries the backend error', cont.executed[0].ok === false && cont.executed[0].error === 'injected but rejected')

// Unknown action type rejected at the schema layer (enum guard, additionalProperties: false) —
// arbitrary shell payloads can never enter the batch
let rejectedAtSchema = false
try {
  await batch.execute({ actions: [{ type: 'tap', x: 1, y: 1 }, { type: 'shell', command: 'rm -rf /' }] })
} catch (error) {
  rejectedAtSchema = error?.code === 'INVALID_ARGS'
}
check('unknown action type rejected at schema layer', rejectedAtSchema)
check('no shell-like action reached the runner', !ran.some((c) => !c.startsWith('input ')))

// wait is clamped to MAX_WAIT_MS (10s) — a 60s wait must not stall the batch
const t0 = Date.now()
const clamped = await batch.execute({ actions: [{ type: 'wait', ms: 60000 }] })
check('wait clamped to 10s ceiling', clamped.ok === true && Date.now() - t0 < 11000 && Date.now() - t0 >= 9500)

engine.dispose()
console.log(failures === 0 ? 'BATCH TEST PASS' : `BATCH TEST FAIL (${failures} failures)`)
process.exit(failures === 0 ? 0 : 1)
