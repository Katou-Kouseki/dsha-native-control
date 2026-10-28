/**
 * Backend manager: picks native vs adb by mode + platform, probes both, and
 * exposes one façade the engine/tools use. Modes:
 *   - auto:   Android userland → native (this phone first); otherwise adb.
 *   - native: local shell only; never installs adb.
 *   - adb:    original desktop flow, unchanged.
 */
import { NativeBackend, detectAndroid } from './native.js'
import { AdbBackend } from './adb.js'
import { NATIVE_DEVICE_ID } from './types.js'

export class BackendManager {
  constructor(opts = {}) {
    this.mode = opts.backend ?? 'auto'   // auto | native | adb
    this.opts = opts
    this.backend = null       // active backend instance
    this.native = null
    this.adb = null           // AdbBackend when the adb engine resolved a binary
    this.reason = ''          // why this backend was chosen (shown in UI)
    this.probed = false
  }

  /**
   * Bind the adb side after the engine's own adb probe finished (desktop path
   * unchanged). `adb` is the resolved binary path or null.
   */
  attachAdb(adb, adbVersion) {
    this.adb = new AdbBackend(adb, adbVersion)
    return this.adb
  }

  /** Choose + probe the active backend. Returns a BackendStatus snapshot. */
  async init() {
    const android = detectAndroid()
    if (this.mode === 'native' || (this.mode === 'auto' && android)) {
      this.native = new NativeBackend(this.opts.native ?? {})
      const status = await this.native.probe()
      if (status.ready) {
        this.backend = this.native
        this.reason = this.mode === 'native'
          ? 'mode=native: local shell usable'
          : 'mode=auto on Android: native backend preferred, adb not required'
        this.probed = true
        return status
      }
      if (this.mode === 'native') {
        this.reason = 'mode=native but the local shell is unusable; no fallback allowed'
        this.probed = true
        return status
      }
      this.reason = 'mode=auto on Android but native probe failed; falling back to adb'
    }
    // adb (or auto fallback). The engine probes adb itself; manager reports.
    this.backend = this.adb ?? null
    this.reason = this.mode === 'adb' ? 'mode=adb (desktop flow)' : 'mode=auto off-Android: adb backend'
    this.probed = true
    return this.adb !== null
      ? await this.adb.probe()
      : { kind: 'adb', android, ready: false, reason: 'adb binary not found', capabilities: {} }
  }

  get kind() {
    return this.backend?.kind ?? (this.mode === 'native' ? 'native' : 'adb')
  }

  get ready() {
    return this.backend?.ready ?? false
  }

  /** Resolve which backend owns a device id. */
  backendFor(deviceId) {
    if (deviceId === NATIVE_DEVICE_ID) return this.native
    return this.kind === 'native' ? this.native : this.adb
  }

  status() {
    return {
      mode: this.mode,
      kind: this.kind,
      ready: this.ready,
      reason: this.reason,
      native: this.native === null ? null : {
        rootState: this.native.rootState,
        rootError: this.native.rootError,
        capabilities: this.native.capabilities,
        env: this.native.env,
      },
      adb: this.adb === null ? null : { adbPath: this.adb.adb, adbVersion: this.adb.adbVersion },
    }
  }

  dispose() {
    this.native?.dispose()
    this.adb?.dispose()
  }
}
