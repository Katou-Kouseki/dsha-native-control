# AGENTS.md — DSHA Native Control

Notes for anyone (human or coding assistant) working in this repository. Keep it accurate; it must
never contain secret values.

## Project shape

- Host half: `lib/index.js` (engine, HTTP routes, WebSocket stream, agent tools).
- Browser half: `lib/client.js` (single bundle, `window.__ModuleLoader__` format, no build step).
- Backend abstraction: `lib/backends/` — `manager.js` picks `native` or `adb`, `native.js` is the
  on-device backend, `adb.js` is the original desktop backend, `types.js` holds device descriptors,
  coordinate validation and screenshot frame metadata.
- Injector: `tools/injector/Injector.java`; the compiled dex is embedded as base64 in
  `lib/injector-jar.js` (rebuild with `tools/injector/build.mjs`).

## Hard rules

- **Never break the ADB backend.** Desktop users must keep the original behaviour; native support is
  additive and selected at runtime.
- **One coordinate space**: raw pixels of the current screenshot, origin top-left. Never guess rotation
  transforms; invalidate stale frames instead. Out-of-range points must error, not be clipped.
- **"Command delivered" ≠ "state verified".** Tool descriptions and docs must say so; verify UI state
  with a fresh screenshot.
- **No arbitrary shell in batches.** `input_batch` accepts only tap/swipe/keyevent/wait/screenshot.
- **Never leak secrets** (tokens, keys, credentials) into code, docs, logs or commits. Do not ask users
  for tokens inside this repo's tooling.
- **Routes are loopback-only.** Do not weaken that check.

## Verification gates (run before committing)

```sh
node --check lib/index.js
node --check lib/client.js
node selfcheck.mjs        # 33 tools asserted by name + 12 required routes
node test-coords.mjs
node test-batch.mjs
node test-zip.mjs
node smoke-native.mjs     # forcing native on desktop must degrade gracefully
```

## UI

- The right-hand drawer is the default surface; the native `main` + `sidebar.panellist` panel is opt-in
  via `window.__DSHA_NATIVE_CONTROL_PANEL__ = true`.
- Design language: host tokens first (`--dsw-*`), one accent colour, bundled SVG icons (no emoji),
  monospace + tabular-nums log rows, dense but calm chrome.
- Keep the drawer overlay-based: it must not push the conversation layout.
- Native mode hides ADB-only affordances (e.g. the one-click adb install button) and labels the local
  device as "本机设备（DSHA Native）".

## Environment variables

- `DSHA_NATIVE_CONTROL_PERSIST=off` disables disk persistence of log lines.
- `DSHA_NATIVE_CONTROL_DAY_MB`, `DSHA_NATIVE_CONTROL_MAX_MB`, `DSHA_NATIVE_CONTROL_RETAIN_DAYS` tune the
  persistence caps (defaults: 64 MB/day, 512 MB total, 14 days).
