/** Native-mode smoke test on a desktop host: probe must fail gracefully, no crash. */
import { apply } from './lib/index.js'

const tools = []
const sections = []
const ctx = {
  tools: { register: (t) => { tools.push(t); return () => {} } },
  systemPrompt: { section: (s) => { sections.push(s); return () => {} } },
  webServer: { register: () => () => {}, registerUpgrade: () => () => {} },
  effect: (fn) => { const d = fn(); return d ?? (() => {}) },
  provide: (key, value) => { ctx[key] = value },
  on: () => () => {},
}

apply(ctx, { backend: 'native' })
await new Promise((r) => setTimeout(r, 3000))
const status = ctx['dsha-native-control'].status()
console.log('backend mode forced native →', JSON.stringify(status.backend))
console.log('ready:', status.ready, '| devices:', JSON.stringify(status.devices))
if (status.ready) { console.error('UNEXPECTED: desktop native probe should not be ready'); process.exit(1) }
if (status.backend.mode !== 'native') { console.error('mode not honored'); process.exit(1) }
if (tools.length !== 33) { console.error(`tool count ${tools.length} != 33`); process.exit(1) }
console.log('NATIVE DESKTOP SMOKE PASS (degraded, not crashed)')
process.exit(0)
