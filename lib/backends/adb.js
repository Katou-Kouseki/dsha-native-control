/**
 * Adb backend adapter: wraps the original adb invocation primitives so the
 * engine and tools can talk to devices through one interface. Behavior is
 * byte-for-byte the original: same paths, same args, same error strings.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where the plugin may have downloaded platform-tools earlier. */
function bundledAdbRoot() {
  return join(homedir(), '.dsh', 'adb')
}

/** adb binary candidates in preference order (SDK installs, bundled, PATH). */
export function adbCandidates() {
  const out = []
  const env = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (env) {
    const suffix = process.platform === 'win32' ? 'adb.exe' : 'adb'
    out.push(join(env, 'platform-tools', suffix))
  }
  out.push(join(homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'))
  out.push(join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'))
  out.push(join(bundledAdbRoot(), 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'))
  return out.filter((p) => existsSync(p))
}

/**
 * Adb backend. Wraps an already-probed adb path (`engine.adb`); the engine
 * keeps owning adb discovery/install so the desktop flow stays untouched.
 */
export class AdbBackend {
  /** @param {string|null} adb resolved adb binary path (or 'adb' from PATH) */
  constructor(adb, adbVersion = null) {
    this.kind = 'adb'
    this.adb = adb
    this.adbVersion = adbVersion
    this.capabilities = {
      shell: adb !== null, screenshot: adb !== null, logcat: adb !== null,
      video: adb !== null, install: adb !== null, pull: adb !== null,
      frida: adb !== null, memory: adb !== null, wifiAdb: adb !== null,
      uiDump: adb !== null, batch: adb !== null,
    }
  }

  get ready() {
    return this.adb !== null
  }

  probe() {
    return Promise.resolve({
      kind: 'adb',
      android: false,
      ready: this.adb !== null,
      adbPath: this.adb,
      adbVersion: this.adbVersion,
      capabilities: { ...this.capabilities },
    })
  }

  dispose() {
    // The engine owns the adb server lifecycle; nothing to stop here.
  }
}
