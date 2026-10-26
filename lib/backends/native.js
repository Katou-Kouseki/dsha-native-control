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
import { existsSync } from 'node:fs'
import { NATIVE_DEVICE_ID, makeDeviceDescriptor, pngSize } from './types.js'

/** Candidate shell binaries in preference order (verified before use). */
const SHELL_CANDIDATES = ['/system/bin/sh', '/bin/sh', 'sh']
// Only absolute paths: a bare "su" would match on any host via the find()
// fallback and misreport rootState as "denied" on desktops that have no su.
const SU_CANDIDATES = ['/system/bin/su', '/system/xbin/su', '/sbin/su', '/su/bin/su']
const TOOLBOX_DIRS = ['/system/bin', '/system/xbin', '/vendor/bin', '/sbin']

/** Locate `name` under the known toolbox dirs; returns an absolute path or ''. */
function findTool(name) {
  for (const dir of TOOLBOX_DIRS) {
    const p = `${dir}/${name}`
    if (existsSync(p)) return p
  }
  return ''
}

/** Resolve the best shell binary. Returns an absolute path or 'sh'. */
function shellPath() {
  for (const candidate of SHELL_CANDIDATES) {
    if (candidate.startsWith('/') && existsSync(candidate)) return candidate
  }
  return 'sh'
}

/**
 * Heuristic platform probe: are we an Android userland?
 * DSHA runs Node inside the Android app sandbox, so /system/bin + getprop exist
 * while typical desktop markers (/proc/version "Linux version" alone is NOT a
 * disqualifier — Android kernels report that too) do not.
 */
export function detectAndroid() {
  try {
    if (!existsSync('/system/bin/getprop') && !existsSync('/system/lib') && !existsSync('/system/lib64')) {
      return false
    }
    return true
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
    this.descriptor = makeDeviceDescriptor({ id: NATIVE_DEVICE_ID, backend: 'native' })
  }

  /** Probe the local environment. Idempotent; fills this.capabilities. */
  async probe() {
    this.probed = true
    const caps = this.capabilities
    // A real round-trip, not just existsSync: the 'sh' fallback must prove it
    // can actually execute (desktop hosts have no Android toolbox at all).
    const shellCheck = await runCmd(this.shell, ['-c', 'echo ok'], 6000)
    caps.shell = shellCheck.ok && shellCheck.stdout.trim() === 'ok'
    this.tools.input = findTool('input')
    this.tools.screencap = findTool('screencap')
    this.tools.logcat = findTool('logcat')
    this.tools.appProcess = findTool('app_process')
    this.tools.base64 = findTool('base64')
    this.tools.wm = findTool('wm')
    this.tools.uiautomator = findTool('uiautomator')
    this.tools.dumpsys = findTool('dumpsys')
    caps.input = this.tools.input !== ''
    caps.screencap = this.tools.screencap !== ''
    caps.logcat = this.tools.logcat !== ''
    caps.appProcess = this.tools.appProcess !== ''
    caps.base64 = this.tools.base64 !== ''
    caps.wm = this.tools.wm !== ''
    caps.uiautomator = this.tools.uiautomator !== ''
    // Root probe: `su -c id` must yield uid=0. Never assume we are root.
    this.suPath = SU_CANDIDATES.find((p) => (p.startsWith('/') ? existsSync(p) : p === 'su')) ?? null
    if (this.suPath !== null) {
      const res = await this.runShell('id', 6000, { root: true, quiet: true })
      if (res.ok && /uid=0/.test(res.stdout)) {
        this.rootState = 'available'
        caps.root = true
      } else {
        this.rootState = 'denied'
      }
    } else {
      this.rootState = 'unavailable'
    }
    return {
      kind: 'native',
      android: true,
      ready: caps.shell,
      rootState: this.rootState,
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
  async runBinary(command, timeoutMs = 20000) {
    // Only used for fixed internal commands (screencap), safe by construction.
    return runCmdBinary(this.shell, ['-c', command], timeoutMs)
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
    const png = await this.runBinary(`${this.tools.screencap} -p`)
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
