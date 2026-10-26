/**
 * Backend contracts shared by the adb and native device backends.
 *
 * Internal coordinate standard (project spec §5.1): the CURRENT screenshot's raw
 * pixel space — origin top-left, x right, y down. Every screenshot carries
 * metadata describing that space; input tools validate against it instead of
 * trusting `wm size` alone.
 */

/** Stable pseudo device id for "this phone itself" under the native backend. */
export const NATIVE_DEVICE_ID = 'native-local'

/**
 * Device descriptor (project spec §3.2).
 * native: id = "native-local"; adb: id = the real serial.
 */
export function makeDeviceDescriptor(partial = {}) {
  return {
    id: '',
    backend: 'adb',
    state: 'device',
    model: undefined,
    manufacturer: undefined,
    androidVersion: undefined,
    sdkInt: undefined,
    width: undefined,
    height: undefined,
    rotation: undefined,
    densityDpi: undefined,
    rootAvailable: undefined,
    inputInjector: 'unknown',
    ...partial,
  }
}

/** Validate a point against a coordinate space. Returns an error string or ''. */
export function validatePoint(x, y, width, height) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'coordinates must be finite numbers'
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return 'display geometry unknown; capture a screenshot first or call native_display_info'
  }
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return `coordinate (${Math.round(x)},${Math.round(y)}) is outside the screen (${width}x${height}); refusing to clip silently`
  }
  return ''
}

/**
 * Decode PNG width/height from the IHDR chunk (bytes 16..23).
 * Returns { width, height } or null when the buffer is not a PNG.
 */
export function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null
  if (buf.readUInt32BE(12) !== 0x49484452) return null // "IHDR"
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** Screenshot metadata attached to every capture result. */
export function screenshotMeta({ width, height, rotation, logicalWidth, logicalHeight, densityDpi, frameId, capturedAt }) {
  return {
    imageWidth: width,
    imageHeight: height,
    rotation: rotation ?? 0,
    logicalWidth: logicalWidth ?? width,
    logicalHeight: logicalHeight ?? height,
    densityDpi: densityDpi ?? undefined,
    coordinateSpace: 'screenshot-pixels',
    frameId: frameId ?? `frame-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    capturedAt: capturedAt ?? new Date().toISOString(),
  }
}
