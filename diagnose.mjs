/**
 * On-device diagnostics for DSHA Native Control.
 *
 * Run this INSIDE the environment where DSH runs (that is the important part —
 * on DSHA the Node process lives in a proot distro, so what it can see differs
 * from what the phone's shell can see):
 *
 *   node diagnose.mjs
 *
 * It prints a plain-text report. Paste the whole output when reporting a
 * "native backend not detected" problem; it contains no tokens or user data.
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { environmentInfo, detectAndroid, detectProot, NativeBackend } from './lib/backends/native.js'

function run(file, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({
          ok: error === null,
          code: typeof error?.code === 'number' ? error.code : null,
          signal: error?.signal ?? null,
          stdout: String(stdout ?? '').trim(),
          stderr: String(stderr ?? '').trim(),
        })
      })
    } catch (error) {
      resolve({ ok: false, code: null, signal: null, stdout: '', stderr: String(error?.message ?? error) })
    }
  })
}

function line(label, value) {
  process.stdout.write(`${label}: ${value}\n`)
}

const env = environmentInfo()
process.stdout.write('=== DSHA Native Control diagnostics ===\n')
line('platform', `${env.platform}/${env.arch}`)
line('node', env.node)
line('android detected', env.android)
line('proot detected', env.proot)
line('ANDROID_ROOT', process.env.ANDROID_ROOT ?? '(unset)')
line('resolved android root', env.androidRoot)
line('os-release', env.osRelease === '' ? '(none)' : env.osRelease)
line('PATH', process.env.PATH ?? '(unset)')

// proot markers are the usual reason /system is not where we expect it
const prootEnv = Object.keys(process.env).filter((k) => k.startsWith('PROOT_'))
line('PROOT env vars', prootEnv.length === 0 ? '(none)' : prootEnv.join(', '))
try {
  const status = readFileSync('/proc/self/status', 'utf8')
  line('TracerPid', (/^TracerPid:\s*(\d+)/m.exec(status)?.[1] ?? 'unknown'))
} catch {
  line('TracerPid', 'unreadable')
}

process.stdout.write('\n--- candidate paths ---\n')
for (const p of [
  `${env.androidRoot}/bin/getprop`, '/system/bin/getprop', '/system/bin/input', '/system/bin/screencap',
  '/system/bin/logcat', '/system/bin/app_process', '/system/bin/su', '/system/xbin/su', '/sbin/su',
  '/debug_ramdisk/su', '/data/adb/magisk/su', '/vendor/bin/input', '/system/bin/sh', '/bin/sh',
]) {
  line(p, existsSync(p) ? 'present' : 'missing')
}

process.stdout.write('\n--- su probe ---\n')
const su = ['/system/bin/su', '/system/xbin/su', '/sbin/su', '/debug_ramdisk/su', '/data/adb/magisk/su']
  .find((p) => existsSync(p))
if (su === undefined) {
  line('su', 'not found in Android/Magisk paths')
} else {
  line('su path', su)
  const id = await run(su, ['-c', 'id'])
  line('su -c id ok', id.ok)
  line('uid=0', /uid=0/.test(id.stdout))
  line('stdout', id.stdout === '' ? '(empty)' : id.stdout)
  line('stderr', id.stderr === '' ? '(empty)' : id.stderr)
}

process.stdout.write('\n--- shell probe ---\n')
for (const sh of [env.androidRoot + '/bin/sh', '/system/bin/sh', '/bin/sh', 'sh']) {
  if (sh !== 'sh' && !existsSync(sh)) continue
  const res = await run(sh, ['-c', 'echo ok'])
  line(sh, res.ok && res.stdout === 'ok' ? 'executes' : `failed (${res.stderr || res.code})`)
}

process.stdout.write('\n--- backend probe (native) ---\n')
const backend = new NativeBackend({})
const status = await backend.probe()
line('ready', status.ready)
line('rootState', status.rootState)
line('rootError', status.rootError === '' ? '(none)' : status.rootError)
line('capabilities', JSON.stringify(status.capabilities))
line('tools', JSON.stringify(status.tools))
line('detectAndroid()', detectAndroid())
line('detectProot()', detectProot())

process.stdout.write('\n--- verdict ---\n')
if (!status.ready) {
  process.stdout.write('shell unusable: native backend cannot run here. Send this report.\n')
} else if (status.rootState !== 'available') {
  process.stdout.write(`shell works but root is ${status.rootState}: input/screencap will be blocked by Android permissions.\n`)
  if (status.rootError !== '') process.stdout.write(`su said: ${status.rootError}\n`)
} else {
  process.stdout.write('native backend looks usable: shell + root + toolbox detected.\n')
}
process.stdout.write('=== end ===\n')
