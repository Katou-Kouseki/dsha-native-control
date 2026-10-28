# DSHA Native Control

让 DSH（DSHA，Android 版）在手机本机运行时，直接控制和调试这台手机，不依赖 ADB、USB 或电脑。

[中文](README.md) | [English](README.en.md)

## 特性

### Native 本机模式

- **直连本机**：DSH 运行在手机上时，插件通过 `su` + `input`/`screencap` 直接操作本机，不下载
  platform-tools、不调用 adb、不需要第二台设备参与。
- **后端自动选择**：配置项 `backend` 支持 `auto`（默认）/ `native` / `adb`。`auto` 在 Android 宿主上
  优先 Native，桌面环境自动使用 ADB，Native 探测失败时回落 ADB。
- **诊断面板**：工具栏「诊断」按钮展示后端类型与选择原因、Root 三态（可用/被拒绝/未探测）、Injector
  每设备状态（ready/starting/off/blocked）、当前截图帧（尺寸/rotation/frameId/坐标空间），以及
  `su`/`input`/`screencap`/`logcat`/`app_process`/`base64`/`wm`/`uiautomator` 的探测结果。
- **界面按模式自适应**：Native 下状态栏显示「Native 本机模式」并隐藏「一键安装 adb」，设备下拉显示
  「本机设备（DSHA Native）」；ADB 下界面按桌面调试习惯呈现。

### 调试工作台

- **logcat 面板**：自动附加设备日志流（`-v threadtime`），级别/多关键词/包名过滤，暂停、清屏、复制、
  导出；日志落盘 `~/.dsh/dsha-native-control/logs` 支持历史回溯，崩溃/ANR 自动截图存档到 `.../crashes`。
- **截图与坐标元数据**：`screen_capture` 返回 `frameId` / `imageWidth` / `imageHeight` / `rotation` /
  `coordinateSpace: 'screenshot-pixels'` / `capturedAt`。内部坐标统一为**当前截图的原始像素**，旋转或
  分辨率变化会让旧帧失效，超范围坐标**明确报错而非静默裁剪**。
- **批量动作**：`input_batch` 一次调用串行执行最多 20 个动作（`tap`/`swipe`/`keyevent`/`wait`/
  `screenshot`），失败能定位动作序号，`stopOnError` 默认停止后续动作，动作超时**不自动重放**；批次不
  开放任意 shell。
- **完整调试能力**：进程列表/内存映射/内存搜索与 dump、Frida 部署与脚本模板、WiFi 无线调试、APK 安装、
  UI 层级 dump、屏幕投屏与远程操控、events 事件视图。
- **33 个 agent 工具**：设备、屏幕、输入、日志、进程、内存各层能力均对 agent 开放，其中 `native_status`、
  `native_display_info`、`input_batch` 面向本机控制场景设计。
- **一键安装 adb**：ADB 模式下从镜像下载 platform-tools 并自动接入；解压内置纯 JS 实现，系统没有
  `unzip` 也能完成安装。

## 安装

### 方式一：从源码链接安装（当前推荐）

```powershell
# 把本仓库放到任意目录，然后链接进 web profile
pnpm --dir "$env:USERPROFILE\.dsh\profiles\web" add link:<本仓库绝对路径>
```

之后重启 DSH Web（`dsh web`），刷新 GUI（Ctrl+F5）。

> 插件通过 `package.json` 的 `dsh.bundle.patch` 自动注入 `cordis.patch.yml`，无需修改 DSH 源码。

### 方式二：npm（发布后可用）

```powershell
dsh plugin --profile web add @katou-kouseki/dsha-native-control
```

> 当前仓库**尚未发布到 npm**，请使用方式一。

### 在 DSHA（Android 手机）上安装

1. 将本仓库放到 DSHA 可访问的存储（或 `git clone`）。
2. 按 DSHA 的插件安装方式把目录链入 web profile。
3. 启动 DSH Web，首次在 Magisk 弹窗中**授予 DSH `su` 权限**。
4. 打开面板：状态栏应显示「Native 本机模式」，设备下拉显示「本机设备（DSHA Native）」。
5. 点工具栏「诊断」确认 Root 与工具探测状态。
6. 若状态栏显示「本机后端不可用」，在 DSH 终端执行 `node diagnose.mjs` 检查 proot 是否能看到 `/system`
   与 `su`。

## 后端模式配置

| `backend` | 行为 |
| --- | --- |
| `auto`（默认） | Android 宿主优先 Native；桌面使用 ADB；Native 探测失败自动回落 ADB |
| `native` | 强制本机后端，不使用 ADB、不触发一键安装 adb；本机 shell 不可用时直接报错不回退 |
| `adb` | 强制 ADB 流程（排障与对照用） |

## 限制与故障排查

- ADB 模式需要设备开启 USB 调试并授权本机；Native 模式不需要 USB 调试，但需要 Root（Magisk 等）。
- logcat 输出可能含敏感信息；`/api/dsha-native-control/*` 路由仅允许 loopback 访问。
- **「动作执行成功」不等于「业务状态已验证」**：`input_tap` / `input_swipe` / `input_keyevent` /
  `input_batch` 返回 `ok: true` 只表示命令或注入调用已送达，不表示界面已切换到预期页面。需要确认状态时，
  请在关键步骤后再取一次 `screen_capture`（或插入 `input_batch` 的 `screenshot` 动作），以图像或 `ui_dump`
  结果为准。

### 故障排查

- **检测不到本机设备（DSHA 运行在 proot 里）**：本机后端依赖 `su`、`input`、`screencap`，这些必须能在
  DSH 进程所在环境里访问到。proot 容器通常只挂载了发行版根文件系统，`/system` 可能不可见或不完整。
  在 DSH 的终端里执行 `node diagnose.mjs` 并把输出贴出来，它逐项列出 `ANDROID_ROOT`、proot 标记、
  `su` 路径与 `su -c id` 的真实返回、工具探测结果，可直接定位是「路径不可见」还是「Root 未授权」。
- **显示「本机后端不可用」**：状态栏出现该提示说明已识别出 Android 宿主，但本机后端探测未通过；点「诊断」
  查看后端选择原因、Root 三态与 `su` 返回原文。
- **显示「Native 本机模式」但 Root 被拒绝**：打开「诊断」面板查看 Root 状态；在 Magisk 超级用户列表里给
  DSH 授予 `su` 后点「刷新」。
- **Injector 显示「已阻断」**：注入器连续启动失败后会自行停用并回退等价的系统命令（功能仍可用，单次动作
  略慢）；重启 DSH 会重新尝试部署。
- **一键安装 adb 报解压错误**：诊断信息会同时给出系统解压器与内置 JS 解包两层原因，便于定位是网络下载
  失败还是目录权限问题。
- **点击位置不对**：`input_*` 要求传「当前截图的原始像素坐标」。先用 `screen_capture` 拿最新帧，再按图点选，
  不要复用旋转前的旧坐标。

## 开发

环境：Node `^22.19.0 || >=24.0.0`。

```powershell
# 语法检查
node --check lib/index.js
node --check lib/client.js

# 自检：33 个工具按名断言 + 12 条必需路由断言
node selfcheck.mjs

# 单元/回归测试
node test-coords.mjs   # 坐标校验、帧缓存、旋转失效
node test-batch.mjs    # 批量动作守卫、stopOnError、超时不重放
node test-zip.mjs      # JS ZIP 解包、路径穿越拒绝、与系统解压器一致性
node smoke-native.mjs  # 非 Android 宿主强制 native：应优雅失败而非崩溃
```

## 目录结构

```text
lib/
  index.js           宿主端：Engine、路由、WebSocket、agent 工具、platform-tools 安装
  client.js          浏览器端：面板（React，无构建步骤）
  backends/
    manager.js       后端管理器（auto/native/adb）
    native.js        本机后端（su/input/screencap，Root 三态，能力探测）
    adb.js           ADB 后端
    types.js         设备描述符、坐标校验、帧元数据
  injector-jar.js    注入器 dex（base64 内嵌）
tools/injector/      Injector.java 与构建脚本
cordis.patch.yml     profile bundle patch
selfcheck.mjs        自检脚本
test-*.mjs           回归测试
```

## 致谢

本项目的面板 UI、日志与崩溃快照流程、进程/内存/逆向工具链起步于
[dsh-logcat](https://github.com/WindyPro-rourou/dsh-logcat)（Apache-2.0），感谢原作者的工作。
详细来源与改动范围见 [NOTICE](NOTICE)，许可为 [Apache-2.0](LICENSE)。
