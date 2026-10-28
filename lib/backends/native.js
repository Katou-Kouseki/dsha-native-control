/**
 * Native backend: controls the phone the plugin itself runs on (DSHA — Android
 * DSH). No adb, no USB, no platform-tools download. Commands run through the
 * local shell; privileged operations go through `su -c` only after an explicit
 * root probe (never assume the Node process is root itself).
 *
 * Capability degradation is explicit: when a tool is blocked by Android
 * version, SELinux or ROM policy, the backend reports a capability status
 * instead of throwing, so the plugin never fails to mount.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { NATIVE_DEVICE_ID, makeDeviceDescriptor, pngSize } from './types.js'

/** Android root as seen from this process (proot may mount it elsewhere). */
function androidRoot() {
  const env = String(process.env.ANDROID_ROOT ?? '').trim()
  return env === '' ? '/system' : env.replace(/\/+$/, '')
}

/** Extra ROM paths: Magisk, debug ramdisk, apex runtime. */
const ANDROID_EXTRA_DIRS = [
  '/vendor/bin', '/product/bin', '/system_ext/bin', '/sbin',
  '/debug_ramdisk', '/data/adb/magisk', '/apex/com.android.runtime/bin',
]

/** Candidate toolbox directories, ANDROID_ROOT first, then stock + ROM paths. */
function toolboxDirs() {
  return [`${androidRoot()}/bin`, `${androidRoot()}/xbin`, '/system/bin', '/system/xbin', ...ANDROID_EXTRA_DIRS]
}

/** Locate `name` in the toolbox dirs; optionally also in PATH (proot setups). */
function findTool(name, pathFallback = false) {
  for (const dir of toolboxDirs()) {
    const p = `${dir}/${name}`
    if (existsSync(p)) return p
  }
  if (pathFallback) {
    for (const dir of String(process.env.PATH ?? '').split(':')) {
      if (dir === '' || !dir.startsWith('/')) continue
      const p = `${dir}/${name}`
      if (existsSync(p)) return p
    }
  }
  return ''
}

/**
 * Locate `su`. Deliberately does NOT search PATH: on a desktop Linux host
 * /usr/bin/su exists and would make the backend report "denied" instead of
 * "unavailable". Only Android/Magisk locations are valid candidates.
 */
function findSu() {
  for (const dir of toolboxDirs()) {
    const p = `${dir}/su`
    if (existsSync(p)) return p
  }
  return null
}

/** Resolve the best shell binary. Returns an absolute path or 'sh'. */
function shellPath() {
  for (const candidate of [`${androidRoot()}/bin/sh`, '/system/bin/sh', '/bin/sh']) {
    if (existsSync(candidate)) return candidate
  }
  return 'sh'
}

/**
 * proot / emulated-userland detection. DSHA-style Android hosts may run Node
 * inside a proot distro, where /system is bind-mounted (or not) and Magisk's su
 * can behave differently. PROOT_* env vars plus a non-zero TracerPid (proot is
 * a ptrace supervisor) are the reliable signals.
 */
export function detectProot() {
  const env = process.env
  if (env.PROOT_TMP_DIR || env.PROOT_LOADER || env.PROOT_L2S_DIR || env.PROOT_SINGLE_STEP || env.PROOT_NO_SECCOMP) {
    return true
  }
  try {
    const status = readFileSync('/proc/self/status', 'utf8')
    const m = /^TracerPid:\s*(\d+)/m.exec(status)
    return m !== null && Number(m[1]) > 0
  } catch {
    return false
  }
}

/** Environment snapshot for the diagnostics panel (never includes secrets). */
export function environmentInfo() {
  let osRelease = ''
  try {
    const raw = readFileSync('/etc/os-release', 'utf8')
    osRelease = (/^PRETTY_NAME="?([^"\n]+)"?/m.exec(raw)?.[1] ?? '').trim()
  } catch {
    // no /etc/os-release (stock Android or sandboxed app) — fine
  }
  return {
    androidRoot: androidRoot(),
    proot: detectProot(),
    osRelease,
    android: detectAndroid(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    pathHasAndroidToolbox: String(process.env.PATH ?? '').split(':').some((d) => /\/system\/(bin|xbin)$/.test(d)),
  }
}

/**
 * Heuristic platform probe: are we an Android userland (possibly inside proot)?
 */
export function detectAndroid() {
  try {
    if (existsSync(`${androidRoot()}/bin/getprop`)) return true
    if (existsSync('/system/bin/getprop') || existsSync('/system/lib') || existsSync('/system/lib64')) return true
    // proot distros sometimes expose the Android toolbox only through PATH.
    if (detectProot() && findTool('getprop', true) !== '') return true
    return false
  } catch {
    return false
  }
}

/** One-shot command run. Resolves { ok, code, timedOut, stdout, stderr }. */
function runCmd(file, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === 'number' ? error.code : null
          const timedOut = error.killed === true || error.signal === 'SIGTERM'
          resolve({ ok: false, code, timedOut, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
        } else {
          resolve({ ok: true, code: 0, timedOut: false, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
        }
      })
    } catch {
      resolve({ ok: false, code: null, timedOut: false, stdout: '', stderr: '' })
    }
  })
}

/** One-shot command run returning raw binary stdout, or rejecting. */
function runCmdBinary(file, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    try {
      execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' }, (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      })
    } catch (error) {
      reject(error)
    }
  })
}

/** Shell-quote one token for `sh -c` interpolation (double-quote wrapping). */
function shQuote(token) {
  return '"' + String(token).replace(/([$`"\\])/g, '\\$1') + '"'
}

/**
 * Native device backend.
 *
 * Root probing: `su -c id` must print uid=0. Three states:
 *   - "available": su exists and granted uid=0
 *   - "denied":    su exists but denied/failed (Magisk prompt rejected etc.)
 *   - "unavailable": no su binary at all
 */
export class NativeBackend {
  constructor(opts = {}) {
    this.kind = 'native'
    this.opts = opts
    this.shell = shellPath()
    this.suPath = null
    this.rootState = 'unavailable'   // available | denied | unavailable
    this.probed = false
    this.capabilities = {
      shell: false, root: false, input: false, screencap: false, logcat: false,
      appProcess: false, base64: false, wm: false, uiautomator: false,
    }
    this.tools = {}   // name -> absolute path ('' = not found)
    this.env = null   // environmentInfo() after the first probe
    this.rootError = ''  // why su did not yield uid=0 (diagnostics only)
    this.descriptor = makeDeviceDescriptor({ id: NATIVE_DEVICE_ID, backend: 'native' })
  }

  /** Probe the local environment. Idempotent; fills this.capabilities. */
  async probe() {
    this.probed = true
    const caps = this.capabilities
    this.env = environmentInfo()
    // A real round-trip, not just existsSync: the 'sh' fallback must prove it
    // can actually execute (desktop hosts have no Android toolbox at all).
    const shellCheck = await runCmd(this.shell, ['-c', 'echo ok'], 6000)
    caps.shell = shellCheck.ok && shellCheck.stdout.trim() === 'ok'
    // PATH fallback only for Android-ish hosts: on a desktop Linux box it would
    // match coreutils (base64) and misreport native capabilities.
    const pathFallback = this.env.android || this.env.proot
    this.tools.input = findTool('input', pathFallback)
    this.tools.screencap = findTool('screencap', pathFallback)
    this.tools.logcat = findTool('logcat', pathFallback)
    this.tools.appProcess = findTool('app_process', pathFallback)
    this.tools.base64 = findTool('base64', pathFallback)
    this.tools.wm = findTool('wm', pathFallback)
    this.tools.uiautomator = findTool('uiautomator', pathFallback)
    this.tools.dumpsys = findTool('dumpsys', pathFallback)
    caps.input = this.tools.input !== ''
    caps.screencap = this.tools.screencap !== ''
    caps.logcat = this.tools.logcat !== ''
    caps.appProcess = this.tools.appProcess !== ''
    caps.base64 = this.tools.base64 !== ''
    caps.wm = this.tools.wm !== ''
    caps.uiautomator = this.tools.uiautomator !== ''
    // Root probe: `su -c id` must yield uid=0. Never assume we are root.
    // This MUST invoke su directly — runShell() deliberately refuses to escalate
    // until rootState is "available", so probing through it would always report
    // "denied" and never detect a working su.
    this.suPath = findSu()
    this.rootError = ''
    if (this.suPath !== null) {
      const res = await runCmd(this.suPath, ['-c', 'id'], 8000)
      if (res.ok && /uid=0/.test(res.stdout)) {
        this.rootState = 'available'
        caps.root = true
      } else {
        this.rootState = 'denied'
        const detail = (res.stderr || res.stdout || '').trim().replace(/\s+/g, ' ').slice(0, 240)
        this.rootError = detail === '' ? `su exited ${res.code ?? 'without output'}` : detail
      }
    } else {
      this.rootState = 'unavailable'
      this.rootError = 'no su binary in Android/Magisk paths'
    }
    return {
      kind: 'native',
      android: true,
      ready: caps.shell,
      rootState: this.rootState,
      rootError: this.rootError,
      env: { ...this.env },
      capabilities: { ...caps },
      tools: { ...this.tools },
    }
  }

  /**
   * Run one shell command line. Root commands wrap through `su -c` and are
   * ONLY issued for the fixed, validated operations this backend implements —
   * never for arbitrary agent-supplied text.
   */
  async runShell(command, timeoutMs = 15000, { root = false, quiet = false } = {}) {
    const useRoot = root && this.rootState === 'available'
    if (root && this.rootState !== 'available' && !quiet) {
      return { ok: false, code: null, timedOut: false, stdout: '', stderr: `root ${this.rootState} on this device` }
    }
    const file = useRoot ? this.suPath : this.shell
    const args = useRoot ? ['-c', command] : ['-c', command]
    const res = await runCmd(file, args, timeoutMs)
    if (useRoot && !res.ok && /su: |not found|Permission denied/i.test(res.stderr) && !quiet) {
      res.stderr = `root command failed: ${res.stderr}`
    }
    return res
  }

  /** Run a command and return raw stdout Buffer (screenshots, screenrecord). */
  async runBinary(command, timeoutMs = 20000, { root = false } = {}) {
    // Only used for fixed internal commands (screencap), safe by construction.
    const useRoot = root && this.rootState === 'available' && this.suPath !== null
    const file = useRoot ? this.suPath : this.shell
    return runCmdBinary(file, ['-c', command], timeoutMs)
  }

  /** The one native device (this phone). */
  async listDevices() {
    return [await this.getDeviceInfo(NATIVE_DEVICE_ID)]
  }

  async getDeviceInfo(deviceId = NATIVE_DEVICE_ID) {
    if (deviceId !== NATIVE_DEVICE_ID) throw new Error(`native backend only knows ${NATIVE_DEVICE_ID}`)
    const d = this.descriptor
    if (!this.probed) await this.probe()
    // Read-only props via getprop — best-effort, never fatal.
    const props = await this.runShell(
      'getprop ro.product.model; getprop ro.product.manufacturer; getprop ro.build.version.release; getprop ro.build.version.sdk',
      6000, { quiet: true })
    if (props.ok) {
      const [model, manufacturer, version, sdk] = props.stdout.split(/\r?\n/)
      d.model = (model ?? '').trim() || undefined
      d.manufacturer = (manufacturer ?? '').trim() || undefined
      d.androidVersion = (version ?? '').trim() || undefined
      const sdkInt = Number.parseInt(String(sdk ?? '').trim(), 10)
      d.sdkInt = Number.isInteger(sdkInt) && sdkInt > 0 ? sdkInt : undefined
    }
    d.rootAvailable = this.rootState === 'available'
    d.state = this.capabilities.shell ? 'device' : 'error'
    return d
  }

  /** Oriented display geometry via dumpsys (same source as the adb path). */
  async displayState(maxAgeMs = 1200) {
    const now = Date.now()
    const cached = this._display
    if (cached !== undefined && now - cached.at < maxAgeMs) return cached
    let next = cached ?? null
    if (this.tools.dumpsys !== '') {
      const res = await this.runShell(
        `${this.tools.dumpsys} display | grep -m1 mOverrideDisplayInfo`, 6000, { quiet: true })
      if (res.ok) {
        const size = /real (\d+) x (\d+)/.exec(res.stdout)
        const rot = /rotation (\d+)/.exec(res.stdout)
        if (size !== null) {
          next = { width: Number(size[1]), height: Number(size[2]), rotation: rot === null ? 0 : Number(rot[1]), at: now }
        }
      }
    }
    if (next !== null) this._display = next
    return next
  }

  /** Density via `wm density` (best-effort). */
  async density() {
    if (this.tools.wm === '') return undefined
    const res = await this.runShell(`${this.tools.wm} density`, 6000, { quiet: true })
    const m = res.ok ? /(\d+)\s*$/.exec(res.stdout.trim()) : null
    return m !== null ? Number(m[1]) : undefined
  }

  /**
   * Screenshot via local screencap. Returns { png, width, height } or throws
   * with the real error (never substitutes a stale frame).
   */
  async captureScreenshot() {
    if (!this.capabilities.screencap) {
      throw new Error('screencap not found on this device')
    }
    const png = await this.runBinary(`${shQuote(this.tools.screencap)} -p`, 20000, { root: true })
    if (!Buffer.isBuffer(png) || png.length < 24) throw new Error('screencap returned no image')
    const size = pngSize(png)
    if (size === null) throw new Error('screencap output is not a PNG (ROM quirk)')
    return { png, width: size.width, height: size.height }
  }

  /**
   * Spawn a long-lived child (logcat / injector) through the local shell.
   * Same contract as AdbBackend.spawnLong: returns the ChildProcess.
   */
  spawnLong(args) {
    return spawn(this.shell, ['-c', args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  }

  /**
   * Spawn a long-lived child with root when available (logcat / screenrecord on
   * an app-uid Node process need shell-group rights only su can grant). Falls
   * back to the plain shell when root is missing — the child then fails fast
   * and the caller's restart backoff handles it.
   */
  spawnRoot(args) {
    if (this.rootState !== 'available' || this.suPath === null) return this.spawnLong(args)
    return spawn(this.suPath, ['-c', args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  }

  /** Long-lived logcat child; extraArgs mirror the adb path (`-b events` etc). */
  spawnLogcat(extraArgs = []) {
    return this.spawnRoot(`logcat -v threadtime ${extraArgs.join(' ')}`)
  }

  dispose() {
    // Nothing persistent here; owned children are tracked by the engine.
  }
}
