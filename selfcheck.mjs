/**
 * DSHA Native Control self-check: imports the host half, mounts it on a stub
 * cordis context, waits for the backend probe, and reports the engine status.
 *
 * Run: node selfcheck.mjs
 */
import { apply, name, inject } from './lib/index.js'

const routes = []
const upgrades = []
const tools = []
const sections = []

const ctx = {
  webServer: {
    register: (route) => { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1) } },
    registerUpgrade: (upgrade) => { upgrades.push(upgrade); return () => { const i = upgrades.indexOf(upgrade); if (i >= 0) upgrades.splice(i, 1) } },
  },
  tools: {
    register: (tool) => { tools.push(tool); return () => { const i = tools.indexOf(tool); if (i >= 0) tools.splice(i, 1) } },
  },
  systemPrompt: {
    section: (section) => { sections.push(section); return () => { const i = sections.indexOf(section); if (i >= 0) sections.splice(i, 1) } },
  },
  effect: (fn) => { const dispose = fn(); return dispose ?? (() => {}) },
}

console.log(`plugin name: ${name}, inject: ${JSON.stringify(inject)}`)
apply(ctx, {})
await new Promise((resolve) => setTimeout(resolve, 2500))

const status = ctx['dsha-native-control'].status()
console.log('status:', JSON.stringify(status, null, 2))
console.log(`routes registered: ${routes.length} (${routes.map((r) => r.path).join(', ')})`)
console.log(`upgrade routes: ${upgrades.length} (${upgrades.map((u) => u.path).join(', ')})`)
console.log(`tools registered: ${tools.length} (${tools.map((t) => t.name).join(', ')})`)
console.log(`system-prompt sections: ${sections.length}`)

// Exercise a few tools (no device attached -> graceful empty results).
const EXERCISE = ['logcat_recent', 'logcat_history', 'logcat_events', 'crash_sessions', 'app_info', 'activity_current', 'input_keyevent', 'app_launch', 'app_stop', 'screen_capture', 'native_status', 'native_display_info', 'input_tap', 'input_swipe', 'input_batch']
for (const toolName of EXERCISE) {
  const tool = tools.find((t) => t.name === toolName)
  if (tool === undefined) { console.log(`MISSING TOOL: ${toolName}`); continue }
  const result = await tool.execute({ lines: 5, package: 'com.android.settings', key: 'home', x: 10, y: 10, x1: 10, y1: 10, x2: 20, y2: 20, actions: [{ type: 'tap', x: 10, y: 10 }, { type: 'wait', ms: 100 }] })
  console.log(`${toolName} execute:`, JSON.stringify(result).slice(0, 200))
}

// Critical tool checks: every required tool must be present BY NAME (a bare count
// check would silently pass if one tool was swapped for another), and the total
// must stay at 33 so accidental additions/removals are caught too.
const REQUIRED_TOOLS = [
  // pre-existing upstream tools (30)
  'logcat_recent', 'logcat_devices', 'adb_exec', 'logcat_set_package', 'adb_install', 'adb_pull',
  'logcat_crash', 'logcat_history', 'crash_sessions', 'logcat_events', 'app_info', 'activity_current',
  'input_keyevent', 'app_launch', 'app_stop', 'screen_capture', 'device_info', 'device_stats',
  'input_tap', 'input_swipe', 'input_text', 'ui_dump', 'proc_list', 'proc_maps', 'proc_status',
  'mem_dump', 'frida_server', 'mem_search', 'proc_smaps', 'frida_script',
  // DSHA Native Control additions (3)
  'native_status', 'native_display_info', 'input_batch',
]
let failed = false
for (const toolName of REQUIRED_TOOLS) {
  if (!tools.some((t) => t.name === toolName)) {
    console.log(`FAIL: required tool missing: ${toolName}`)
    failed = true
  }
}
const EXPECTED = 33
if (tools.length !== EXPECTED) {
  console.log(`FAIL: expected ${EXPECTED} tools, got ${tools.length}`)
  failed = true
}
// Required routes the panel and tools depend on.
const REQUIRED_ROUTES = ['/api/dsha-native-control/status', '/api/dsha-native-control/install-adb', '/api/dsha-native-control/exec',
  '/api/dsha-native-control/screenshot', '/api/dsha-native-control/install-apk', '/api/dsha-native-control/keyevent',
  '/api/dsha-native-control/wifi-connect', '/api/dsha-native-control/wifi-disconnect', '/api/dsha-native-control/processes',
  '/api/dsha-native-control/mem-search', '/api/dsha-native-control/mem-dump', '/api/dsha-native-control/maps']
for (const path of REQUIRED_ROUTES) {
  if (!routes.some((r) => r.path === path)) {
    console.log(`FAIL: required route missing: ${path}`)
    failed = true
  }
}
if (failed) process.exitCode = 1
else console.log('required tools/routes: all present')

if (status.ready) {
  console.log('SELFCHECK OK — adb found, engine polling')
} else {
  console.log('SELFCHECK PARTIAL — adb not found (plugin still mounts; panel will show "未找到 adb")')
}

// Tear down the engine so a live logcat stream does not keep the process alive.
ctx['dsha-native-control'].engine.dispose()
console.log('engine disposed — exiting')
