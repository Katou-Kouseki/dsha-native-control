# DSHA Native Control

Control and debug the Android phone that DSH (DSHA, the Android build) runs on — no ADB, no USB, no PC.

[中文](README.md) | [English](README.en.md)

## Features

### Native on-device mode

- **Direct on-device control**: when DSH runs on the phone, the plugin drives the device through
  `su` + `input`/`screencap` — it never downloads platform-tools, never calls adb, and needs no second machine.
- **Automatic backend selection**: the config key `backend` accepts `auto` (default) / `native` / `adb`.
  `auto` prefers native on an Android host, uses ADB on desktop, and falls back to ADB when the native probe fails.
- **Diagnostics panel**: the toolbar "diagnostics" button shows the backend kind and selection reason, three-state
  Root (available / denied / not probed), per-device Injector state (ready / starting / off / blocked), the current
  screenshot frame (size / rotation / frameId / coordinate space), and probe results for
  `su` / `input` / `screencap` / `logcat` / `app_process` / `base64` / `wm` / `uiautomator`.
- **Mode-aware UI**: in native mode the status bar reads "Native 本机模式" and the one-click adb install button is
  hidden; the device dropdown shows "本机设备（DSHA Native）". ADB mode presents the usual desktop debugging view.

### Debug workbench

- **Logcat panel**: logcat stream auto-attached to devices in debug mode (`-v threadtime`), level / multi-keyword /
  package filters, pause, clear, copy, export; logs persist under `~/.dsh/dsha-native-control/logs` so history
  survives restarts, and crash/ANR snapshots are saved under `.../crashes`.
- **Screenshots with coordinate metadata**: `screen_capture` returns `frameId` / `imageWidth` / `imageHeight` /
  `rotation` / `coordinateSpace: 'screenshot-pixels'` / `capturedAt`. Internal coordinates are **raw pixels of the
  current screenshot**; rotation or resolution changes invalidate the old frame, and out-of-range coordinates are
  **rejected explicitly instead of being silently clipped**.
- **Batched actions**: `input_batch` runs up to 20 actions serially in one call
  (`tap` / `swipe` / `keyevent` / `wait` / `screenshot`), reports the failing action index, stops on error by
  default, and never replays a timed-out action. Batches do not expose arbitrary shell.
- **Full debugging toolkit**: process list / memory maps / memory search and dump, Frida deployment and script
  templates, WiFi debugging, APK install, UI hierarchy dump, screen mirroring and remote control, events view.
- **33 agent tools** spanning device, screen, input, log, process and memory layers — `native_status`,
  `native_display_info` and `input_batch` are designed specifically for on-device control.
- **One-click adb install**: in ADB mode the plugin downloads platform-tools and wires them in; extraction is a
  built-in pure-JS implementation, so it works even when the system has no `unzip` binary.

## Install

### Option 1: link from source (recommended for now)

```powershell
pnpm --dir "$env:USERPROFILE\.dsh\profiles\web" add link:<absolute-path-to-this-repo>
```

Then restart DSH Web (`dsh web`) and hard-refresh the GUI (Ctrl+F5).

> The plugin injects `cordis.patch.yml` through `dsh.bundle.patch` in `package.json` — no DSH source changes needed.

### Option 2: npm (available after publishing)

```powershell
dsh plugin --profile web add @katou-kouseki/dsha-native-control
```

> This repository is **not published to npm yet**; use option 1.

### Installing on DSHA (the Android phone)

1. Copy this repository into storage reachable by DSHA (or `git clone` it).
2. Link the directory into the web profile the same way DSHA installs plugins.
3. Start DSH Web and **grant `su` to DSH** in the Magisk prompt on first use.
4. Open the panel: the status bar should read "Native 本机模式" and the device dropdown should show
   "本机设备（DSHA Native）".
5. Open the toolbar "diagnostics" dialog to confirm Root and tool probe status.

## Backend mode configuration

| `backend` | Behaviour |
| --- | --- |
| `auto` (default) | prefer native on an Android host, ADB on desktop, fall back to ADB when the native probe fails |
| `native` | force native; no ADB, no one-click adb install; errors out (no fallback) when the local shell is unusable |
| `adb` | force the ADB flow (troubleshooting and comparison) |

## Limitations & troubleshooting

- ADB mode requires USB debugging enabled and the device authorized; native mode needs no USB debugging but
  requires root (Magisk etc.) granting `su` to DSH.
- logcat output may contain sensitive information; `/api/dsha-native-control/*` routes are loopback-only.
- **"The action ran" is not "the UI state is verified"**: `input_tap` / `input_swipe` / `input_keyevent` /
  `input_batch` returning `ok: true` only means the command or injection call was delivered — not that the screen
  moved to the expected page. To confirm state, take another `screen_capture` after the key step (or add a
  `screenshot` action to `input_batch`) and judge from the image / `ui_dump`, never from `ok: true` alone.

### Troubleshooting

- **"Native 本机模式" but Root denied**: open the diagnostics panel to inspect Root state; grant `su` to DSH in
  Magisk's superuser list, then press refresh.
- **Injector shows "blocked"**: after repeated launch failures the injector disables itself and falls back to
  equivalent stock commands (still fully functional, just slower per action); restarting DSH retries deployment.
- **One-click adb install reports an extraction error**: the diagnostic message includes both the system-extractor
  and built-in JS-extraction reasons, so you can tell a failed download from a directory-permission problem.
- **Taps land in the wrong place**: `input_*` expects raw pixel coordinates of the *current* screenshot. Take a
  fresh `screen_capture` first and pick coordinates off that frame — never reuse pre-rotation coordinates.

## Development

Requires Node `^22.19.0 || >=24.0.0`.

```powershell
# syntax
node --check lib/index.js
node --check lib/client.js

# self-check: 33 tools asserted by name + 12 required routes
node selfcheck.mjs

# unit / regression tests
node test-coords.mjs   # coordinate validation, frame cache, rotation invalidation
node test-batch.mjs    # batch guards, stopOnError, never-replay
node test-zip.mjs      # pure-JS ZIP extraction, path-traversal rejection, parity with the system extractor
node smoke-native.mjs  # force native on a non-Android host: must fail gracefully, not crash
```

## Layout

```text
lib/
  index.js           host half: engine, routes, WebSocket, agent tools, platform-tools install
  client.js          browser half: the panel (React, no build step)
  backends/
    manager.js       backend manager (auto/native/adb)
    native.js        on-device backend (su/input/screencap, three-state root, capability probe)
    adb.js           the ADB backend
    types.js         device descriptors, coordinate validation, frame metadata
  injector-jar.js    injector dex (base64 embedded)
tools/injector/      Injector.java and build script
cordis.patch.yml     profile bundle patch
selfcheck.mjs        self-check entry point
test-*.mjs           regression tests
```

## Acknowledgements

The panel UI, log and crash-snapshot flow, and the process/memory/RE tooling started from
[dsh-logcat](https://github.com/WindyPro-rourou/dsh-logcat) (Apache-2.0) — thanks to its author.
See [NOTICE](NOTICE) for provenance and the scope of changes; licensed under [Apache-2.0](LICENSE).
